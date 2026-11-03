/**
 * SPDX-License-Identifier: MPL-2.0
 */

import { appendFile } from "node:fs/promises";

import type { LinkResult } from "../types.ts";
import type { Reporter } from "./index.ts";

/** Escape a value for a workflow command parameter or message. */
function escapeData(value: string): string {
	return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function escapeProperty(value: string): string {
	return escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

function message(result: LinkResult): string {
	const status = result.status !== undefined ? `status ${result.status}` : (result.reason ?? "unreachable");
	const detail = result.reason && result.status !== undefined ? ` (${result.reason})` : "";
	const parents = result.parents.length > 0 ? ` on ${result.parents.join(", ")}` : "";
	return `${result.url}: ${status}${detail}${parents}`;
}

/** Emits GitHub Actions workflow commands and a step-summary table. */
export function githubReporter(): Reporter {
	const rows: string[] = [];
	return {
		result(result) {
			if (result.state !== "broken" && result.state !== "warn") return;
			const level = result.state === "broken" ? "error" : "warning";
			process.stdout.write(`::${level} title=${escapeProperty(result.state === "broken" ? "Broken link" : "Link warning")}::${escapeData(message(result))}\n`);
			const status = result.status ?? "—";
			rows.push(`| ${result.state} | ${result.url} | ${status} | ${result.reason ?? ""} | ${result.parents.join("<br>")} |`);
		},
		async end(summary) {
			const summaryFile = process.env["GITHUB_STEP_SUMMARY"];
			if (!summaryFile) return;
			const { counts } = summary;
			const lines = [
				`## Link check: ${summary.passed ? "passed" : "failed"}`,
				"",
				`${counts.ok} ok, ${counts.warn} warned, ${counts.broken} broken, ${counts.skipped} skipped in ${(summary.durationMs / 1000).toFixed(1)}s.`,
				"",
			];
			if (rows.length > 0) {
				lines.push("| State | URL | Status | Reason | Found on |", "| --- | --- | --- | --- | --- |", ...rows, "");
			}
			await appendFile(summaryFile, lines.join("\n"), "utf8");
		},
	};
}
