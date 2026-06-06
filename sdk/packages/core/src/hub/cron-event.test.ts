import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalHubScheduleRuntimeHandlers } from "./daemon/runtime-handlers";
import { HubServerTransport } from "./server";

describe("hub cron event commands", () => {
	it("ingests Cursor-style automation NDJSON through the hub", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-hub-cron-event-"));
		const cronDir = join(root, "cron");
		const dbPath = join(root, "cron.db");
		mkdirSync(join(cronDir, "events"), { recursive: true });
		writeFileSync(
			join(cronDir, "events", "cursor-git.event.md"),
			`---
id: cursor-git
title: Cursor Git
workspaceRoot: ${root}
event: git.commit.created
filters:
  branch: main
---
Summarize the Cursor git event.
`,
			"utf8",
		);

		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: join(root, "schedule.db") },
			cronOptions: {
				workspaceRoot: root,
				specs: { cronSpecsDir: cronDir },
				dbPath,
			},
		});

		try {
			await transport.getCronService()?.reconcileNow();
			const reply = await transport.handleCommand({
				version: "v1",
				command: "cron.event.ingest",
				requestId: "req-1",
				clientId: "client-one",
				payload: {
					defaultSource: "cursor",
					ndjson: [
						JSON.stringify({
							id: "evt_cursor_git_1",
							type: "git.commit.created",
							timestamp: "2026-06-06T10:00:00.000Z",
							attrs: { branch: "main" },
							data: { secret: "secret-value", ref: "main" },
						}),
						"{bad-secret",
					].join("\n"),
				},
			});

			expect(reply).toMatchObject({
				ok: true,
				payload: {
					eventCount: 1,
					rejectedCount: 1,
					results: [
						{
							eventId: "evt_cursor_git_1",
							eventType: "git.commit.created",
							source: "cursor",
							duplicate: false,
							matchedSpecIds: ["cursor-git"],
							suppressionCount: 0,
						},
					],
					rejected: [
						{
							lineNumber: 2,
							reason: "invalid_json",
							lineLength: 11,
						},
					],
				},
			});
			expect(JSON.stringify(reply)).not.toContain("secret-value");
			expect(JSON.stringify(reply)).not.toContain("{bad-secret");

			const directReply = await transport.handleCommand({
				version: "v1",
				command: "cron.event.ingest",
				requestId: "req-2",
				clientId: "client-one",
				payload: {
					id: "evt_cursor_git_2",
					type: "git.commit.created",
					defaultSource: "cursor",
					attrs: { branch: "main" },
				},
			});

			expect(directReply).toMatchObject({
				ok: true,
				payload: {
					eventCount: 1,
					rejectedCount: 0,
					results: [
						{
							eventId: "evt_cursor_git_2",
							eventType: "git.commit.created",
							source: "cursor",
							duplicate: false,
							matchedSpecIds: ["cursor-git"],
						},
					],
				},
			});
		} finally {
			await transport.stop();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects cron.event.ingest when cron is not enabled", async () => {
		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: ":memory:" },
		});

		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "cron.event.ingest",
				requestId: "req-1",
				clientId: "client-one",
				payload: { ndjson: "" },
			});

			expect(reply).toMatchObject({
				ok: false,
				error: {
					code: "cron_not_enabled",
				},
			});
		} finally {
			await transport.stop();
		}
	});
});
