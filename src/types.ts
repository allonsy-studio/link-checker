/**
 * SPDX-License-Identifier: MPL-2.0
 */

export type LinkState = "ok" | "warn" | "broken" | "skipped";
export type LinkKind = "page" | "link" | "asset";
export type RedirectPolicy = "allow" | "warn" | "error";
export type StatusAction = "ok" | "warn" | "error";
export type ReporterName = "console" | "json" | "github";
export type RequestMethod = "head" | "get";
export type FilterLevel = 0 | 1 | 2 | 3;

/** One checked URL. Emitted once per unique URL per run. */
export interface LinkResult {
	/** URL as resolved against the page it appeared on. */
	url: string;
	/** URL as written in the source page (first occurrence). */
	original: string;
	state: LinkState;
	/** HTTP status of the final response, when a response arrived. */
	status?: number;
	/** Why a link is broken, warned, or skipped. */
	reason?: string;
	/** Location headers followed, in order. */
	redirects: string[];
	/** Every page that linked to this URL. */
	parents: string[];
	kind: LinkKind;
	internal: boolean;
	attempts: number;
	durationMs: number;
}

/** Shape of `.link-checker.config.yaml`, also the options object for `check()` and `crawl()`. */
export interface LinkCheckerConfig {
	url?: string;
	path?: string;
	excludedKeywords: string[];
	excludedPatterns: string[];
	filterLevel: FilterLevel;
	honorRobotExclusions: boolean;
	maxSocketsPerHost: number;
	maxSockets: number;
	rateLimit: number;
	requestMethod: RequestMethod;
	timeout: number;
	retries: number;
	maxDepth: number;
	checkInternal: boolean;
	checkExternal: boolean;
	checkFragments: boolean;
	sitemap: boolean | string;
	redirects: RedirectPolicy;
	statusCodes: Record<string, StatusAction>;
	headers: Record<string, string>;
	userAgent: string;
	reporters: ReporterName[];
	output?: string;
	strict: boolean;
}

/** Everything is optional on the way in; `loadConfig()` fills the defaults. */
export type LinkCheckerOptions = Partial<LinkCheckerConfig>;

export interface CheckSummary {
	passed: boolean;
	counts: Record<LinkState, number>;
	durationMs: number;
	results: LinkResult[];
	/** Results in state `broken`, in emission order. */
	broken: LinkResult[];
	/** Results in state `warn`, in emission order. */
	warnings: LinkResult[];
}

export interface CrawlOptions {
	signal?: AbortSignal;
	/** Called with the resolved base URL once the crawl can start (useful when `path` starts a server). */
	onStart?: (base: string) => void;
}

/** A link found in a page, before it is scheduled. */
export interface DiscoveredLink {
	url: string;
	original: string;
	kind: LinkKind;
	tag: string;
	attr: string;
}

export interface ParsedPage {
	links: DiscoveredLink[];
	ids: Set<string>;
}
