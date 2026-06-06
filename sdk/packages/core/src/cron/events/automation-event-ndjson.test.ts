import { describe, expect, it } from "vitest";
import { parseAutomationEventNdjson } from "./automation-event-ndjson";

describe("parseAutomationEventNdjson", () => {
	it("parses direct event envelopes and Cursor-style aliases", () => {
		const result = parseAutomationEventNdjson(
			[
				JSON.stringify({
					id: "evt_checkout_1",
					type: "git.checkout.completed",
					source: "cursor",
					timestamp: "2026-04-23T10:00:00.000Z",
					cwd: "/repo",
					data: { ref: "main" },
					attrs: { branch: "main" },
					dedupe_key: "checkout:main",
				}),
				JSON.stringify({
					eventId: "evt_commit_1",
					eventType: "git.commit.created",
					source: "vscode",
					occurredAt: "2026-04-23T10:01:00.000Z",
				}),
			].join("\n"),
		);

		expect(result.rejected).toHaveLength(0);
		expect(result.events).toEqual([
			{
				eventId: "evt_checkout_1",
				eventType: "git.checkout.completed",
				source: "cursor",
				occurredAt: "2026-04-23T10:00:00.000Z",
				workspaceRoot: "/repo",
				payload: { ref: "main" },
				attributes: { branch: "main" },
				dedupeKey: "checkout:main",
			},
			{
				eventId: "evt_commit_1",
				eventType: "git.commit.created",
				source: "vscode",
				occurredAt: "2026-04-23T10:01:00.000Z",
			},
		]);
	});

	it("parses plugin automation_event wrappers", () => {
		const result = parseAutomationEventNdjson(
			JSON.stringify({
				name: "automation_event",
				payload: {
					eventId: "evt_plugin_1",
					eventType: "local.plugin_event",
					source: "plugin",
					occurredAt: "2026-04-23T10:00:00.000Z",
					payload: { topic: "checkpoints" },
				},
			}),
		);

		expect(result.rejected).toHaveLength(0);
		expect(result.events[0]).toMatchObject({
			eventId: "evt_plugin_1",
			eventType: "local.plugin_event",
			source: "plugin",
			payload: { topic: "checkpoints" },
		});
	});

	it("falls back to default source and current time", () => {
		const result = parseAutomationEventNdjson(
			JSON.stringify({
				id: "evt_1",
				type: "git.commit.created",
			}),
			{
				defaultSource: "cursor",
				now: () => Date.parse("2026-04-23T10:00:00.000Z"),
			},
		);

		expect(result.rejected).toHaveLength(0);
		expect(result.events[0]).toMatchObject({
			eventId: "evt_1",
			eventType: "git.commit.created",
			source: "cursor",
			occurredAt: "2026-04-23T10:00:00.000Z",
		});
	});

	it("reports malformed and incomplete lines without dropping valid events", () => {
		const result = parseAutomationEventNdjson(
			[
				"{not-json",
				JSON.stringify(["evt_1"]),
				JSON.stringify({ eventId: "evt_missing_type", source: "cursor" }),
				JSON.stringify({
					eventId: "evt_valid",
					eventType: "git.checkout.completed",
					source: "cursor",
					occurredAt: "2026-04-23T10:00:00.000Z",
				}),
			].join("\n"),
		);

		expect(result.events).toHaveLength(1);
		expect(result.events[0]?.eventId).toBe("evt_valid");
		expect(result.rejected.map((entry) => entry.reason)).toEqual([
			"invalid_json",
			"not_object",
			"missing_field",
		]);
		expect(result.rejected.map((entry) => entry.lineNumber)).toEqual([1, 2, 3]);
	});
});
