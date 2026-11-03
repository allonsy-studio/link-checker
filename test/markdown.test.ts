/**
 * SPDX-License-Identifier: MPL-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { resolveConfig } from "../src/config.ts";
import { check } from "../src/crawl.ts";
import { extractMarkdownLinks, markdownHeadingIds } from "../src/markdown.ts";
import type { LinkCheckerOptions, LinkResult } from "../src/types.ts";
import { fixture, html, type Fixture } from "./helpers.ts";

const base: LinkCheckerOptions = { honorRobotExclusions: false, retries: 0, timeout: 2000, maxSocketsPerHost: 4, maxSockets: 8 };
const urls = (text: string) => extractMarkdownLinks(text, "a.md").map((l) => l.url);

describe("extractMarkdownLinks", () => {
	it("reads inline links, titles, and angle-bracket destinations", () => {
		const found = extractMarkdownLinks('[a](https://a.test) [b](./b.md "Title") [c](<my file.md>)', "a.md");
		assert.deepEqual(
			found.map((l) => [l.url, l.kind]),
			[
				["https://a.test", "link"],
				["./b.md", "link"],
				["my file.md", "link"],
			],
		);
	});

	it("marks images as assets, including a linked image", () => {
		const found = extractMarkdownLinks("![alt](img/x.png)\n[![alt](img/y.png)](/page/)", "a.md");
		assert.deepEqual(
			found.map((l) => [l.url, l.kind, l.line]),
			[
				["img/x.png", "asset", 1],
				["/page/", "link", 2],
				["img/y.png", "asset", 2],
			],
		);
	});

	it("reads reference definitions, autolinks, and raw HTML attributes", () => {
		const found = extractMarkdownLinks("[id]: https://ref.test \"T\"\nSee <https://auto.test/x>.\n<a href=\"/a/\">a</a> <img src='/i.png'>", "a.md");
		assert.deepEqual(
			found.map((l) => [l.url, l.kind]),
			[
				["https://ref.test", "reference"],
				["https://auto.test/x", "link"],
				["/a/", "link"],
				["/i.png", "asset"],
			],
		);
	});

	it("skips fenced code blocks & inline code spans", () => {
		const text = ["[in](./in.md)", "```md", "[no](./fenced.md)", "```", "~~~", "[no](./tilde.md)", "~~~", "Use `[no](./span.md)` here, [yes](./out.md)."].join("\n");
		assert.deepEqual(urls(text), ["./in.md", "./out.md"]);
	});

	it("reports 1-based line numbers", () => {
		const found = extractMarkdownLinks("one\n\n[x](./x.md)\n```\n[y](./y.md)\n```\n[z](./z.md)", "a.md");
		assert.deepEqual(
			found.map((l) => l.line),
			[3, 7],
		);
	});
});

describe("markdownHeadingIds", () => {
	it("slugifies ATX headings the GitHub way", () => {
		const ids = markdownHeadingIds("# Hello, World!\n## Under_score & Co.\n### A-B  c ###");
		assert.ok(ids.has("hello-world"));
		assert.ok(ids.has("underscore--co"));
		assert.ok(ids.has("a-b--c"));
	});

	it("suffixes duplicates", () => {
		const ids = markdownHeadingIds("# Intro\n## Intro\n## Intro");
		assert.deepEqual([...ids], ["intro", "intro-1", "intro-2"]);
	});

	it("includes custom ids & HTML ids, and ignores code fences", () => {
		const ids = markdownHeadingIds('## Setup {#install}\n<div id="box"></div>\n```\n# Not a heading\n```');
		assert.ok(ids.has("install"));
		assert.ok(ids.has("setup"));
		assert.ok(ids.has("box"));
		assert.ok(!ids.has("not-a-heading"));
	});
});

describe("check with markdown sources", () => {
	let dir: string;
	let site: Fixture;
	let previous: string;
	const find = (results: LinkResult[], original: string) => results.find((r) => r.original === original);

	before(async () => {
		site = await fixture({ "/ok": { body: html("fine") }, "/about/": { body: html("about") } });
		dir = await mkdtemp(join(tmpdir(), "lc-md-"));
		await mkdir(join(dir, "src", "docs"), { recursive: true });
		await writeFile(join(dir, "src", "docs", "other.md"), "# Other\n\n## Real Section\n");
		await writeFile(join(dir, "src", "docs", "logo.png"), "x");
		await writeFile(
			join(dir, "src", "index.md"),
			[
				`[abs](${site.url}/ok)`,
				"[good](docs/other.md)",
				"[missing](docs/nope.md)",
				"[heading](docs/other.md#real-section)",
				"[bad heading](docs/other.md#nowhere)",
				"![logo](docs/logo.png)",
				"[about](/about/)",
				"[mail](mailto:a@b.test)",
			].join("\n"),
		);
		previous = process.cwd();
		process.chdir(dir);
	});

	after(async () => {
		process.chdir(previous);
		await site.close();
		await rm(dir, { recursive: true, force: true });
	});

	it("checks files, headings, & absolute URLs; skips root-relative links without a url", async () => {
		const summary = await check({ ...base, markdown: ["src/**/*.md"], checkFragments: true });
		const { results } = summary;
		assert.equal(find(results, `${site.url}/ok`)?.state, "ok");
		assert.deepEqual(find(results, `${site.url}/ok`)?.parents, ["src/index.md:1"]);
		assert.equal(find(results, "docs/other.md")?.state, "ok");
		assert.equal(find(results, "docs/nope.md")?.state, "broken");
		assert.equal(find(results, "docs/nope.md")?.reason, "file not found");
		assert.equal(find(results, "docs/other.md#real-section")?.state, "ok");
		const bad = find(results, "docs/other.md#nowhere");
		assert.equal(bad?.state, "broken");
		assert.equal(bad?.reason, 'no heading with id "nowhere"');
		const logo = find(results, "docs/logo.png");
		assert.equal(logo?.state, "ok");
		assert.equal(logo?.kind, "asset");
		assert.equal(logo?.internal, true);
		const root = find(results, "/about/");
		assert.equal(root?.state, "skipped");
		assert.equal(root?.reason, "no url or path to resolve root-relative links against");
		assert.equal(find(results, "mailto:a@b.test"), undefined);
		assert.equal(summary.passed, false);
	});

	it("does not check fragments unless asked", async () => {
		const { results } = await check({ ...base, markdown: ["src/**/*.md"] });
		assert.equal(find(results, "docs/other.md#nowhere")?.state, "ok");
	});

	it("resolves root-relative links against url", async () => {
		const { results } = await check({ ...base, url: `${site.url}/ok`, markdown: ["src/index.md"] });
		const about = results.find((r) => r.url === `${site.url}/about/`);
		assert.equal(about?.state, "ok");
		assert.deepEqual(about?.parents, ["src/index.md:7"]);
	});
});

describe("markdown config", () => {
	it("makes url & path optional, but keeps them mutually exclusive", () => {
		assert.deepEqual(resolveConfig({ markdown: ["*.md"] }).markdown, ["*.md"]);
		assert.throws(() => resolveConfig({}), /url. or .path./);
		assert.throws(() => resolveConfig({ markdown: ["*.md"], url: "https://a.test", path: "." }), /mutually exclusive/);
	});
});
