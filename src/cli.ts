#!/usr/bin/env node

/**
 * SPDX-License-Identifier: MPL-2.0
 */

import { parseArgs, type ParseArgsConfig } from "node:util";

import { ConfigError, SCHEMA, VERSION, loadConfig, normalize } from "./config.ts";
import { crawl } from "./crawl.ts";
import { createReporters } from "./reporters/index.ts";
import type { CheckSummary, LinkCheckerConfig, LinkResult, LinkState } from "./types.ts";

type ArgOptions = NonNullable<ParseArgsConfig["options"]>;

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Build parseArgs options from the schema so flags, defaults, and help never drift apart. */
function cliOptions(): { options: ArgOptions; keys: Map<string, keyof LinkCheckerConfig> } {
	const options: ArgOptions = {
		config: { type: "string", short: "c" },
		help: { type: "boolean", short: "h" },
		version: { type: "boolean", short: "v" },
	};
	const keys = new Map<string, keyof LinkCheckerConfig>();
	for (const [key, entry] of Object.entries(SCHEMA)) {
		if (entry.cli === false) continue;
		const flag = kebab(key);
		keys.set(flag, key as keyof LinkCheckerConfig);
		options[flag] = {
			type: entry.type === "boolean" ? "boolean" : "string",
			...(entry.type === "string[]" ? { multiple: true } : {}),
		};
		// Singular aliases read better when repeated: --reporter json --reporter github.
		if (entry.type === "string[]" && flag.endsWith("s")) {
			const singular = flag.slice(0, -1);
			keys.set(singular, key as keyof LinkCheckerConfig);
			options[singular] = { type: "string", multiple: true };
		}
	}
	return { options, keys };
}

function help(): string {
	const lines = [
		`@allons-y/link-checker ${VERSION}`,
		"",
		"Usage: link-checker [url] [flags]",
		"",
		"Reads .checklinks.config.{yaml,yml,json,js,mjs,cjs} (or .checklinks.<ext>) from the current directory; flags override file values.",
		"",
		"Flags:",
		"  -c, --config <path>          Config file (default: first .checklinks[.config].* found)",
		"  -h, --help                   Show this help",
		"  -v, --version                Print the version",
	];
	for (const [key, entry] of Object.entries(SCHEMA)) {
		if (entry.cli === false) continue;
		const flag = `--${kebab(key)}`;
		const arg = entry.type === "boolean" ? "" : entry.type === "enum" ? ` <${entry.values?.join("|")}>` : entry.type === "level" ? " <0-3>" : " <value>";
		const def = entry.default === undefined || (Array.isArray(entry.default) && entry.default.length === 0) ? "" : ` (default: ${JSON.stringify(entry.default === Infinity ? "unlimited" : entry.default).replaceAll('"', "")})`;
		const left = `  ${flag}${arg}`;
		lines.push(`${left.padEnd(31)}${entry.description}${def}`);
	}
	lines.push("", "Exit codes: 0 no broken links, 1 broken links found, 2 configuration or startup error.");
	return lines.join("\n");
}

async function main(argv: string[]): Promise<number> {
	const { options, keys } = cliOptions();
	let parsed: ReturnType<typeof parseArgs>;
	try {
		parsed = parseArgs({ args: argv, options, allowPositionals: true, allowNegative: true, strict: true });
	} catch (error) {
		console.error(`${(error as Error).message}\n\nRun link-checker --help for usage.`);
		return 2;
	}
	const { values, positionals } = parsed;
	if (values["help"]) {
		console.log(help());
		return 0;
	}
	if (values["version"]) {
		console.log(VERSION);
		return 0;
	}

	const raw: Record<string, unknown> = {};
	for (const [flag, value] of Object.entries(values)) {
		const key = keys.get(flag);
		if (!key || value === undefined) continue;
		const previous = raw[key];
		raw[key] = Array.isArray(previous) && Array.isArray(value) ? [...previous, ...value] : value;
	}
	if (positionals[0]) raw["url"] = positionals[0];

	let config: LinkCheckerConfig;
	try {
		const overrides = normalize(raw);
		const configPath = typeof values["config"] === "string" ? values["config"] : undefined;
		config = await loadConfig({ ...(configPath ? { config: configPath } : {}), overrides, warn: (msg) => console.warn(`warning: ${msg}`) });
	} catch (error) {
		if (error instanceof ConfigError) {
			console.error(`error: ${error.message}`);
			return 2;
		}
		throw error;
	}

	const reporters = createReporters(config);
	const controller = new AbortController();
	const stop = () => controller.abort();
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);

	const started = Date.now();
	const results: LinkResult[] = [];
	const counts: Record<LinkState, number> = { ok: 0, warn: 0, broken: 0, skipped: 0 };
	try {
		const stream = crawl(config, {
			signal: controller.signal,
			onStart: (base) => {
				for (const reporter of reporters) reporter.start?.(base, config);
			},
		});
		for await (const result of stream) {
			results.push(result);
			counts[result.state] += 1;
			for (const reporter of reporters) reporter.result?.(result);
		}
	} catch (error) {
		console.error(`error: ${(error as Error).message}`);
		return 2;
	} finally {
		process.off("SIGINT", stop);
		process.off("SIGTERM", stop);
	}

	const summary: CheckSummary = {
		passed: counts.broken === 0 && (!config.strict || counts.warn === 0),
		counts,
		durationMs: Date.now() - started,
		results,
	};
	for (const reporter of reporters) await reporter.end?.(summary, config);
	if (controller.signal.aborted) return 130;
	return summary.passed ? 0 : 1;
}

main(process.argv.slice(2)).then(
	(code) => {
		process.exitCode = code;
	},
	(error) => {
		console.error(error);
		process.exitCode = 2;
	},
);
