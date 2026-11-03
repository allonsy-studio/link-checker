/**
 * SPDX-License-Identifier: MPL-2.0
 */

import { Parser } from "htmlparser2";

import type { DiscoveredLink, FilterLevel, LinkKind, ParsedPage } from "./types.ts";
import { parseCssUrls, parseMetaRefresh, parseSrcset, resolveLink } from "./url.ts";

interface Rule {
	tag: string;
	attr: string;
	level: FilterLevel;
	kind: LinkKind;
	/** Skip the element when this returns true. */
	unless?: (attrs: Record<string, string>) => boolean;
}

const stylesheet = (attrs: Record<string, string>) => /\bstylesheet\b/i.test(attrs["rel"] ?? "");
const noFetchRel = (attrs: Record<string, string>) => /\b(?:dns-prefetch|preconnect)\b/i.test(attrs["rel"] ?? "");

/** Which element and attribute pairs each `filterLevel` scans. Each level includes every lower one. */
export const RULES: readonly Rule[] = [
	// 0: clickable links
	{ tag: "a", attr: "href", level: 0, kind: "link" },
	{ tag: "area", attr: "href", level: 0, kind: "link" },
	// 1: images and media
	{ tag: "img", attr: "src", level: 1, kind: "asset" },
	{ tag: "img", attr: "srcset", level: 1, kind: "asset" },
	{ tag: "source", attr: "src", level: 1, kind: "asset" },
	{ tag: "source", attr: "srcset", level: 1, kind: "asset" },
	{ tag: "video", attr: "src", level: 1, kind: "asset" },
	{ tag: "video", attr: "poster", level: 1, kind: "asset" },
	{ tag: "audio", attr: "src", level: 1, kind: "asset" },
	{ tag: "track", attr: "src", level: 1, kind: "asset" },
	{ tag: "iframe", attr: "src", level: 1, kind: "asset" },
	{ tag: "embed", attr: "src", level: 1, kind: "asset" },
	{ tag: "object", attr: "data", level: 1, kind: "asset" },
	// 2: every other link-like attribute
	{ tag: "link", attr: "href", level: 2, kind: "asset", unless: (a) => stylesheet(a) || noFetchRel(a) },
	{ tag: "form", attr: "action", level: 2, kind: "link" },
	{ tag: "blockquote", attr: "cite", level: 2, kind: "link" },
	{ tag: "q", attr: "cite", level: 2, kind: "link" },
	{ tag: "del", attr: "cite", level: 2, kind: "link" },
	{ tag: "ins", attr: "cite", level: 2, kind: "link" },
	{ tag: "input", attr: "src", level: 2, kind: "asset" },
	{ tag: "body", attr: "background", level: 2, kind: "asset" },
	{ tag: "html", attr: "manifest", level: 2, kind: "asset" },
	{ tag: "iframe", attr: "longdesc", level: 2, kind: "link" },
	// 3: code and styles
	{ tag: "script", attr: "src", level: 3, kind: "asset" },
	{ tag: "link", attr: "href", level: 3, kind: "asset", unless: (a) => !stylesheet(a) },
];

const index = new Map<string, Rule[]>();
for (const rule of RULES) {
	const list = index.get(rule.tag) ?? [];
	list.push(rule);
	index.set(rule.tag, list);
}

/**
 * Extract every link from an HTML document at the given filter level.
 * Honors `<base href>`, `<meta http-equiv="refresh">`, and (at level 3) `url()` in style blocks and attributes.
 */
export function parseHtml(html: string, pageUrl: string, filterLevel: FilterLevel): ParsedPage {
	const links: DiscoveredLink[] = [];
	const ids = new Set<string>();
	let base = pageUrl;
	let baseSet = false;
	let inStyle = false;
	let styleText = "";

	const push = (raw: string, tag: string, attr: string, kind: LinkKind) => {
		const url = resolveLink(raw, base);
		if (!url) return;
		links.push({ url: url.href, original: raw.trim(), kind, tag, attr });
	};

	const parser = new Parser(
		{
			onopentag(name, attrs) {
				if (attrs["id"]) ids.add(attrs["id"]);
				if (name === "a" && attrs["name"]) ids.add(attrs["name"]);

				if (name === "base" && attrs["href"] && !baseSet) {
					const resolved = resolveLink(attrs["href"], pageUrl);
					if (resolved) base = resolved.href;
					baseSet = true;
					return;
				}
				if (name === "meta" && /^refresh$/i.test(attrs["http-equiv"] ?? "") && attrs["content"]) {
					const target = parseMetaRefresh(attrs["content"]);
					if (target) push(target, "meta", "content", "link");
					return;
				}
				if (name === "style" && filterLevel >= 3) inStyle = true;
				if (filterLevel >= 3 && attrs["style"]) {
					for (const found of parseCssUrls(attrs["style"])) push(found, name, "style", "asset");
				}

				for (const rule of index.get(name) ?? []) {
					if (rule.level > filterLevel) continue;
					const value = attrs[rule.attr];
					if (value === undefined) continue;
					if (rule.unless?.(attrs)) continue;
					if (rule.attr === "srcset") {
						for (const candidate of parseSrcset(value)) push(candidate, name, rule.attr, rule.kind);
					} else {
						push(value, name, rule.attr, rule.kind);
					}
				}
			},
			ontext(text) {
				if (inStyle) styleText += text;
			},
			onclosetag(name) {
				if (name === "style" && inStyle) {
					inStyle = false;
					for (const found of parseCssUrls(styleText)) push(found, "style", "url()", "asset");
					styleText = "";
				}
			},
		},
		{ decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
	);
	parser.write(html);
	parser.end();

	return { links, ids };
}

/** Links referenced from a stylesheet body (level 3 only). */
export function parseCss(css: string, sheetUrl: string): DiscoveredLink[] {
	const links: DiscoveredLink[] = [];
	for (const found of parseCssUrls(css)) {
		const url = resolveLink(found, sheetUrl);
		if (url) links.push({ url: url.href, original: found, kind: "asset", tag: "css", attr: "url()" });
	}
	return links;
}
