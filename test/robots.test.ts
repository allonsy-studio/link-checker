/**
 * SPDX-License-Identifier: MPL-2.0
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RobotsCache, RobotsRules } from "../src/robots.ts";

const text = `
# comment
User-agent: *
Disallow: /private/
Allow: /private/public.html
Disallow: /*.pdf$

User-agent: allons-y-link-checker
Disallow: /only-for-us/
`;

describe("RobotsRules", () => {
	it("uses the wildcard group for unknown agents with longest-match precedence", () => {
		const rules = RobotsRules.parse(text, "SomeBot/1.0");
		assert.equal(rules.isAllowed(new URL("https://a.test/private/x.html")), false);
		assert.equal(rules.isAllowed(new URL("https://a.test/private/public.html")), true);
		assert.equal(rules.isAllowed(new URL("https://a.test/docs/file.pdf")), false);
		assert.equal(rules.isAllowed(new URL("https://a.test/docs/file.pdf?x")), true, "$ anchors the end");
		assert.equal(rules.isAllowed(new URL("https://a.test/")), true);
	});

	it("prefers the group that names this agent's product token", () => {
		const rules = RobotsRules.parse(text, "allons-y-link-checker/1.0 (+https://x)");
		assert.equal(rules.isAllowed(new URL("https://a.test/only-for-us/")), false);
		assert.equal(rules.isAllowed(new URL("https://a.test/private/x.html")), true, "the wildcard group no longer applies");
	});

	it("treats an empty or missing file as allow-all", () => {
		assert.equal(RobotsRules.parse("", "x").isAllowed(new URL("https://a.test/anything")), true);
		assert.equal(RobotsRules.allowAll().isAllowed(new URL("https://a.test/anything")), true);
	});
});

describe("RobotsCache", () => {
	it("fetches robots.txt once per origin and allows everything on failure", async () => {
		const calls: string[] = [];
		const cache = new RobotsCache(async (url) => {
			calls.push(url);
			return url.startsWith("https://blocked.test") ? { status: 200, text: "User-agent: *\nDisallow: /" } : undefined;
		}, "bot/1");
		const a = await cache.rulesFor(new URL("https://blocked.test/x"));
		const b = await cache.rulesFor(new URL("https://blocked.test/y"));
		const c = await cache.rulesFor(new URL("https://open.test/z"));
		assert.equal(a, b);
		assert.deepEqual(calls, ["https://blocked.test/robots.txt", "https://open.test/robots.txt"]);
		assert.equal(a.isAllowed(new URL("https://blocked.test/x")), false);
		assert.equal(c.isAllowed(new URL("https://open.test/z")), true);
	});
});
