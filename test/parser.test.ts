/**
 * SPDX-License-Identifier: MPL-2.0
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCss, parseHtml } from "../src/parser.ts";
import { parseCssUrls, parseMetaRefresh, parseSrcset } from "../src/url.ts";

const page = "https://example.test/docs/";
const doc = `<!doctype html><html manifest="app.manifest"><head>
<base href="https://example.test/base/">
<link rel="stylesheet" href="site.css">
<link rel="icon" href="favicon.ico">
<link rel="preconnect" href="https://fonts.test">
<script src="app.js"></script>
<style>body { background: url("bg.png"); }</style>
<meta http-equiv="refresh" content="0; url=redirected.html">
</head><body background="paper.png" style="background-image:url('inline.png')">
<a href="page.html" id="first">one</a>
<a href="#section">anchor</a>
<a href="mailto:x@y.z">mail</a>
<area href="map.html">
<img src="a.png" srcset="a-1x.png 1x, a-2x.png 2x">
<picture><source srcset="b.webp" type="image/webp"></picture>
<video src="v.mp4" poster="p.jpg"><track src="t.vtt"></video>
<iframe src="frame.html" longdesc="desc.html"></iframe>
<object data="o.swf"></object>
<form action="submit"></form>
<blockquote cite="quote.html"></blockquote>
<input type="image" src="btn.png">
<h2 id="section">Section</h2>
</body></html>`;

const urls = (level: 0 | 1 | 2 | 3) => parseHtml(doc, page, level).links.map((l) => l.url);

describe("parseHtml", () => {
	it("level 0 finds clickable links and meta refresh, resolved against <base>", () => {
		assert.deepEqual(urls(0), ["https://example.test/base/redirected.html", "https://example.test/base/page.html", "https://example.test/base/map.html"]);
	});

	it("level 1 adds images, srcset candidates, and media", () => {
		const found = urls(1);
		for (const expected of ["a.png", "a-1x.png", "a-2x.png", "b.webp", "v.mp4", "p.jpg", "t.vtt", "frame.html", "o.swf"]) {
			assert.ok(found.includes(`https://example.test/base/${expected}`), `missing ${expected}`);
		}
		assert.ok(!found.some((u) => u.endsWith("site.css")), "stylesheets stay out at level 1");
		assert.ok(!found.some((u) => u.endsWith("app.js")), "scripts stay out at level 1");
	});

	it("level 2 adds every other link-like attribute except stylesheets and preconnect", () => {
		const found = urls(2);
		for (const expected of ["favicon.ico", "paper.png", "submit", "quote.html", "btn.png", "desc.html"]) {
			assert.ok(found.includes(`https://example.test/base/${expected}`), `missing ${expected}`);
		}
		assert.ok(found.includes("https://example.test/docs/app.manifest"), "attributes before <base> resolve against the page URL");
		assert.ok(!found.some((u) => u.includes("fonts.test")), "rel=preconnect is never checked");
		assert.ok(!found.some((u) => u.endsWith("site.css")));
	});

	it("level 3 adds scripts, stylesheets, and url() in style blocks and attributes", () => {
		const found = urls(3);
		for (const expected of ["site.css", "app.js", "bg.png", "inline.png"]) {
			assert.ok(found.includes(`https://example.test/base/${expected}`), `missing ${expected}`);
		}
	});

	it("collects element ids for fragment checks and skips non-http schemes", () => {
		const parsed = parseHtml(doc, page, 0);
		assert.ok(parsed.ids.has("section"));
		assert.ok(parsed.ids.has("first"));
		assert.ok(!parsed.links.some((l) => l.url.startsWith("mailto:")));
	});

	it("tags clickable links as link and everything else as asset", () => {
		const parsed = parseHtml(doc, page, 3);
		assert.equal(parsed.links.find((l) => l.url.endsWith("page.html"))?.kind, "link");
		assert.equal(parsed.links.find((l) => l.url.endsWith("a.png"))?.kind, "asset");
	});
});

describe("url helpers", () => {
	it("parses srcset candidates", () => {
		assert.deepEqual(parseSrcset("a.png 1x, b.png 2x,c.png 100w"), ["a.png", "b.png", "c.png"]);
	});

	it("parses css url() and @import", () => {
		assert.deepEqual(parseCssUrls("@import \"reset.css\"; a { background: url(x.png) } b { mask: url( 'y.svg' ) }"), ["x.png", "y.svg", "reset.css"]);
		assert.deepEqual(parseCss("a{background:url(../img.png)}", "https://s.test/css/site.css").map((l) => l.url), ["https://s.test/img.png"]);
	});

	it("parses meta refresh with and without quotes", () => {
		assert.equal(parseMetaRefresh("5; url=https://a.test/"), "https://a.test/");
		assert.equal(parseMetaRefresh("0;URL='/x'"), "/x");
		assert.equal(parseMetaRefresh("5"), undefined);
	});
});
