/**
 * SPDX-License-Identifier: MPL-2.0
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { registerLinkChecker } from "../src/cypress.ts";
import type { CheckSummary } from "../src/types.ts";
import { fixture, html, type Fixture } from "./helpers.ts";

describe("registerLinkChecker", () => {
	let site: Fixture;

	before(async () => {
		site = await fixture({
			"/": { body: html("<a href=\"/missing\">missing</a>") },
		});
	});

	after(async () => {
		await site.close();
	});

	it("registers checkLinks, merging defaults with the task argument", async () => {
		const captured: { event?: string; tasks?: Record<string, (arg: unknown) => unknown> } = {};
		registerLinkChecker(
			(event, tasks) => {
				captured.event = event;
				captured.tasks = tasks;
			},
			{ honorRobotExclusions: false, retries: 0, timeout: 2000 },
		);
		assert.equal(captured.event, "task");

		const summary = (await captured.tasks!["checkLinks"]!({ url: site.url })) as CheckSummary;
		assert.equal(summary.broken.length, 1);
		assert.ok(summary.broken[0]!.url.endsWith("/missing"));
		assert.equal(summary.broken[0], summary.results.find((r) => r.state === "broken"));
	});
});
