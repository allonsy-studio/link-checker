/**
 * SPDX-License-Identifier: MPL-2.0
 */

import { styleText } from "node:util";

import type { LinkCheckerConfig, LinkResult } from "../types.ts";
import type { Reporter } from "./index.ts";

type Style = Parameters<typeof styleText>[0];

const useColor = (): boolean => Boolean(process.stdout.isTTY) && !process.env["NO_COLOR"] && process.env["TERM"] !== "dumb";

function paint(style: Style, text: string): string {
	return useColor() ? styleText(style, text) : text;
}

const GLYPH = {
	ok: paint("green", "✓"),
	info: paint("blue", "ℹ"),
	warn: paint("yellow", "⚠"),
	broken: paint("red", "✗"),
};

export function consoleReporter(config: LinkCheckerConfig): Reporter {
	const progress = Boolean(process.stderr.isTTY);
	let checked = 0;
	let lastLine = "";

	const clearProgress = () => {
		if (progress && lastLine) {
			process.stderr.write(`\r${" ".repeat(lastLine.length)}\r`);
			lastLine = "";
		}
	};

	const showProgress = () => {
		if (!progress) return;
		lastLine = `  checked ${checked}`;
		process.stderr.write(`\r${lastLine}`);
	};

	const describe = (result: LinkResult) => {
		const status = result.status !== undefined ? paint("yellow", String(result.status)) : paint("yellow", result.reason ?? "?");
		const lines = [`${result.state === "warn" ? GLYPH.warn : GLYPH.broken} ${paint("bold", result.state.toUpperCase())} [${status}] ${paint("underline", result.url)}`];
		if (result.reason && result.status !== undefined) lines.push(`      ${paint("dim", result.reason)}`);
		if (result.redirects.length > 0) lines.push(`      ${paint("dim", `via ${result.redirects.join(" → ")}`)}`);
		for (const parent of result.parents) lines.push(`      on page: ${paint("underline", parent)}`);
		return lines.join("\n");
	};

	return {
		start(base) {
			const what = [config.checkInternal && "internal", config.checkExternal && "external", `assets at level ${config.filterLevel}`].filter(Boolean).join(", ");
			console.log(`\n${GLYPH.info}  Checking ${paint("underline", base)} (${what}) …\n`);
		},
		result(result) {
			checked += 1;
			if (result.state === "broken" || result.state === "warn") {
				clearProgress();
				console.log(describe(result) + "\n");
			}
			showProgress();
		},
		end(summary) {
			clearProgress();
			const { counts } = summary;
			console.log("─".repeat(65));
			const seconds = (summary.durationMs / 1000).toFixed(1);
			const totals = `${counts.ok} ok, ${counts.warn} warned, ${counts.broken} broken, ${counts.skipped} skipped in ${seconds}s`;
			if (summary.passed) {
				console.log(`${GLYPH.ok}  No broken links. ${paint("dim", totals)}`);
			} else {
				const failed = counts.broken > 0 ? `${counts.broken} broken link(s) found.` : `${counts.warn} warning(s) and --strict is set.`;
				console.log(`${GLYPH.broken}  ${failed} ${paint("dim", totals)}`);
			}
		},
	};
}
