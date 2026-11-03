# AGENTS.md

Guidance for coding agents working in this repository.

## What this package is

`@allons-y/link-checker` is a CLI and library that crawls a site for broken internal links, external links, and assets. It reads `.link-checker.config.yaml` by default and reports results to the console, as JSON, or as GitHub Actions annotations.

## Stack

- TypeScript (ESM, `"type": "module"`), compiled with `tsc` to `dist/`
- Node 24 or later (`engines.node` is `>=24`)
- Tests with `node:test` and `node:assert/strict`
- Lint and format with `opx` (`@allons-y/opx-cli`)
- Yarn 4 via Corepack (`packageManager` is pinned)

## Commands

- `yarn install`: install dependencies
- `yarn test`: run the test suite
- `yarn lint`: run opx lint (JS, JSON, Markdown, license headers)
- `yarn format`: apply lint fixes
- `yarn typecheck`: type-check `src/` and `test/` without emitting
- `yarn build`: compile `src/` to `dist/`
- `node dist/cli.js`: run the built CLI (build first)

## Code layout

- `src/cli.ts`: argument parsing, exit codes, and the entry point
- `src/config.ts`: config schema, defaults, YAML loading, and normalization
- `src/crawl.ts`: crawl loop that turns fetch outcomes into link results
- `src/fetcher.ts`: HTTP requests with retries, timeouts, and HEAD-to-GET fallback
- `src/index.ts`: public library exports
- `src/parser.ts`: HTML and CSS link extraction, with rules per filter level
- `src/robots.ts`: `robots.txt` parsing and exclusion checks
- `src/scheduler.ts`: per-host concurrency, rate limiting, and the work queue
- `src/server.ts`: static server for crawling a local build directory
- `src/types.ts`: shared types for results, states, and reporters
- `src/url.ts`: URL resolution, normalization, and exclusion matching
- `src/reporters/`: `console.ts`, `github.ts`, and `json.ts` output, plus the reporter registry in `index.ts`

## Conventions

- Every file in `src/` and `test/` starts with this block comment, after any shebang and a blank line:

  ```ts
  /**
   * SPDX-License-Identifier: MPL-2.0
   */
  ```

- Indent with tabs. Use double quotes, semicolons, and trailing commas on multiline literals.
- Use relative imports with the `.ts` extension, for example `./config.ts`. The build rewrites them.
- Do not add runtime dependencies. Dev dependencies need a clear reason.
- Every behavior change needs a test in `test/`. Use `fixture()` from `test/helpers.ts` for HTTP and `mkdtemp` in `os.tmpdir()` for files.
- Add a changeset (`yarn changeset`) for any change that affects consumers. Do not edit `.changeset/initial-release.md`.

## Commits and pull requests

Follow the studio rules in [AGENTS.md](https://github.com/allonsy-studio/.github/blob/main/AGENTS.md). In short:

- Write pronoun-free titles and bodies. Avoid "I", "we", and "our".
- Add no AI attribution of any kind: no `Co-Authored-By` trailer, no "Generated with" footer, no session links.
- Work on a feature branch and squash merge into `main`.
- Keep PR descriptions to one to three sentences, leading with a verb.

## Running against a site

`.link-checker.config.yaml` at the repository root targets `https://allons-y.studio` for manual smoke checks (`node dist/cli.js`); no workflow in this repository runs against a live site. `examples/nightly-link-check.yml` is a copyable workflow for a site's own repository. For anything heavier, build the target site locally and pass `--path` to serve the build directory.
