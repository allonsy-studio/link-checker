/**
 * SPDX-License-Identifier: MPL-2.0
 */

import { check } from "./crawl.ts";
import type { CheckSummary, LinkCheckerOptions } from "./types.ts";

/** Registers a `checkLinks` task. Call from `setupNodeEvents(on)` in `cypress.config.*`. */
export function registerLinkChecker(on: (event: "task", tasks: Record<string, (arg: unknown) => unknown>) => void, defaults: LinkCheckerOptions = {}): void {
	on("task", {
		checkLinks: (arg: unknown): Promise<CheckSummary> => check({ ...defaults, ...((arg ?? {}) as LinkCheckerOptions) }),
	});
}
