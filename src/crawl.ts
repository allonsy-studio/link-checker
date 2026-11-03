/**
 * SPDX-License-Identifier: MPL-2.0
 */

import { setTimeout as sleep } from "node:timers/promises";

import { resolveConfig } from "./config.ts";
import { Fetcher, type FetchOutcome } from "./fetcher.ts";
import { parseCss, parseHtml } from "./parser.ts";
import { RobotsCache } from "./robots.ts";
import { AsyncQueue, Scheduler, Signal, type Task } from "./scheduler.ts";
import { serveDirectory } from "./server.ts";
import type { CheckSummary, CrawlOptions, DiscoveredLink, LinkCheckerConfig, LinkCheckerOptions, LinkResult, LinkState } from "./types.ts";
import { compilePatterns, isExcluded, isSameOrigin, normalizeUrl, resolveLink } from "./url.ts";

const HTML_TYPE = /^(?:text\/html|application\/xhtml\+xml)\b/i;
const CSS_TYPE = /^text\/css\b/i;

/** Map a fetch outcome onto a result state, applying the redirect policy and per-status overrides. */
function classify(outcome: FetchOutcome, config: LinkCheckerConfig): { state: LinkState; reason?: string } {
	if (outcome.error) return { state: "broken", reason: outcome.error };
	const status = outcome.status ?? 0;
	const override = config.statusCodes[String(status)];
	if (override === "ok") return { state: "ok" };
	if (override === "warn") return { state: "warn", reason: `status ${status} (configured as warn)` };
	if (override === "error") return { state: "broken", reason: `status ${status} (configured as error)` };
	if (status >= 200 && status < 300) {
		if (outcome.redirects.length > 0 && config.redirects !== "allow") {
			return { state: config.redirects === "warn" ? "warn" : "broken", reason: `redirected to ${outcome.url}` };
		}
		return { state: "ok" };
	}
	if (status >= 300 && status < 400) return { state: "broken", reason: `redirect without a location (${status})` };
	return { state: "broken", reason: `status ${status}` };
}

async function seedsFromSitemap(fetcher: Fetcher, base: URL, config: LinkCheckerConfig, signal?: AbortSignal): Promise<string[]> {
	const start = typeof config.sitemap === "string" ? config.sitemap : new URL("/sitemap.xml", base).href;
	const seen = new Set<string>();
	const pages: string[] = [];
	const queue = [start];
	while (queue.length > 0 && seen.size < 50) {
		const url = queue.shift()!;
		if (seen.has(url)) continue;
		seen.add(url);
		const response = await fetcher.getText(url, signal);
		if (!response || response.status !== 200) continue;
		const locs = [...response.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!);
		if (/<sitemapindex\b/i.test(response.text)) queue.push(...locs);
		else pages.push(...locs);
	}
	return pages;
}

/**
 * Crawl a site and yield one `LinkResult` per unique URL as each resolves.
 * Accepts the same shape as `.checklinks.config.yaml`; missing keys take their defaults.
 */
export async function* crawl(options: LinkCheckerOptions, crawlOptions: CrawlOptions = {}): AsyncGenerator<LinkResult, void, undefined> {
	const config = resolveConfig(options);
	const { signal } = crawlOptions;
	const out = new AsyncQueue<LinkResult>();

	run(config, out, crawlOptions).then(
		() => out.close(),
		(error) => out.fail(error),
	);

	for await (const result of out) {
		if (signal?.aborted) return;
		yield result;
	}
}

/** Run a crawl to completion and return the collected results with a summary. */
export async function check(options: LinkCheckerOptions, crawlOptions: CrawlOptions = {}): Promise<CheckSummary> {
	const config = resolveConfig(options);
	const started = Date.now();
	const results: LinkResult[] = [];
	const counts: Record<LinkState, number> = { ok: 0, warn: 0, broken: 0, skipped: 0 };
	for await (const result of crawl(config, crawlOptions)) {
		results.push(result);
		counts[result.state] += 1;
	}
	const passed = counts.broken === 0 && (!config.strict || counts.warn === 0);
	return { passed, counts, durationMs: Date.now() - started, results };
}

async function run(config: LinkCheckerConfig, out: AsyncQueue<LinkResult>, crawlOptions: CrawlOptions): Promise<void> {
	const { signal } = crawlOptions;
	const server = config.path ? await serveDirectory(config.path) : undefined;
	try {
		const base = new URL(config.url ?? server!.url);
		crawlOptions.onStart?.(base.href);

		const fetcher = new Fetcher(config);
		const robots = new RobotsCache((url) => fetcher.getText(url, signal), config.userAgent);
		const scheduler = new Scheduler(config);
		const patterns = compilePatterns(config.excludedPatterns);
		const tasks = new Map<string, Task>();
		const wake = new Signal();

		/** `page -> { fragment -> parents }` for `checkFragments`; verified after the page is parsed. */
		const fragmentRefs = new Map<string, Map<string, Set<string>>>();
		const pageIds = new Map<string, Set<string>>();

		const emit = (task: Task, partial: Omit<LinkResult, "url" | "original" | "parents" | "kind" | "internal">) => {
			out.push({ url: task.key, original: task.original, parents: [...task.parents], kind: task.kind, internal: task.internal, ...partial });
		};

		const skip = (task: Task, reason: string) => emit(task, { state: "skipped", reason, redirects: [], attempts: 0, durationMs: 0 });

		const discover = (link: DiscoveredLink, parent: string | undefined, depth: number) => {
			const url = resolveLink(link.url, parent ?? base.href);
			if (!url) return;
			const key = normalizeUrl(url);
			const internal = isSameOrigin(url, base);

			if (url.hash && internal && config.checkFragments && parent) {
				const fragment = decodeURIComponent(url.hash.slice(1));
				let perPage = fragmentRefs.get(key);
				if (!perPage) fragmentRefs.set(key, (perPage = new Map()));
				let parents = perPage.get(fragment);
				if (!parents) perPage.set(fragment, (parents = new Set()));
				parents.add(parent);
			}

			const existing = tasks.get(key);
			if (existing) {
				if (parent) existing.parents.add(parent);
				return;
			}
			const crawlable = internal && link.kind === "link" && depth <= config.maxDepth;
			const task: Task = {
				key,
				url,
				original: link.original,
				parents: new Set(parent ? [parent] : []),
				kind: crawlable ? "page" : link.kind,
				internal,
				depth,
				crawl: crawlable,
			};
			tasks.set(key, task);

			const excluded = isExcluded(key, config, patterns);
			if (excluded) return skip(task, excluded);
			if (!internal && !config.checkExternal) return skip(task, "external links are off (checkExternal)");
			if (internal && !config.checkInternal && !task.crawl) return skip(task, "internal links are off (checkInternal)");
			scheduler.enqueue(task);
		};

		const process = async (task: Task) => {
			const started = Date.now();
			try {
				if (config.honorRobotExclusions) {
					const rules = await robots.rulesFor(task.url);
					if (!rules.isAllowed(task.url)) {
						skip(task, "disallowed by robots.txt");
						return;
					}
				}
				const wantBody = task.crawl || (config.filterLevel >= 3 && task.internal && /\.css(?:$|\?)/i.test(task.url.pathname));
				const outcome = await fetcher.check({ url: task.key, wantBody, signal });
				const verdict = classify(outcome, config);
				const quietInternal = task.internal && !config.checkInternal;

				if (outcome.body !== undefined) {
					if (task.crawl && HTML_TYPE.test(outcome.contentType ?? "")) {
						const page = parseHtml(outcome.body, outcome.url, config.filterLevel);
						pageIds.set(task.key, page.ids);
						for (const link of page.links) discover(link, task.key, task.depth + 1);
					} else if (CSS_TYPE.test(outcome.contentType ?? "")) {
						for (const link of parseCss(outcome.body, outcome.url)) discover(link, task.key, task.depth + 1);
					}
				}

				emit(task, {
					state: quietInternal ? "skipped" : verdict.state,
					...(quietInternal ? { reason: "internal links are off (checkInternal)" } : verdict.reason ? { reason: verdict.reason } : {}),
					...(outcome.status !== undefined ? { status: outcome.status } : {}),
					redirects: outcome.redirects,
					attempts: outcome.attempts,
					durationMs: Date.now() - started,
				});
			} catch (error) {
				emit(task, { state: "broken", reason: (error as Error).message, redirects: [], attempts: 1, durationMs: Date.now() - started });
			}
		};

		// Seeds: the start URL, plus sitemap entries when configured.
		discover({ url: base.href, original: base.href, kind: "link", tag: "seed", attr: "" }, undefined, 0);
		if (config.sitemap) {
			for (const loc of await seedsFromSitemap(fetcher, base, config, signal)) {
				discover({ url: loc, original: loc, kind: "link", tag: "sitemap", attr: "loc" }, undefined, 0);
			}
		}

		while (!scheduler.idle) {
			if (signal?.aborted) break;
			const pick = scheduler.next();
			if (pick && "task" in pick) {
				const { task } = pick;
				process(task).finally(() => {
					scheduler.done(task);
					wake.signal();
				});
				continue;
			}
			if (scheduler.inflight === 0 && !pick) break;
			const waitMs = pick && "waitMs" in pick ? pick.waitMs : undefined;
			await Promise.race([wake.wait(), waitMs === undefined ? new Promise<never>(() => {}) : sleep(waitMs, undefined, { ref: false })]);
		}

		// Fragment verification: every page is parsed by now.
		for (const [page, refs] of fragmentRefs) {
			const ids = pageIds.get(page);
			if (!ids) continue;
			for (const [fragment, parents] of refs) {
				if (ids.has(fragment)) continue;
				out.push({
					url: `${page}#${fragment}`,
					original: `#${fragment}`,
					state: "broken",
					reason: `no element with id "${fragment}"`,
					redirects: [],
					parents: [...parents],
					kind: "link",
					internal: true,
					attempts: 0,
					durationMs: 0,
				});
			}
		}
	} finally {
		await server?.close();
	}
}
