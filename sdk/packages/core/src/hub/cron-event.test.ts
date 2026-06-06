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

			const limitedReply = await transport.handleCommand({
				version: "v1",
				command: "cron.event.ingest",
				requestId: "req-3",
				clientId: "client-one",
				payload: {
					defaultSource: "cursor",
					allowedSources: ["cursor"],
					maxEvents: 1,
					ndjson: [
						JSON.stringify({
							id: "evt_cursor_git_3",
							type: "git.commit.created",
							attrs: { branch: "main" },
						}),
						JSON.stringify({
							id: "evt_cursor_git_4",
							type: "git.commit.created",
							attrs: { branch: "main" },
						}),
					].join("\n"),
				},
			});

			expect(limitedReply).toMatchObject({
				ok: true,
				payload: {
					eventCount: 1,
					rejectedCount: 1,
					results: [
						{
							eventId: "evt_cursor_git_3",
							source: "cursor",
						},
					],
					rejected: [
						{
							lineNumber: 2,
							reason: "too_many_events",
						},
					],
				},
			});

			const disallowedSourceReply = await transport.handleCommand({
				version: "v1",
				command: "cron.event.ingest",
				requestId: "req-4",
				clientId: "client-one",
				payload: {
					allowedSources: ["cursor"],
					ndjson: JSON.stringify({
						id: "evt_external_git_1",
						type: "git.commit.created",
						source: "external",
						attrs: { branch: "main" },
					}),
				},
			});

			expect(disallowedSourceReply).toMatchObject({
				ok: true,
				payload: {
					eventCount: 0,
					rejectedCount: 1,
					rejected: [
						{
							lineNumber: 1,
							reason: "source_not_allowed",
						},
					],
				},
			});

			const maxLineBytesReply = await transport.handleCommand({
				version: "v1",
				command: "cron.event.ingest",
				requestId: "req-5",
				clientId: "client-one",
				payload: {
					defaultSource: "cursor",
					maxLineBytes: 10,
					ndjson: JSON.stringify({
						id: "evt_cursor_git_large",
						type: "git.commit.created",
						attrs: { branch: "main" },
					}),
				},
			});

			expect(maxLineBytesReply).toMatchObject({
				ok: true,
				payload: {
					eventCount: 0,
					rejectedCount: 1,
					rejected: [
						{
							lineNumber: 1,
							reason: "line_too_large",
						},
					],
				},
			});

			const invalidLimitReply = await transport.handleCommand({
				version: "v1",
				command: "cron.event.ingest",
				requestId: "req-6",
				clientId: "client-one",
				payload: {
					defaultSource: "cursor",
					maxEvents: 0,
					ndjson: "",
				},
			});

			expect(invalidLimitReply).toMatchObject({
				ok: false,
				error: {
					code: "cron_event_ingest_failed",
				},
			});
			expect(invalidLimitReply.error?.message).toContain("positive integer");

			const listReply = await transport.handleCommand({
				version: "v1",
				command: "cron.event.list",
				requestId: "req-7",
				clientId: "client-one",
				payload: {
					source: "cursor",
					limit: 10,
				},
			});

			expect(listReply).toMatchObject({
				ok: true,
				payload: {
					count: 3,
				},
			});
			const listedEvents = listReply.payload?.events as Array<Record<string, unknown>>;
			expect(listedEvents.map((event) => event.eventId)).toEqual(
				expect.arrayContaining([
					"evt_cursor_git_1",
					"evt_cursor_git_2",
					"evt_cursor_git_3",
				]),
			);
			expect(listedEvents[0]).toHaveProperty("payloadKeys");
			expect(listedEvents[0]).not.toHaveProperty("payload");
			expect(JSON.stringify(listReply)).not.toContain("secret-value");

			const getReply = await transport.handleCommand({
				version: "v1",
				command: "cron.event.get",
				requestId: "req-8",
				clientId: "client-one",
				payload: {
					eventId: "evt_cursor_git_1",
				},
			});

			expect(getReply).toMatchObject({
				ok: true,
				payload: {
					event: {
						eventId: "evt_cursor_git_1",
						eventType: "git.commit.created",
						source: "cursor",
						processingStatus: "queued",
						matchedSpecCount: 1,
						queuedRunCount: 1,
						payload: {
							secret: "[redacted]",
							ref: "main",
						},
						attributes: {
							branch: "main",
						},
					},
				},
			});
			expect(JSON.stringify(getReply)).not.toContain("secret-value");

			const missingReply = await transport.handleCommand({
				version: "v1",
				command: "cron.event.get",
				requestId: "req-9",
				clientId: "client-one",
				payload: {
					eventId: "evt_missing",
				},
			});

			expect(missingReply).toMatchObject({
				ok: false,
				error: {
					code: "cron_event_not_found",
				},
			});

			const invalidListReply = await transport.handleCommand({
				version: "v1",
				command: "cron.event.list",
				requestId: "req-10",
				clientId: "client-one",
				payload: {
					processingStatus: "done",
				},
			});

			expect(invalidListReply).toMatchObject({
				ok: false,
				error: {
					code: "cron_event_list_failed",
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

			const listReply = await transport.handleCommand({
				version: "v1",
				command: "cron.event.list",
				requestId: "req-2",
				clientId: "client-one",
				payload: {},
			});
			expect(listReply).toMatchObject({
				ok: false,
				error: {
					code: "cron_not_enabled",
				},
			});

			const getReply = await transport.handleCommand({
				version: "v1",
				command: "cron.event.get",
				requestId: "req-3",
				clientId: "client-one",
				payload: { eventId: "evt_missing" },
			});
			expect(getReply).toMatchObject({
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
