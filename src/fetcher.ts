/**
 * SPDX-License-Identifier: MPL-2.0
 */

import { setTimeout as sleep } from "node:timers/promises";

import type { LinkCheckerConfig } from "./types.ts";

export interface FetchOutcome {
	/** Final URL after redirects. */
	url: string;
	status?: number;
	contentType?: string;
	/** Body text, only read when `wantBody` was set and the response is 2xx. */
	body?: string;
	redirects: string[];
	attempts: number;
	/** Network-level failure, when no response arrived at all. */
	error?: string;
	/** True when the final response came from a GET issued after a HEAD. */
	fellBackToGet: boolean;
}

export interface FetchRequest {
	url: string;
	/** Read and return the body (pages to crawl, stylesheets at level 3). */
	wantBody: boolean;
	signal?: AbortSignal | undefined;
}

const MAX_REDIRECTS = 10;
const RETRYABLE_NETWORK = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|UND_ERR|socket hang up|fetch failed|aborted|timeout/i;

function describe(error: unknown): string {
	if (error instanceof Error) {
		const cause = (error as Error & { cause?: unknown }).cause;
		const causeText = cause instanceof Error ? `: ${cause.message}` : "";
		if (error.name === "TimeoutError" || error.name === "AbortError") return "timeout";
		return `${error.message}${causeText}`;
	}
	return String(error);
}

function retryAfterMs(value: string | null): number | undefined {
	if (!value) return undefined;
	const seconds = Number(value);
	if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000);
	const date = Date.parse(value);
	return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function backoff(attempt: number): number {
	const base = 1000 * 2 ** (attempt - 1);
	return base + Math.random() * base * 0.5;
}

export type FetcherConfig = Pick<LinkCheckerConfig, "requestMethod" | "timeout" | "retries" | "headers" | "userAgent">;

export class Fetcher {
	readonly #config: FetcherConfig;

	constructor(config: FetcherConfig) {
		this.#config = config;
	}

	/** Plain GET used for robots.txt and sitemaps: one attempt, redirects followed by the platform. */
	async getText(url: string, signal?: AbortSignal): Promise<{ status: number; text: string } | undefined> {
		try {
			const response = await fetch(url, {
				method: "GET",
				headers: this.#headers(),
				redirect: "follow",
				signal: this.#signal(signal),
			});
			return { status: response.status, text: await response.text() };
		} catch {
			return undefined;
		}
	}

	/** Check one URL: HEAD with GET fallback, manual redirects, retries on 429, 5xx, and network errors. */
	async check(request: FetchRequest): Promise<FetchOutcome> {
		const wantGet = request.wantBody || this.#config.requestMethod === "get";
		let attempts = 0;
		let outcome: FetchOutcome & { retryAfter?: number };
		for (;;) {
			attempts += 1;
			if (request.signal?.aborted) return { url: request.url, redirects: [], attempts, error: "aborted", fellBackToGet: false };
			outcome = await this.#once(request, wantGet ? "GET" : "HEAD", attempts);

			// HEAD that did not succeed: try GET once before judging. Many hosts mishandle HEAD.
			if (!wantGet && !outcome.error && (outcome.status === undefined || outcome.status >= 400)) {
				outcome = await this.#once(request, "GET", attempts);
				outcome.fellBackToGet = true;
			}

			const retryable = outcome.error ? RETRYABLE_NETWORK.test(outcome.error) : outcome.status === 429 || (outcome.status !== undefined && outcome.status >= 500);
			if (!retryable || attempts > this.#config.retries) break;
			const wait = outcome.retryAfter ?? backoff(attempts);
			await sleep(wait, undefined, { signal: request.signal, ref: false }).catch(() => {});
		}
		delete outcome.retryAfter;
		return { ...outcome, attempts };
	}

	async #once(request: FetchRequest, method: "GET" | "HEAD", attempts: number): Promise<FetchOutcome & { retryAfter?: number }> {
		const redirects: string[] = [];
		let current = request.url;
		for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
			let response: Response;
			try {
				response = await fetch(current, {
					method,
					headers: this.#headers(),
					redirect: "manual",
					signal: this.#signal(request.signal),
				});
			} catch (error) {
				return { url: current, redirects, attempts, error: describe(error), fellBackToGet: false };
			}

			const location = response.headers.get("location");
			if (response.status >= 300 && response.status < 400 && location) {
				await response.body?.cancel().catch(() => {});
				let next: string;
				try {
					next = new URL(location, current).href;
				} catch {
					return { url: current, status: response.status, redirects, attempts, error: `invalid redirect location: ${location}`, fellBackToGet: false };
				}
				redirects.push(next);
				if (hop === MAX_REDIRECTS) {
					return { url: current, status: response.status, redirects, attempts, error: "too many redirects", fellBackToGet: false };
				}
				current = next;
				continue;
			}

			const contentType = response.headers.get("content-type") ?? undefined;
			const out: FetchOutcome & { retryAfter?: number } = {
				url: current,
				status: response.status,
				redirects,
				attempts,
				fellBackToGet: false,
				...(contentType ? { contentType } : {}),
			};
			const retryAfter = retryAfterMs(response.headers.get("retry-after"));
			if (retryAfter !== undefined) out.retryAfter = retryAfter;
			if (request.wantBody && method === "GET" && response.ok) {
				try {
					out.body = await response.text();
				} catch (error) {
					out.error = describe(error);
				}
			} else {
				await response.body?.cancel().catch(() => {});
			}
			return out;
		}
		return { url: current, redirects, attempts, error: "too many redirects", fellBackToGet: false };
	}

	#headers(): Record<string, string> {
		return {
			"user-agent": this.#config.userAgent,
			accept: "text/html,application/xhtml+xml,*/*;q=0.8",
			"accept-encoding": "gzip, deflate, br",
			...this.#config.headers,
		};
	}

	#signal(outer?: AbortSignal): AbortSignal {
		const timeout = AbortSignal.timeout(this.#config.timeout);
		return outer ? AbortSignal.any([outer, timeout]) : timeout;
	}
}
