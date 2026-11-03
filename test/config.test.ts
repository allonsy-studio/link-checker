/**
 * SPDX-License-Identifier: MPL-2.0
 */

import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ConfigError, defaults, findConfigFile, loadConfig, normalize, resolveConfig } from "../src/config.ts";

const yaml = `# broken-link-checker configuration
url: https://allons-y.studio
excludedKeywords:
  - localhost
  - codepen.io
filterLevel: 1
honorRobotExclusions: true
maxSocketsPerHost: 1
rateLimit: 0
requestMethod: head
internal: false
`;

describe("config", () => {
	it("reads the existing .link-checker.config.yaml unchanged and maps deprecated keys", async () => {
		const dir = await mkdtemp(join(tmpdir(), "lc-"));
		await writeFile(join(dir, ".link-checker.config.yaml"), yaml);
		const warnings: string[] = [];
		const config = await loadConfig({ cwd: dir, warn: (m) => warnings.push(m) });
		assert.equal(config.url, "https://allons-y.studio");
		assert.deepEqual(config.excludedKeywords, ["localhost", "codepen.io"]);
		assert.equal(config.filterLevel, 1);
		assert.equal(config.requestMethod, "head");
		assert.equal(config.checkInternal, false, "`internal: false` maps onto checkInternal");
		assert.equal(config.maxSockets, 10, "untouched keys take defaults");
		assert.match(warnings[0] ?? "", /deprecated/);
	});

	it("falls back to .yml and then to overrides alone", async () => {
		const dir = await mkdtemp(join(tmpdir(), "lc-"));
		await writeFile(join(dir, ".link-checker.config.yml"), "url: https://a.test\nretries: 0\n");
		const config = await loadConfig({ cwd: dir, overrides: { retries: 5 } });
		assert.equal(config.retries, 5, "overrides win over the file");
		const bare = await loadConfig({ cwd: await mkdtemp(join(tmpdir(), "lc-")), overrides: { url: "https://b.test" } });
		assert.equal(bare.url, "https://b.test");
	});

	it("looks up .yaml before .json", async () => {
		const dir = await mkdtemp(join(tmpdir(), "lc-"));
		await writeFile(join(dir, ".link-checker.config.json"), JSON.stringify({ url: "https://json.test" }));
		await writeFile(join(dir, ".link-checker.config.yaml"), "url: https://yaml.test\n");
		assert.equal(await findConfigFile(undefined, dir), join(dir, ".link-checker.config.yaml"));
		const config = await loadConfig({ cwd: dir });
		assert.equal(config.url, "https://yaml.test");
	});

	it("accepts the shorter .link-checker.<ext> name after the .config form", async () => {
		const dir = await mkdtemp(join(tmpdir(), "lc-"));
		await writeFile(join(dir, ".link-checker.yml"), "url: https://short.test\n");
		assert.equal(await findConfigFile(undefined, dir), join(dir, ".link-checker.yml"));
		await writeFile(join(dir, ".link-checker.config.json"), JSON.stringify({ url: "https://long.test" }));
		assert.equal(await findConfigFile(undefined, dir), join(dir, ".link-checker.config.json"), ".config names win over short names");
	});

	it("still reads the legacy .checklinks names, with a deprecation notice", async () => {
		const dir = await mkdtemp(join(tmpdir(), "lc-"));
		await writeFile(join(dir, ".checklinks.config.yaml"), "url: https://legacy.test\n");
		const warnings: string[] = [];
		const config = await loadConfig({ cwd: dir, warn: (m) => warnings.push(m) });
		assert.equal(config.url, "https://legacy.test");
		assert.match(warnings.join("\n"), /\.checklinks\.config\.yaml.*deprecated/);
	});

	it("loads a JSON config", async () => {
		const dir = await mkdtemp(join(tmpdir(), "lc-"));
		await writeFile(join(dir, ".link-checker.config.json"), JSON.stringify({ url: "https://json.test", excludedKeywords: ["localhost"], retries: 4 }));
		const config = await loadConfig({ cwd: dir });
		assert.equal(config.url, "https://json.test");
		assert.deepEqual(config.excludedKeywords, ["localhost"]);
		assert.equal(config.retries, 4);
	});

	it("loads a .mjs config with an object default export", async () => {
		const dir = await mkdtemp(join(tmpdir(), "lc-"));
		await writeFile(join(dir, ".link-checker.config.mjs"), "export default { url: \"https://mjs.test\", excludedKeywords: [\"localhost\"] };\n");
		const config = await loadConfig({ cwd: dir });
		assert.equal(config.url, "https://mjs.test");
		assert.deepEqual(config.excludedKeywords, ["localhost"]);
	});

	it("awaits an async function default export", async () => {
		const dir = await mkdtemp(join(tmpdir(), "lc-"));
		await writeFile(join(dir, ".link-checker.config.mjs"), "export default async () => ({ url: \"https://async.test\", retries: 0 });\n");
		const config = await loadConfig({ cwd: dir });
		assert.equal(config.url, "https://async.test");
		assert.equal(config.retries, 0);
	});

	it("rejects a JS config whose export is not an object", async () => {
		const dir = await mkdtemp(join(tmpdir(), "lc-"));
		const file = join(dir, ".link-checker.config.mjs");
		await writeFile(file, "export default \"https://nope.test\";\n");
		await assert.rejects(loadConfig({ cwd: dir }), (error: unknown) => error instanceof ConfigError && error.message.includes(file) && /config object/.test(error.message));
	});

	it("rejects a config file with an unknown extension", async () => {
		const dir = await mkdtemp(join(tmpdir(), "lc-"));
		const file = join(dir, "link-checker.toml");
		await writeFile(file, "url = \"https://toml.test\"\n");
		await assert.rejects(loadConfig({ cwd: dir, config: file }), (error: unknown) => error instanceof ConfigError && /unsupported config format/.test(error.message));
	});

	it("rejects unknown keys, bad values, and missing url/path", () => {
		assert.throws(() => normalize({ nope: 1 }), ConfigError);
		assert.throws(() => normalize({ filterLevel: 7 }), /0, 1, 2, or 3/);
		assert.throws(() => normalize({ redirects: "maybe" }), /allow, warn, error/);
		assert.throws(() => resolveConfig({}), /url.*path/);
		assert.throws(() => resolveConfig({ url: "https://a.test", path: "." }), /mutually exclusive/);
		assert.throws(() => resolveConfig({ url: "ftp://a.test" }), /http/);
		assert.throws(() => resolveConfig({ url: "https://a.test", excludedPatterns: ["("] }), /regular expression/);
		assert.throws(() => resolveConfig({ url: "https://a.test", statusCodes: { "40x": "warn" } }), /3-digit/);
	});

	it("coerces CLI strings onto schema types", () => {
		const out = normalize({ filterLevel: "3", rateLimit: "250", checkFragments: "true", excludedKeywords: "x" });
		assert.deepEqual(out, { filterLevel: 3, rateLimit: 250, checkFragments: true, excludedKeywords: ["x"] });
	});

	it("has every default documented", () => {
		const d = defaults();
		assert.equal(d.filterLevel, 1);
		assert.equal(d.maxSocketsPerHost, 1);
		assert.equal(d.requestMethod, "head");
		assert.match(d.userAgent, /^allons-y-link-checker\/\d/);
	});
});
