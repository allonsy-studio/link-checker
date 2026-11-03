<p align="center">
<a href="https://allons-y.studio">
    <img id="user-content-logo" src="https://raw.githubusercontent.com/allonsy-studio/.github/main/assets/png/oss-banner.png" alt="Brought to you by Allons-y Studio" width="1500">
</a>
</p>

<h1 align="center" border="none">link-checker</h1>

<p align="center">
  <img src="https://github.com/allonsy-studio/.github/blob/main/assets/tag-rule.gif" alt="" height="30" />
</p>

<p align="center"><b>Crawls a site for broken internal links, external links, & assets. Reads <code>.link-checker.config.yaml</code> by default.</b></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@allons-y/link-checker">
    <img src="https://img.shields.io/npm/v/@allons-y/link-checker.svg" alt="NPM version" height="20" />
  </a>
  <a href="https://www.npmjs.com/package/@allons-y/link-checker">
    <img src="https://img.shields.io/npm/dw/@allons-y/link-checker.svg" alt="NPM downloads" height="20" />
  </a>
  <a href="https://github.com/allonsy-studio/link-checker/actions/workflows/ci.yml">
    <img src="https://github.com/allonsy-studio/link-checker/actions/workflows/ci.yml/badge.svg?branch=main" alt="Tests" height="20" />
  </a>
  <a href="https://github.com/allonsy-studio/link-checker/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/allonsy-studio/link-checker.svg" alt="License" height="20" />
  </a>
  <a href="https://allons-y.studio">
    <img src="https://github.com/allonsy-studio/.github/blob/main/assets/svg/badge.svg" alt="Brought to you by Allons-y Studio" height="20" />
  </a>
</p>

One run covers three things that usually take two tools: same-origin pages, outbound links, & the images, media, scripts, & stylesheets those pages reference. It stays off blocklists by default: one connection per host, a configurable gap between requests, `robots.txt` honored, & `HEAD` wherever that is enough.

- Zero config: drop a `.link-checker.config.yaml` next to `package.json` & run `link-checker`.
- Crawls a live URL or serves a local build directory for the run.
- Every broken link reports the page (or pages) it was found on.
- Two runtime dependencies (`yaml`, `htmlparser2`); everything else is built into Node.
- Console, JSON, & GitHub Actions reporters.

## Install

```bash
yarn add -D @allons-y/link-checker
# or
npm install --save-dev @allons-y/link-checker
```

Requires Node 24 or later.

## Usage

```bash
npx link-checker                                  # reads .link-checker.config.yaml from the current directory
npx link-checker https://example.com              # a positional URL overrides the file
npx link-checker --path ./_site --filter-level 3  # serve a local build, check scripts & stylesheets too
npx link-checker --reporter github --strict       # CI annotations; warnings also fail the run
npx link-checker --reporter json --output links.json
```

Every config key below has a flag of the same name in kebab-case (`--max-sockets-per-host 2`). Boolean keys take `--no-` for false (`--no-check-external`). `--help` prints the full list.

Exit codes: `0` no broken links, `1` broken links found, `2` configuration or startup error.

## Configuration

The first of `.link-checker.config.yaml`, `.link-checker.config.yml`, `.link-checker.config.json`, `.link-checker.config.js`, `.link-checker.config.mjs`, or `.link-checker.config.cjs` found in the working directory is used; the shorter `.link-checker.<ext>` is accepted too and checked after them. The older `.checklinks[.config].<ext>` names still load with a deprecation notice. `--config <path>` picks a file by its extension instead, and CLI flags override file values.

```yaml
url: https://example.com

# Plain substrings, not globs: a URL containing one is skipped
excludedKeywords:
  - localhost
  - linkedin.com

# 0 = clickable links only  1 = clickable + srcset/media (default)
# 2 = all link-like attrs   3 = all + scripts/stylesheets
filterLevel: 1

honorRobotExclusions: true
maxSocketsPerHost: 1
rateLimit: 0
requestMethod: head
```

JavaScript configs export the same object as the default export (a function returning it, sync or async, works too):

```js
// .link-checker.config.mjs (also .js and .cjs)
// Only the default export is read; a function export is called and awaited.
export default {
	url: "https://example.com",
	excludedKeywords: ["localhost"],
};
```

| Key                    | Type                         | Default                           | Meaning                                                                                                             |
| ---------------------- | ---------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `url`                  | string                       | required unless `path` is set     | Live site to crawl                                                                                                  |
| `path`                 | string                       |                                   | Local build directory, served on a random port with clean URLs (`/about` → `/about/index.html` or `/about.html`)   |
| `excludedKeywords`     | string[]                     | `[]`                              | Plain substrings; a URL containing one is skipped                                                                   |
| `excludedPatterns`     | string[]                     | `[]`                              | Regular expressions for what substrings can't express                                                               |
| `filterLevel`          | 0–3                          | `1`                               | Which elements to scan (see below)                                                                                  |
| `honorRobotExclusions` | boolean                      | `true`                            | Fetch `/robots.txt` once per host & skip disallowed URLs                                                            |
| `maxSocketsPerHost`    | number                       | `1`                               | Concurrent requests to any single host                                                                              |
| `maxSockets`           | number                       | `10`                              | Concurrent requests overall                                                                                         |
| `rateLimit`            | ms                           | `0`                               | Minimum gap between requests to the same host                                                                       |
| `requestMethod`        | `head` \| `get`              | `head`                            | HEAD first, GET when HEAD is refused or returns an error                                                            |
| `timeout`              | ms                           | `15000`                           | Per-request timeout                                                                                                 |
| `retries`              | number                       | `2`                               | Retries on 429 (honoring `retry-after`), 5xx, & network errors, with backoff                                       |
| `maxDepth`             | number                       | unlimited                         | How many links deep to follow from `url`                                                                            |
| `checkInternal`        | boolean                      | `true`                            | Report same-origin links & assets (pages are still crawled when false)                                             |
| `checkExternal`        | boolean                      | `true`                            | Check off-origin links                                                                                              |
| `checkFragments`       | boolean                      | `false`                           | Verify `#id` targets exist on internal pages                                                                        |
| `sitemap`              | boolean \| string            | `false`                           | Seed the crawl from `/sitemap.xml` or a given sitemap URL                                                           |
| `redirects`            | `allow` \| `warn` \| `error` | `allow`                           | What a redirected link means                                                                                        |
| `statusCodes`          | map                          | `{}`                              | Per-status override, e.g. `403: warn` for hosts that block bots                                                     |
| `headers`              | map                          | `{}`                              | Extra request headers                                                                                               |
| `userAgent`            | string                       | `allons-y-link-checker/<version>` | Sent on every request                                                                                               |
| `reporters`            | string[]                     | `[console]`                       | `console`, `json`, `github`                                                                                         |
| `output`               | string                       |                                   | File path for the `json` reporter                                                                                   |
| `strict`               | boolean                      | `false`                           | Warnings also fail the run                                                                                          |

The older `internal`, `excludeExternalLinks`, & `excludeInternalLinks` keys from `broken-link-checker` still load, with a deprecation notice.

### Filter levels

Each level includes everything below it.

| Level | Adds                      | Elements & attributes                                                                                                                                                  |
| ----- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Clickable links           | `a[href]`, `area[href]`, `meta[http-equiv=refresh]`                                                                                                                    |
| 1     | Images & media            | `img[src, srcset]`, `source[src, srcset]`, `video[src, poster]`, `audio[src]`, `track[src]`, `iframe[src]`, `embed[src]`, `object[data]`                                |
| 2     | Other link-like attributes | `link[href]` except stylesheets, `form[action]`, `blockquote/q/del/ins[cite]`, `input[src]`, `body[background]`, `html[manifest]`, `iframe[longdesc]`                  |
| 3     | Code & styles             | `script[src]`, `link[rel=stylesheet]`, `url()` inside `<style>` & `style=""`, & `url()` / `@import` inside same-origin stylesheets                                     |

At every level: `<base href>` is honored, `mailto:`, `tel:`, `javascript:`, `data:`, & `rel="preconnect" / "dns-prefetch"` are never checked, each unique URL is requested once per run, & only same-origin HTML pages are crawled.

## Programmatic use

```js
import { check, crawl, loadConfig } from "@allons-y/link-checker";

// One shot: resolves when the crawl is done.
const { passed, counts, results } = await check({ url: "https://example.com", checkExternal: false });

// Streaming: an async iterable of results as they resolve.
for await (const result of crawl(await loadConfig())) {
	if (result.state === "broken") console.log(result.url, result.parents);
}
```

Both take the same keys as the YAML file plus an optional `{ signal }` for cancellation. `check()` runs silently, which makes it a one-line assertion inside Playwright, Vitest, node:test, or ava:

```js
const summary = await check({ path: "./_site", checkExternal: false });
assert.equal(summary.counts.broken, 0);
```

Each result:

```ts
interface LinkResult {
	url: string;            // as resolved
	original: string;       // as written in the page
	state: "ok" | "warn" | "broken" | "skipped";
	status?: number;        // HTTP status of the final response
	reason?: string;        // "disallowed by robots.txt", "status 404", "timeout", ...
	redirects: string[];    // Location headers followed
	parents: string[];      // every page that linked here
	kind: "page" | "link" | "asset";
	internal: boolean;
	attempts: number;
	durationMs: number;
}
```

## Inside a test suite

`summary.broken` & `summary.warnings` hold the matching results, and `formatResults()` turns a list into plain text for an assertion message.

With node:test:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { check, formatResults } from "@allons-y/link-checker";

test("the built site has no broken links", async () => {
	const summary = await check({ path: "./_site", checkExternal: false });
	assert.equal(summary.broken.length, 0, formatResults(summary.broken));
});
```

With Vitest:

```js
import { expect, it } from "vitest";
import { check, formatResults } from "@allons-y/link-checker";

it("has no broken links", async () => {
	const summary = await check({ path: "./_site", checkExternal: false });
	expect(summary.broken, formatResults(summary.broken)).toEqual([]);
});
```

With Cypress, register the task once in `cypress.config.js`:

```js
import { defineConfig } from "cypress";
import { registerLinkChecker } from "@allons-y/link-checker/cypress";

export default defineConfig({
	e2e: {
		baseUrl: "http://localhost:8080",
		setupNodeEvents(on) {
			registerLinkChecker(on, { checkExternal: false });
		},
	},
});
```

Then call it from a spec. Specs run in the browser, so they cannot import `formatResults`; the message here lists the broken URLs instead:

```js
it("has no broken links", () => {
	cy.task("checkLinks", { url: Cypress.config("baseUrl") }).then((summary) => {
		expect(summary.broken, summary.broken.map((r) => r.url).join("\n")).to.be.empty;
	});
});
```

Run the suite with `checkExternal: false` so each test run stays fast and independent of other sites, and run the full crawl, external links included, in a scheduled job. The package is ESM-only, so Jest needs `--experimental-vm-modules`, while Vitest, node:test, & ava work as is.

## GitHub Actions

```yaml
- run: npx link-checker --reporter github
  env:
    FORCE_COLOR: 0
```

Broken links become `::error` annotations, warnings become `::warning`, & a table lands in the job summary. For a scheduled check of a live site, copy [`examples/nightly-link-check.yml`](examples/nightly-link-check.yml) into the site's own repository.

## Contributing

```bash
yarn install
yarn test        # builds, then node:test against local fixture servers; no network
yarn lint        # opx: ESLint, JSON, Markdown
yarn typecheck
yarn build       # tsc → dist/
```

Run `yarn changeset` for any change that affects consumers. See [CONTRIBUTING](https://github.com/allonsy-studio/.github/blob/main/CONTRIBUTING.md) & the [Code of Conduct](https://github.com/allonsy-studio/.github/blob/main/CODE_OF_CONDUCT.md).

## License

[MPL-2.0](LICENSE): use freely, modify as needed; changes to MPL-licensed files should be shared back under the same license.

---

<sub> Built and maintained by [Allons-y Studio](https://allons-y.studio) — a North Carolina-based studio specializing in design systems, front-end architecture, and accessibility. Available to work on your next big project. </sub>
