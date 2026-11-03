/**
 * SPDX-License-Identifier: MPL-2.0
 */

/** A unit of work: one unique URL, with every page that linked to it. */
export interface Task {
	/** Normalized URL (no fragment). */
	key: string;
	url: URL;
	original: string;
	parents: Set<string>;
	kind: "page" | "link" | "asset";
	internal: boolean;
	depth: number;
	/** Parse the body for more links after fetching. */
	crawl: boolean;
}

interface HostState {
	queue: Task[];
	inflight: number;
	lastStart: number;
}

export interface SchedulerLimits {
	maxSocketsPerHost: number;
	maxSockets: number;
	rateLimit: number;
}

/**
 * Per-host FIFO queues with a per-host socket cap, a global socket cap, and a minimum gap between
 * request starts on the same host. `next()` returns a runnable task, or how long to wait for one.
 */
export class Scheduler {
	readonly #hosts = new Map<string, HostState>();
	readonly #limits: SchedulerLimits;
	#inflight = 0;
	#queued = 0;

	constructor(limits: SchedulerLimits) {
		this.#limits = limits;
	}

	get inflight(): number {
		return this.#inflight;
	}

	get queued(): number {
		return this.#queued;
	}

	get idle(): boolean {
		return this.#inflight === 0 && this.#queued === 0;
	}

	enqueue(task: Task): void {
		const host = task.url.host;
		let state = this.#hosts.get(host);
		if (!state) {
			state = { queue: [], inflight: 0, lastStart: -Infinity };
			this.#hosts.set(host, state);
		}
		state.queue.push(task);
		this.#queued += 1;
	}

	/** Pick the next runnable task, rotating across hosts so one busy host cannot starve the others. */
	next(now: number = Date.now()): { task: Task } | { waitMs: number } | undefined {
		if (this.#inflight >= this.#limits.maxSockets) return undefined;
		let soonest = Infinity;
		for (const [host, state] of this.#hosts) {
			if (state.queue.length === 0) continue;
			if (state.inflight >= this.#limits.maxSocketsPerHost) continue;
			const ready = state.lastStart + this.#limits.rateLimit;
			if (ready > now) {
				soonest = Math.min(soonest, ready - now);
				continue;
			}
			const task = state.queue.shift()!;
			state.inflight += 1;
			state.lastStart = now;
			this.#inflight += 1;
			this.#queued -= 1;
			// Move this host to the back so the next pick starts elsewhere.
			this.#hosts.delete(host);
			this.#hosts.set(host, state);
			return { task };
		}
		return Number.isFinite(soonest) ? { waitMs: Math.ceil(soonest) } : undefined;
	}

	done(task: Task): void {
		const state = this.#hosts.get(task.url.host);
		if (state) state.inflight -= 1;
		this.#inflight -= 1;
	}
}

/** Push-based async iterable: producers `push`, one consumer iterates, `close` ends it. */
export class AsyncQueue<T> implements AsyncIterable<T> {
	readonly #items: T[] = [];
	#waiter: (() => void) | undefined;
	#closed = false;
	#error: unknown;

	push(item: T): void {
		this.#items.push(item);
		this.#wake();
	}

	close(): void {
		this.#closed = true;
		this.#wake();
	}

	fail(error: unknown): void {
		this.#error = error;
		this.close();
	}

	#wake(): void {
		const waiter = this.#waiter;
		this.#waiter = undefined;
		waiter?.();
	}

	async *[Symbol.asyncIterator](): AsyncIterator<T> {
		for (;;) {
			if (this.#items.length > 0) {
				yield this.#items.shift()!;
				continue;
			}
			if (this.#closed) {
				if (this.#error) throw this.#error;
				return;
			}
			await new Promise<void>((resolve) => {
				this.#waiter = resolve;
			});
		}
	}
}

/** A promise that resolves when `signal()` is called. A signal with no waiter is remembered so no wakeup is lost. */
export class Signal {
	#resolve: (() => void) | undefined;
	#pending = false;

	wait(): Promise<void> {
		if (this.#pending) {
			this.#pending = false;
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => {
			this.#resolve = resolve;
		});
	}

	signal(): void {
		const resolve = this.#resolve;
		if (resolve) {
			this.#resolve = undefined;
			resolve();
		} else {
			this.#pending = true;
		}
	}
}
