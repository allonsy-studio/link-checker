/**
 * SPDX-License-Identifier: MPL-2.0
 */

import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * Resolves the package through its own `exports` map (Node self-reference), the same path a
 * consumer takes. Needs `yarn build` first; the message says so when `dist/` is missing.
 */
/** A non-literal specifier keeps the typechecker out of it; `dist/` does not exist until the build runs. */
const load = (specifier: string): Promise<Record<string, unknown>> => import(specifier);

describe("package exports", () => {
	it("resolves the main entry and its named exports", async () => {
		await access(new URL("../dist/index.js", import.meta.url)).catch(() => assert.fail("dist/ is missing: run `yarn build` before this test"));
		const mod = await load("@allons-y/link-checker");
		for (const name of ["check", "crawl", "loadConfig", "formatResults"]) {
			assert.equal(typeof mod[name], "function", `${name} is exported`);
		}
	});

	it("resolves the ./cypress subpath", async () => {
		const mod = await load("@allons-y/link-checker/cypress");
		assert.equal(typeof mod["registerLinkChecker"], "function");
	});

	it("ships type declarations for both entries", async () => {
		for (const file of ["../dist/index.d.ts", "../dist/cypress.d.ts"]) {
			await access(new URL(file, import.meta.url));
		}
	});
});
