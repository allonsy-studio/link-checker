/**
 * SPDX-License-Identifier: MPL-2.0
 */

interface Directive {
	allow: boolean;
	pattern: RegExp;
	/** Length of the original path pattern; longer patterns win. */
	length: number;
}

interface Group {
	agents: string[];
	rules: Directive[];
}

function patternToRegExp(path: string): RegExp {
	let anchored = false;
	let source = path;
	if (source.endsWith("$")) {
		anchored = true;
		source = source.slice(0, -1);
	}
	const escaped = source
		.split("*")
		.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
		.join(".*");
	return new RegExp(`^${escaped}${anchored ? "$" : ""}`);
}

/** Parsed robots.txt rules for one host. Longest matching rule wins; Allow beats Disallow on a tie. */
export class RobotsRules {
	readonly #rules: Directive[];

	constructor(rules: Directive[]) {
		this.#rules = rules;
	}

	static allowAll(): RobotsRules {
		return new RobotsRules([]);
	}

	/** Parse robots.txt text, selecting the group for `agent` (its product token) or `*`. */
	static parse(text: string, agent: string): RobotsRules {
		const groups: Group[] = [];
		let current: Group | undefined;
		let lastWasAgent = false;
		for (const rawLine of text.split(/\r?\n/)) {
			const line = rawLine.replace(/#.*$/, "").trim();
			if (!line) continue;
			const colon = line.indexOf(":");
			if (colon === -1) continue;
			const field = line.slice(0, colon).trim().toLowerCase();
			const value = line.slice(colon + 1).trim();
			if (field === "user-agent") {
				if (!current || !lastWasAgent) {
					current = { agents: [], rules: [] };
					groups.push(current);
				}
				current.agents.push(value.toLowerCase());
				lastWasAgent = true;
				continue;
			}
			lastWasAgent = false;
			if (!current) continue;
			if (field === "allow" || field === "disallow") {
				if (!value) continue;
				current.rules.push({ allow: field === "allow", pattern: patternToRegExp(value), length: value.length });
			}
		}
		const token = agent.split("/")[0]!.toLowerCase();
		const specific = groups.find((g) => g.agents.some((a) => a !== "*" && (token.includes(a) || a.includes(token))));
		const wildcard = groups.find((g) => g.agents.includes("*"));
		return new RobotsRules((specific ?? wildcard)?.rules ?? []);
	}

	isAllowed(url: URL): boolean {
		const path = url.pathname + url.search;
		let best: Directive | undefined;
		for (const rule of this.#rules) {
			if (!rule.pattern.test(path)) continue;
			if (!best || rule.length > best.length || (rule.length === best.length && rule.allow && !best.allow)) best = rule;
		}
		return best ? best.allow : true;
	}
}

type Fetcher = (url: string) => Promise<{ status: number; text: string } | undefined>;

/** Fetches and caches robots.txt once per origin. A missing or failing file means no restrictions. */
export class RobotsCache {
	readonly #cache = new Map<string, Promise<RobotsRules>>();
	readonly #fetch: Fetcher;
	readonly #agent: string;

	constructor(fetcher: Fetcher, agent: string) {
		this.#fetch = fetcher;
		this.#agent = agent;
	}

	rulesFor(url: URL): Promise<RobotsRules> {
		let pending = this.#cache.get(url.origin);
		if (!pending) {
			pending = this.#load(url.origin);
			this.#cache.set(url.origin, pending);
		}
		return pending;
	}

	async #load(origin: string): Promise<RobotsRules> {
		try {
			const response = await this.#fetch(`${origin}/robots.txt`);
			if (!response || response.status < 200 || response.status >= 300) return RobotsRules.allowAll();
			return RobotsRules.parse(response.text, this.#agent);
		} catch {
			return RobotsRules.allowAll();
		}
	}
}
