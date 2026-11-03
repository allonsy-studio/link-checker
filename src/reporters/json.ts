/**
 * SPDX-License-Identifier: MPL-2.0
 */

import { writeFile } from "node:fs/promises";

import type { LinkCheckerConfig } from "../types.ts";
import type { Reporter } from "./index.ts";

/** Writes the full result set as JSON to `output`, or to stdout when no path is configured. */
export function jsonReporter(config: LinkCheckerConfig): Reporter {
	return {
		async end(summary) {
			const payload = {
				passed: summary.passed,
				counts: summary.counts,
				durationMs: summary.durationMs,
				results: summary.results,
			};
			const text = JSON.stringify(payload, null, "\t") + "\n";
			if (config.output) {
				await writeFile(config.output, text, "utf8");
			} else {
				process.stdout.write(text);
			}
		},
	};
}
