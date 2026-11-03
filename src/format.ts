/**
 * SPDX-License-Identifier: MPL-2.0
 */

import type { LinkResult } from "./types.ts";

/** One plain-text block per result, separated by a blank line. Suitable for assertion messages. */
export function formatResults(results: LinkResult[]): string {
	return results.map(formatBlock).join("\n\n");
}

function formatBlock(result: LinkResult): string {
	const label = result.state.toUpperCase();
	const head = result.status !== undefined ? `${label} [${result.status}] ${result.url}` : `${label} ${result.url}`;
	const lines = [head];
	if (result.reason) lines.push(`  reason: ${result.reason}`);
	if (result.redirects.length > 0) lines.push(`  via: ${result.redirects.join(" → ")}`);
	for (const parent of result.parents) lines.push(`  on: ${parent}`);
	return lines.join("\n");
}
