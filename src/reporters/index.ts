/**
 * SPDX-License-Identifier: MPL-2.0
 */

import type { CheckSummary, LinkCheckerConfig, LinkResult, ReporterName } from "../types.ts";
import { consoleReporter } from "./console.ts";
import { githubReporter } from "./github.ts";
import { jsonReporter } from "./json.ts";

/** A reporter sees the run start, each result as it resolves, and the final summary. */
export interface Reporter {
	start?(base: string, config: LinkCheckerConfig): void;
	result?(result: LinkResult): void;
	end?(summary: CheckSummary, config: LinkCheckerConfig): Promise<void> | void;
}

export type ReporterFactory = (config: LinkCheckerConfig) => Reporter;

export const REPORTERS: Record<ReporterName, ReporterFactory> = {
	console: consoleReporter,
	json: jsonReporter,
	github: githubReporter,
};

export function createReporters(config: LinkCheckerConfig): Reporter[] {
	return config.reporters.map((name) => {
		const factory = REPORTERS[name];
		if (!factory) throw new Error(`Unknown reporter: ${name}`);
		return factory(config);
	});
}
