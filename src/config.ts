/**
 * SPDX-License-Identifier: MPL-2.0
 */

import { createRequire } from "node:module";
import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";

import { parse as parseYaml } from "yaml";

import type { LinkCheckerConfig, LinkCheckerOptions } from "./types.ts";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

export const VERSION: string = version;
export const CONFIG_FILENAMES = [".checklinks.config.yaml", ".checklinks.config.yml"] as const;

type SchemaType = "string" | "number" | "boolean" | "string[]" | "enum" | "map" | "level";

/** One config key: drives defaults, YAML validation, CLI flags, and `--help`. */
export interface SchemaEntry {
	type: SchemaType;
	default: unknown;
	description: string;
	values?: readonly string[];
	/** Hidden from `--help` when the value only makes sense in YAML. */
	cli?: boolean;
}

export const SCHEMA: Record<keyof LinkCheckerConfig, SchemaEntry> = {
	url: { type: "string", default: undefined, description: "Live site to crawl (required unless path is set)" },
	path: { type: "string", default: undefined, description: "Local build directory, served on a random port for the run" },
	markdown: { type: "string[]", default: [], description: "Globs of Markdown source files to check, relative to the working directory" },
	excludedKeywords: { type: "string[]", default: [], description: "Plain substrings; a URL containing one is skipped" },
	excludedPatterns: { type: "string[]", default: [], description: "Regular expressions; a URL matching one is skipped" },
	filterLevel: { type: "level", default: 1, description: "0 clickable links, 1 + media, 2 + all link-like attributes, 3 + scripts and stylesheets" },
	honorRobotExclusions: { type: "boolean", default: true, description: "Fetch robots.txt per host and skip disallowed URLs" },
	maxSocketsPerHost: { type: "number", default: 1, description: "Concurrent requests to any single host" },
	maxSockets: { type: "number", default: 10, description: "Concurrent requests overall" },
	rateLimit: { type: "number", default: 0, description: "Minimum milliseconds between requests to the same host" },
	requestMethod: { type: "enum", default: "head", values: ["head", "get"], description: "HEAD first with GET fallback, or GET always" },
	timeout: { type: "number", default: 15_000, description: "Per-request timeout in milliseconds" },
	retries: { type: "number", default: 2, description: "Retries on 429, 5xx, and network errors" },
	maxDepth: { type: "number", default: Infinity, description: "How many links deep to follow from the start URL" },
	checkInternal: { type: "boolean", default: true, description: "Report same-origin links and assets" },
	checkExternal: { type: "boolean", default: true, description: "Check off-origin links" },
	checkFragments: { type: "boolean", default: false, description: "Verify #fragment targets exist on internal pages" },
	sitemap: { type: "string", default: false, description: "Seed the crawl from /sitemap.xml (true) or a sitemap URL" },
	redirects: { type: "enum", default: "allow", values: ["allow", "warn", "error"], description: "What a redirected link means" },
	statusCodes: { type: "map", default: {}, description: "Per-status override, e.g. 403: warn", cli: false },
	headers: { type: "map", default: {}, description: "Extra request headers", cli: false },
	userAgent: { type: "string", default: `allons-y-link-checker/${version} (+https://github.com/allonsy-studio/link-checker)`, description: "User-Agent header" },
	reporters: { type: "string[]", default: ["console"], description: "console, json, github (repeatable)" },
	output: { type: "string", default: undefined, description: "File path for the json reporter" },
	strict: { type: "boolean", default: false, description: "Warnings also fail the run" },
};

/** Keys accepted from older config files and mapped onto the current schema. */
const DEPRECATED: Record<string, (value: unknown, into: LinkCheckerOptions, warn: (msg: string) => void) => void> = {
	internal(value, into, warn) {
		warn("`internal` is deprecated; use `checkInternal` instead.");
		if (typeof value === "boolean") into.checkInternal = value;
	},
	excludeExternalLinks(value, into, warn) {
		warn("`excludeExternalLinks` is deprecated; use `checkExternal` instead.");
		if (typeof value === "boolean") into.checkExternal = !value;
	},
	excludeInternalLinks(value, into, warn) {
		warn("`excludeInternalLinks` is deprecated; use `checkInternal` instead.");
		if (typeof value === "boolean") into.checkInternal = !value;
	},
};

export class ConfigError extends Error {
	override name = "ConfigError";
}

export function defaults(): LinkCheckerConfig {
	const out: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(SCHEMA)) {
		out[key] = structuredClone(entry.default);
	}
	return out as unknown as LinkCheckerConfig;
}

function coerce(key: string, entry: SchemaEntry, value: unknown): unknown {
	switch (entry.type) {
		case "string":
			if (key === "sitemap" && typeof value === "boolean") return value;
			if (typeof value !== "string") throw new ConfigError(`\`${key}\` must be a string`);
			return value;
		case "number": {
			const n = typeof value === "string" ? Number(value) : value;
			if (typeof n !== "number" || Number.isNaN(n) || n < 0) throw new ConfigError(`\`${key}\` must be a number ≥ 0`);
			return n;
		}
		case "boolean":
			if (typeof value === "string") return value !== "false";
			if (typeof value !== "boolean") throw new ConfigError(`\`${key}\` must be true or false`);
			return value;
		case "level": {
			const n = Number(value);
			if (![0, 1, 2, 3].includes(n)) throw new ConfigError(`\`${key}\` must be 0, 1, 2, or 3`);
			return n;
		}
		case "enum":
			if (typeof value !== "string" || !entry.values?.includes(value)) {
				throw new ConfigError(`\`${key}\` must be one of ${entry.values?.join(", ")}`);
			}
			return value;
		case "string[]": {
			const list = Array.isArray(value) ? value : [value];
			if (!list.every((v) => typeof v === "string")) throw new ConfigError(`\`${key}\` must be a list of strings`);
			return list;
		}
		case "map":
			if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ConfigError(`\`${key}\` must be a map`);
			return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)]));
	}
}

/** Validate and normalize a partial config; unknown keys are an error, deprecated keys are mapped. */
export function normalize(input: Record<string, unknown>, warn: (msg: string) => void = () => {}): LinkCheckerOptions {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		if (value === undefined) continue;
		if (key in DEPRECATED) {
			DEPRECATED[key]!(value, out as LinkCheckerOptions, warn);
			continue;
		}
		const entry = SCHEMA[key as keyof LinkCheckerConfig];
		if (!entry) throw new ConfigError(`Unknown config key \`${key}\``);
		out[key] = coerce(key, entry, value);
	}
	return out as LinkCheckerOptions;
}

/** Merge layers left to right, validate the result, and apply cross-key rules. */
export function resolveConfig(...layers: Array<LinkCheckerOptions | undefined>): LinkCheckerConfig {
	const merged: LinkCheckerConfig = Object.assign(defaults(), ...layers.filter(Boolean));
	if (!merged.url && !merged.path && merged.markdown.length === 0) throw new ConfigError("Config must define `url` or `path`.");
	if (merged.url && merged.path) throw new ConfigError("`url` and `path` are mutually exclusive.");
	if (merged.url) {
		let parsed: URL;
		try {
			parsed = new URL(merged.url);
		} catch {
			throw new ConfigError(`\`url\` is not a valid URL: ${merged.url}`);
		}
		if (!/^https?:$/.test(parsed.protocol)) throw new ConfigError("`url` must use http or https.");
	}
	if (merged.maxSocketsPerHost < 1) throw new ConfigError("`maxSocketsPerHost` must be at least 1.");
	if (merged.maxSockets < 1) throw new ConfigError("`maxSockets` must be at least 1.");
	for (const pattern of merged.excludedPatterns) {
		try {
			new RegExp(pattern);
		} catch (error) {
			throw new ConfigError(`\`excludedPatterns\` entry is not a valid regular expression: ${pattern} (${(error as Error).message})`);
		}
	}
	for (const [code, action] of Object.entries(merged.statusCodes)) {
		if (!/^\d{3}$/.test(code)) throw new ConfigError(`\`statusCodes\` key must be a 3-digit status: ${code}`);
		if (!["ok", "warn", "error"].includes(action)) throw new ConfigError(`\`statusCodes.${code}\` must be ok, warn, or error`);
	}
	return merged;
}

async function exists(file: string): Promise<boolean> {
	try {
		await access(file);
		return true;
	} catch {
		return false;
	}
}

/** Find the config file: an explicit path, or the first default name present in `cwd`. */
export async function findConfigFile(explicit?: string, cwd: string = process.cwd()): Promise<string | undefined> {
	if (explicit) {
		const file = resolve(cwd, explicit);
		if (!(await exists(file))) throw new ConfigError(`Config file not found: ${file}`);
		return file;
	}
	for (const name of CONFIG_FILENAMES) {
		const file = resolve(cwd, name);
		if (await exists(file)) return file;
	}
	return undefined;
}

export interface LoadConfigOptions {
	/** Explicit config path; defaults to `.checklinks.config.yaml` in `cwd`. */
	config?: string;
	cwd?: string;
	/** Highest-priority layer, e.g. parsed CLI flags. */
	overrides?: LinkCheckerOptions;
	warn?: (msg: string) => void;
}

/** Read the YAML file (if any), merge overrides, and return a complete, validated config. */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<LinkCheckerConfig> {
	const file = await findConfigFile(options.config, options.cwd);
	let fromFile: LinkCheckerOptions | undefined;
	if (file) {
		const raw = parseYaml(await readFile(file, "utf8")) ?? {};
		if (typeof raw !== "object" || Array.isArray(raw)) throw new ConfigError(`${file} must contain a YAML map.`);
		fromFile = normalize(raw as Record<string, unknown>, options.warn);
	}
	return resolveConfig(fromFile, options.overrides);
}
