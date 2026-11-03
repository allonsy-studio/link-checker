/**
 * SPDX-License-Identifier: MPL-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { check } from "../src/crawl.ts";
import type { LinkCheckerOptions, LinkResult } from "../src/types.ts";
import { fixture, html, type Fixture } from "./helpers.ts";

const byUrl = (results: LinkResult[], suffix: string) => results.find((r) => r.url.endsWith(suffix));
const base: LinkCheckerOptions = { honorRobotExclusions: false, retries: 0, timeout: 2000, maxSocketsPerHost: 4, maxSockets: 8 };

describe("crawl", () => {
	let site: Fixture;
	let external: Fixture;

	before(async () => {
		external = await fixture({
			"/ok": { body: "fine" },
			"/gone": { status: 404 },
			"/head-hostile": (req, res) => {
				if (req.method === "HEAD") {
					res.writeHead(405);
					res.end();
					return;
				}
				res.writeHead(200, { "content-type": "text/plain" });
				res.end("ok via GET");
			},
			"/flaky": (() => {
				let n = 0;
				return (_req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
					n += 1;
					if (n === 1) {
						res.writeHead(429, { "retry-after": "0" });
						res.end();
						return;
					}
					res.writeHead(200);
					res.end("ok");
				};
			})(),
			"/forbidden": { status: 403 },
			"/moved": { status: 301, headers: { location: "/ok" } },
		});
		site = await fixture({
			"/": {
				body: html(`
					<a href="/about">about</a>
					<a href="/about">about again</a>
					<a href="/missing">missing</a>
					<a href="/about#intro">intro</a>
					<a href="/about#nope">nope</a>
					<img src="/img/logo.png"><img src="/img/absent.png">
					<a href="${external.url}/ok">ext ok</a>
					<a href="${external.url}/gone">ext gone</a>
					<a href="${external.url}/head-hostile">hostile</a>
					<a href="${external.url}/flaky">flaky</a>
					<a href="${external.url}/forbidden">forbidden</a>
					<a href="${external.url}/moved">moved</a>
					<a href="https://skipped.example/x">skipped</a>
					<a href="/private/secret">secret</a>
					<link rel="stylesheet" href="/site.css">
				`),
			},
			"/about": { body: html("<h1 id=\"intro\">About</h1><a href=\"/\">home</a><a href=\"/missing\">missing again</a>") },
			"/img/logo.png": { body: "png", headers: { "content-type": "image/png" } },
			"/site.css": { body: "a { background: url(/img/from-css.png) }", headers: { "content-type": "text/css" } },
			"/img/from-css.png": { body: "png", headers: { "content-type": "image/png" } },
			"/private/secret": { body: "secret" },
			"/robots.txt": { body: "User-agent: *\nDisallow: /private/\n" },
		});
	});

	beforeEach(() => {
		site.hits.length = 0;
		external.hits.length = 0;
	});

	after(async () => {
		await site.close();
		await external.close();
	});

	it("finds broken internal and external links with every parent page", async () => {
		const summary = await check({ ...base, url: site.url, excludedKeywords: ["skipped.example"] });
		assert.equal(summary.passed, false);

		const missing = byUrl(summary.results, "/missing")!;
		assert.equal(missing.state, "broken");
		assert.equal(missing.status, 404);
		assert.deepEqual(missing.parents.sort(), [`${site.url}/`, `${site.url}/about`]);

		assert.equal(byUrl(summary.results, "/about")?.state, "ok");
		assert.equal(byUrl(summary.results, "/img/logo.png")?.state, "ok");
		assert.equal(byUrl(summary.results, "/img/absent.png")?.state, "broken");
		assert.equal(byUrl(summary.results, "/gone")?.state, "broken");
		assert.equal(byUrl(summary.results, "/forbidden")?.state, "broken");

		const skipped = byUrl(summary.results, "skipped.example/x")!;
		assert.equal(skipped.state, "skipped");
		assert.match(skipped.reason ?? "", /keyword/);

		const seen = summary.results.map((r) => r.url);
		assert.equal(new Set(seen).size, seen.length, "each URL is reported once");
		assert.ok(!seen.some((u) => u.endsWith("/site.css")), "stylesheets are not checked at level 1");
	});

	it("falls back to GET on 405, retries 429, and records redirects", async () => {
		let hits = 0;
		const flakyHost = await fixture({
			"/flaky": (_req, res) => {
				hits += 1;
				res.writeHead(hits === 1 ? 429 : 200, hits === 1 ? { "retry-after": "0" } : {});
				res.end();
			},
		});
		let summary;
		try {
			summary = await check({ ...base, url: site.url, retries: 1, excludedKeywords: [] }, {});
			const alone = await check({ ...base, url: `${flakyHost.url}/flaky`, retries: 1 });
			const flaky = byUrl(alone.results, "/flaky")!;
			assert.equal(flaky.state, "ok");
			assert.equal(flaky.attempts, 2);
		} finally {
			await flakyHost.close();
		}
		assert.equal(byUrl(summary.results, "/head-hostile")?.state, "ok");
		const moved = byUrl(summary.results, "/moved")!;
		assert.equal(moved.state, "ok");
		assert.deepEqual(moved.redirects, [`${external.url}/ok`]);
	});

	it("applies redirect policy and per-status overrides", async () => {
		const summary = await check({ ...base, url: site.url, redirects: "warn", statusCodes: { "403": "warn", "404": "ok" } });
		assert.equal(byUrl(summary.results, "/moved")?.state, "warn");
		assert.equal(byUrl(summary.results, "/forbidden")?.state, "warn");
		assert.equal(byUrl(summary.results, "/gone")?.state, "ok");
		assert.equal(byUrl(summary.results, "/missing")?.state, "ok");
	});

	it("honors robots.txt and reports the skip", async () => {
		const summary = await check({ ...base, url: site.url, honorRobotExclusions: true });
		const secret = byUrl(summary.results, "/private/secret")!;
		assert.equal(secret.state, "skipped");
		assert.match(secret.reason ?? "", /robots/);
		assert.ok(!site.hits.some((h) => h.path === "/private/secret"), "never requested");
		assert.ok(site.hits.some((h) => h.path === "/robots.txt"));
	});

	it("level 3 follows url() in stylesheets", async () => {
		const summary = await check({ ...base, url: site.url, filterLevel: 3 });
		assert.equal(byUrl(summary.results, "/site.css")?.state, "ok");
		assert.equal(byUrl(summary.results, "/img/from-css.png")?.state, "ok");
	});

	it("checks fragments on internal pages", async () => {
		const summary = await check({ ...base, url: site.url, checkFragments: true });
		const bad = summary.results.find((r) => r.url.endsWith("/about#nope"))!;
		assert.equal(bad.state, "broken");
		assert.match(bad.reason ?? "", /id "nope"/);
		assert.ok(!summary.results.some((r) => r.url.endsWith("/about#intro")), "existing fragments produce no result");
	});

	it("checkExternal: false skips off-origin links; checkInternal: false quiets same-origin results", async () => {
		const ext = await check({ ...base, url: site.url, checkExternal: false });
		assert.equal(byUrl(ext.results, "/gone")?.state, "skipped");
		assert.ok(!external.hits.some((h) => h.path === "/gone"), "external hosts are not contacted");

		const int = await check({ ...base, url: site.url, checkInternal: false });
		assert.equal(byUrl(int.results, "/missing")?.state, "skipped");
		assert.equal(byUrl(int.results, "/gone")?.state, "broken", "external links still count");
		assert.ok(int.results.filter((r) => r.state === "broken").every((r) => !r.internal), "only external links are reported broken");
	});

	it("sends the configured user agent and respects maxDepth", async () => {
		const summary = await check({ ...base, url: site.url, userAgent: "test-agent/9", maxDepth: 0 });
		assert.ok(site.hits.every((h) => h.ua === "test-agent/9"));
		assert.equal(byUrl(summary.results, "/about")?.kind, "link", "depth 1 pages are checked but not crawled");
		assert.ok(!site.hits.some((h) => h.path === "/about" && h.method === "GET"));
	});

	it("rate-limits requests to one host", async () => {
		const slow = await fixture({
			"/": { body: html("<a href=\"/a\">a</a><a href=\"/b\">b</a><a href=\"/c\">c</a>") },
			"/a": { body: "a" },
			"/b": { body: "b" },
			"/c": { body: "c" },
		});
		const started = Date.now();
		try {
			await check({ ...base, url: slow.url, rateLimit: 120, maxSocketsPerHost: 1 });
		} finally {
			await slow.close();
		}
		assert.ok(Date.now() - started >= 3 * 120, "four requests at 120ms spacing take at least 360ms");
	});

	it("serves a local build directory with clean URLs", async () => {
		const dir = await mkdtemp(join(tmpdir(), "lc-site-"));
		await mkdir(join(dir, "about"));
		await writeFile(join(dir, "index.html"), html("<a href=\"/about/\">about</a><a href=\"/contact\">contact</a><a href=\"/nope\">nope</a>"));
		await writeFile(join(dir, "about", "index.html"), html("<a href=\"/\">home</a>"));
		await writeFile(join(dir, "contact.html"), html("contact"));
		const summary = await check({ ...base, path: dir });
		assert.equal(byUrl(summary.results, "/about/")?.state, "ok");
		assert.equal(byUrl(summary.results, "/contact")?.state, "ok");
		assert.equal(byUrl(summary.results, "/nope")?.state, "broken");
	});

	it("aborts on signal", async () => {
		const controller = new AbortController();
		controller.abort();
		const summary = await check({ ...base, url: site.url }, { signal: controller.signal });
		assert.ok(summary.results.length <= 1);
	});
});
