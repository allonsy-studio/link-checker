/**
 * SPDX-License-Identifier: MPL-2.0
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatResults } from "../src/format.ts";
import type { LinkResult } from "../src/types.ts";

const result = (overrides: Partial<LinkResult>): LinkResult => ({
	url: "https://example.com/missing",
	original: "/missing",
	state: "broken",
	redirects: [],
	parents: [],
	kind: "link",
	internal: true,
	attempts: 1,
	durationMs: 5,
	...overrides,
});

describe("formatResults", () => {
	it("returns an empty string for an empty list", () => {
		assert.equal(formatResults([]), "");
	});

	it("formats a block with status, reason, and parent", () => {
		const text = formatResults([result({ status: 404, reason: "status 404", parents: ["https://example.com/"] })]);
		assert.equal(text, "BROKEN [404] https://example.com/missing\n  reason: status 404\n  on: https://example.com/");
	});

	it("omits the reason line when there is none and the bracket when there is no status", () => {
		const text = formatResults([result({ reason: "timeout" }), result({ url: "https://example.com/x", state: "warn" })]);
		assert.equal(text, "BROKEN https://example.com/missing\n  reason: timeout\n\nWARN https://example.com/x");
	});

	it("lists redirects as a chain", () => {
		const text = formatResults([result({ status: 404, redirects: ["https://a.test/1", "https://a.test/2"] })]);
		assert.equal(text, "BROKEN [404] https://example.com/missing\n  via: https://a.test/1 → https://a.test/2");
	});

	it("gives one parent line per parent, in order", () => {
		const text = formatResults([result({ status: 404, parents: ["https://example.com/", "https://example.com/about"] })]);
		assert.equal(text, "BROKEN [404] https://example.com/missing\n  on: https://example.com/\n  on: https://example.com/about");
	});
});
