import { expect } from "chai"
import { describe, it } from "mocha"
import type { BackgroundAgentTaskRecord } from "@shared/BackgroundAgent"
import {
	MAX_BACKGROUND_AGENT_TASK_RECORDS,
	normalizeBackgroundAgentTaskRecords,
	upsertBackgroundAgentTaskRecord,
} from "../persistence"

function record(overrides: Partial<BackgroundAgentTaskRecord> = {}): BackgroundAgentTaskRecord {
	return {
		id: "bg-1",
		source: "cursor-deeplink",
		status: "running",
		agentMode: "plan",
		autoApprovalProfile: "read-only-plan-confirmation-required",
		worktreePolicy: "confirm-before-create",
		createdAt: 1000,
		updatedAt: 1000,
		prompt: "Fix flaky tests",
		confirmationRequired: true,
		...overrides,
	}
}

describe("background-agent persistence", () => {
	it("filters invalid records, deduplicates by id, and keeps the newest update", () => {
		const records = normalizeBackgroundAgentTaskRecords([
			record({ id: "bg-1", status: "queued", updatedAt: 1000 }),
			{ ...record({ id: "invalid" }), confirmationRequired: false },
			record({ id: "bg-2", createdAt: 900, updatedAt: 900 }),
			record({ id: "bg-1", status: "running", updatedAt: 1500, taskId: "task-1" }),
		])

		expect(records.map((item) => item.id)).to.deep.equal(["bg-2", "bg-1"])
		expect(records[1]).to.deep.include({
			id: "bg-1",
			status: "running",
			taskId: "task-1",
		})
	})

	it("keeps a bounded set of the most recent records", () => {
		const records = normalizeBackgroundAgentTaskRecords(
			Array.from({ length: MAX_BACKGROUND_AGENT_TASK_RECORDS + 5 }, (_, index) =>
				record({
					id: `bg-${index}`,
					createdAt: index,
					updatedAt: index,
				}),
			),
		)

		expect(records).to.have.length(MAX_BACKGROUND_AGENT_TASK_RECORDS)
		expect(records[0].id).to.equal("bg-5")
		expect(records.at(-1)?.id).to.equal(`bg-${MAX_BACKGROUND_AGENT_TASK_RECORDS + 4}`)
	})

	it("upserts records into a normalized persisted list", () => {
		const records = upsertBackgroundAgentTaskRecord(
			[record({ id: "bg-1", status: "queued", updatedAt: 1000 })],
			record({ id: "bg-1", status: "failed", updatedAt: 2000, errorMessage: "boom" }),
		)

		expect(records).to.have.length(1)
		expect(records[0]).to.deep.include({
			id: "bg-1",
			status: "failed",
			errorMessage: "boom",
		})
	})
})
