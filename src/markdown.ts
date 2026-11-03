/**
 * SPDX-License-Identifier: MPL-2.0
 */

import { glob, readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import type { DiscoveredLink, LinkCheckerConfig, LinkResult } from "./types.ts";
import { resolveLink } from "./url.ts";

export interface MarkdownLink {
	url: string;
	/** 1-based line number. */
	line: number;
	kind: "link" | "asset" | "reference";
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const INLINE_LINK = /(!?)\[((?:[^[\]\\]|\\.|\[[^\]]*\])*)\]\(\s*(?:<([^>]*)>|([^\s()]*(?:\([^\s()]*\)[^\s()]*)*))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const REFERENCE = /^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/;
const AUTOLINK = /<([a-z][a-z0-9+.-]*:[^\s<>]*)>/gi;
const HTML_ATTR = /\b(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const HTML_ID = /\bid\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
const CODE_SPAN = /(`+)(.+?)\1(?!`)/g;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*$/;

/** Walk lines, yielding each one that is outside a fenced code block. */
function* proseLines(text: string): Generator<{ line: number; text: string }> {
	let fence: { char: string; size: number } | undefined;
	const lines = text.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i]!;
		const match = FENCE.exec(raw);
		if (fence) {
			if (match && match[1]![0] === fence.char && match[1]!.length >= fence.size && raw.trim() === match[1]) fence = undefined;
			continue;
		}
		if (match) {
			fence = { char: match[1]![0]!, size: match[1]!.length };
			continue;
		}
		yield { line: i + 1, text: raw };
	}
}

const blank = (s: string) => " ".repeat(s.length);

/** Pull links out of Markdown source with regexes. Fenced code & inline code spans are ignored. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- `file` is part of the public signature
export function extractMarkdownLinks(text: string, _file: string): MarkdownLink[] {
	const out: MarkdownLink[] = [];
	for (const { line, text: raw } of proseLines(text)) {
		const source = raw.replace(CODE_SPAN, blank);
		const add = (url: string | undefined, kind: MarkdownLink["kind"]) => {
			if (url !== undefined && url.trim() !== "") out.push({ url: url.trim(), line, kind });
		};

		const scanInline = (segment: string) => {
			for (const match of segment.matchAll(INLINE_LINK)) {
				add(match[3] ?? match[4], match[1] ? "asset" : "link");
				// A linked image: `[![alt](img)](href)` carries a second link in its label.
				if (match[2]?.includes("](")) scanInline(match[2]);
			}
		};
		scanInline(source);

		const reference = REFERENCE.exec(source);
		if (reference) add(reference[1] ?? reference[2], "reference");
		for (const match of source.matchAll(AUTOLINK)) add(match[1], "link");
		for (const match of source.matchAll(HTML_ATTR)) add(match[2] ?? match[3], match[1]!.toLowerCase() === "src" ? "asset" : "link");
	}
	return out;
}

/** GitHub-style slug for a heading's text. */
function slugify(heading: string): string {
	return heading
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[*_`~]/g, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s-]/gu, "")
		.trim()
		.replace(/\s/g, "-");
}

/** Every fragment a Markdown file can be linked to: heading slugs, `{#custom-id}` suffixes & HTML `id` attributes. */
export function markdownHeadingIds(text: string): Set<string> {
	const ids = new Set<string>();
	const seen = new Map<string, number>();
	for (const { text: raw } of proseLines(text)) {
		const heading = HEADING.exec(raw);
		if (heading) {
			let title = heading[1]!.replace(/\s+#+$/, "");
			const custom = /\s*\{#([^}\s]+)\}\s*$/.exec(title);
			if (custom) {
				ids.add(custom[1]!);
				title = title.slice(0, custom.index);
			}
			const slug = slugify(title);
			const count = seen.get(slug) ?? 0;
			seen.set(slug, count + 1);
			ids.add(count === 0 ? slug : `${slug}-${count}`);
		}
		for (const match of raw.replace(CODE_SPAN, blank).matchAll(HTML_ID)) ids.add((match[1] ?? match[2])!);
	}
	return ids;
}

/** Hand a URL to the crawler; `parent` is `file:line`. */
export type MarkdownDiscover = (link: DiscoveredLink, parent: string) => void;
export type MarkdownSkip = (url: string, parent: string, reason: string) => void;
export type MarkdownEmit = (result: LinkResult) => void;

export interface MarkdownContext {
	/** Crawl base for root-relative links; absent when neither `url` nor `path` is set. */
	base?: URL | undefined;
	cwd?: string;
}

async function expand(patterns: string[], cwd: string): Promise<string[]> {
	const files = new Set<string>();
	const exclude = (entry: unknown) => (typeof entry === "string" ? entry : (entry as { name: string }).name) === "node_modules";
	for await (const match of glob(patterns, { cwd, exclude } as never)) {
		const file = resolve(cwd, String(match));
		if (file.split(sep).includes("node_modules")) continue;
		if (await stat(file).then((s) => s.isFile(), () => false)) files.add(file);
	}
	return [...files].sort();
}

interface Target {
	file: string;
	fragment: string;
	original: string;
	kind: "link" | "asset";
	parents: Set<string>;
}

/** Check every link in the configured Markdown files: web links go to the crawler, file links are resolved on disk. */
export async function discoverMarkdown(config: LinkCheckerConfig, discover: MarkdownDiscover, skip: MarkdownSkip, emit: MarkdownEmit, context: MarkdownContext = {}): Promise<void> {
	if (config.markdown.length === 0) return;
	const cwd = context.cwd ?? process.cwd();
	const files = await expand(config.markdown, cwd);
	const targets = new Map<string, Target>();
	const rootSkips = new Map<string, Set<string>>();

	for (const file of files) {
		const rel = relative(cwd, file).split(sep).join("/");
		for (const link of extractMarkdownLinks(await readFile(file, "utf8"), rel)) {
			const parent = `${rel}:${link.line}`;
			const raw = link.url;
			const kind = link.kind === "asset" ? "asset" : "link";
			if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) {
				if (raw.startsWith("//") && !context.base) {
					(rootSkips.get(raw) ?? rootSkips.set(raw, new Set()).get(raw)!).add(parent);
					continue;
				}
				const url = resolveLink(raw, context.base?.href ?? "https://localhost/");
				if (url) discover({ url: url.href, original: raw, kind, tag: "markdown", attr: link.kind }, parent);
				continue;
			}
			if (raw.startsWith("/")) {
				if (!context.base) {
					(rootSkips.get(raw) ?? rootSkips.set(raw, new Set()).get(raw)!).add(parent);
					continue;
				}
				const url = resolveLink(raw, context.base.href);
				if (url) discover({ url: url.href, original: raw, kind, tag: "markdown", attr: link.kind }, parent);
				continue;
			}

			const hash = raw.indexOf("#");
			const pathPart = (hash === -1 ? raw : raw.slice(0, hash)).split("?")[0]!;
			const fragment = hash === -1 ? "" : raw.slice(hash + 1);
			if (!pathPart && !fragment) continue;
			let decoded = pathPart;
			try {
				decoded = decodeURIComponent(pathPart);
			} catch {}
			const target = pathPart ? resolve(dirname(file), decoded) : file;
			const key = `${target}#${fragment}`;
			const existing = targets.get(key);
			if (existing) existing.parents.add(parent);
			else targets.set(key, { file: target, fragment, original: raw, kind, parents: new Set([parent]) });
		}
	}

	for (const [raw, parents] of rootSkips) {
		for (const parent of parents) skip(raw, parent, "no url or path to resolve root-relative links against");
	}

	const headings = new Map<string, Set<string> | undefined>();
	for (const target of targets.values()) {
		const found = await stat(target.file).then(
			() => true,
			() => false,
		);
		let state: LinkResult["state"] = found ? "ok" : "broken";
		let reason = found ? undefined : "file not found";
		if (found && target.fragment && config.checkFragments && /\.(?:md|markdown)$/i.test(target.file)) {
			if (!headings.has(target.file)) {
				headings.set(target.file, await readFile(target.file, "utf8").then(markdownHeadingIds, () => undefined));
			}
			const ids = headings.get(target.file);
			let fragment = target.fragment;
			try {
				fragment = decodeURIComponent(fragment);
			} catch {}
			if (ids && !ids.has(fragment)) {
				state = "broken";
				reason = `no heading with id "${fragment}"`;
			}
		}
		emit({
			url: relative(cwd, target.file).split(sep).join("/") + (target.fragment ? `#${target.fragment}` : ""),
			original: target.original,
			state,
			...(reason ? { reason } : {}),
			redirects: [],
			parents: [...target.parents],
			kind: target.kind,
			internal: true,
			attempts: 0,
			durationMs: 0,
		});
	}
}
