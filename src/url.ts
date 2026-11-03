/**
 * SPDX-License-Identifier: MPL-2.0
 */

import type { LinkCheckerConfig } from "./types.ts";

const SKIPPED_SCHEMES = new Set(["mailto:", "tel:", "sms:", "javascript:", "data:", "blob:", "about:", "ftp:", "file:"]);

/** Resolve `raw` against `base`; returns undefined for schemes that are never checked or unparsable values. */
export function resolveLink(raw: string, base: string): URL | undefined {
	const trimmed = raw.trim();
	if (!trimmed || trimmed.startsWith("#")) return undefined;
	let url: URL;
	try {
		url = new URL(trimmed, base);
	} catch {
		return undefined;
	}
	if (SKIPPED_SCHEMES.has(url.protocol)) return undefined;
	if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
	return url;
}

/** The identity used for deduplication: fragment dropped, default port dropped, host lowercased by the URL parser. */
export function normalizeUrl(url: URL): string {
	const copy = new URL(url.href);
	copy.hash = "";
	return copy.href;
}

export function isSameOrigin(url: URL, base: URL): boolean {
	return url.origin === base.origin;
}

export function hostKey(url: URL): string {
	return url.host;
}

/** True when the URL is excluded by a keyword (substring) or a pattern (regex). */
export function isExcluded(href: string, config: Pick<LinkCheckerConfig, "excludedKeywords" | "excludedPatterns">, patterns: RegExp[]): string | undefined {
	for (const keyword of config.excludedKeywords) {
		if (href.includes(keyword)) return `excluded by keyword "${keyword}"`;
	}
	for (const pattern of patterns) {
		if (pattern.test(href)) return `excluded by pattern ${pattern}`;
	}
	return undefined;
}

export function compilePatterns(patterns: string[]): RegExp[] {
	return patterns.map((p) => new RegExp(p));
}

/** Parse an `srcset` attribute into its candidate URLs. */
export function parseSrcset(value: string): string[] {
	const out: string[] = [];
	for (const candidate of value.split(",")) {
		const url = candidate.trim().split(/\s+/)[0];
		if (url) out.push(url);
	}
	return out;
}

/** Extract `url(...)` and `@import "..."` references from CSS text. */
export function parseCssUrls(css: string): string[] {
	const out: string[] = [];
	const urlRe = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;
	const importRe = /@import\s+(?:"([^"]+)"|'([^']+)')/gi;
	for (const match of css.matchAll(urlRe)) {
		const found = match[1] ?? match[2] ?? match[3];
		if (found) out.push(found);
	}
	for (const match of css.matchAll(importRe)) {
		const found = match[1] ?? match[2];
		if (found) out.push(found);
	}
	return out;
}

/** The URL from a `<meta http-equiv="refresh" content="0; url=...">`. */
export function parseMetaRefresh(content: string): string | undefined {
	const match = /^\s*\d+\s*[;,]\s*url\s*=\s*(.+)$/i.exec(content);
	if (!match?.[1]) return undefined;
	let url = match[1].trim();
	const quote = url[0];
	if (quote === '"' || quote === "'") {
		const end = url.indexOf(quote, 1);
		url = url.slice(1, end === -1 ? undefined : end);
	}
	return url;
}
