import { expect } from "chai"
import { describe, it } from "mocha"
import { parseAutomationEventNdjson } from "./AutomationEventNdjson"

describe("parseAutomationEventNdjson", () => {
	it("normalizes Cursor-style automation events with default source", () => {
		const result = parseAutomationEventNdjson(
			[
				JSON.stringify({
					id: "evt-1",
					type: "git.commit.created",
					subject: "main",
					payload: { branch: "main" },
				}),
			].join("\n"),
			{ defaultSource: "cursor", now: () => Date.UTC(2026, 5, 6) },
		)

		expect(result.rejected).to.deep.equal([])
		expect(result.events).to.deep.equal([
			{
				eventId: "evt-1",
				eventType: "git.commit.created",
				source: "cursor",
				occurredAt: "2026-06-06T00:00:00.000Z",
				subject: "main",
				payload: { branch: "main" },
			},
		])
	})

	it("enforces allowed source, line, and event limits", () => {
		const result = parseAutomationEventNdjson(
			[
				JSON.stringify({ eventId: "evt-1", eventType: "git.commit.created", source: "cursor" }),
				JSON.stringify({ eventId: "evt-2", eventType: "git.commit.created", source: "github" }),
				JSON.stringify({ eventId: "evt-3", eventType: "git.commit.created", source: "cursor" }),
				JSON.stringify({ eventId: "evt-4", eventType: "git.commit.created", source: "cursor" }),
			].join("\n"),
			{ allowedSources: ["cursor"], maxEvents: 2, maxLineBytes: 256 },
		)

		expect(result.events.map((event) => event.eventId)).to.deep.equal(["evt-1", "evt-3"])
		expect(result.rejected.map((line) => line.reason)).to.deep.equal(["source_not_allowed", "too_many_events"])
	})
})
