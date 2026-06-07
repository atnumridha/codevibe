import { expect } from "chai"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, it } from "mocha"
import {
	ingestCursorAutomationEvents,
	resolveCursorAutomationIngestStorePath,
} from "./CursorAutomationIngestStore"

describe("ingestCursorAutomationEvents", () => {
	let storageDir: string

	beforeEach(async () => {
		storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-cursor-automation-"))
	})

	afterEach(async () => {
		await fs.rm(storageDir, { recursive: true, force: true })
	})

	it("stores accepted Cursor automation event summaries and skips duplicate event ids", async () => {
		const request = {
			strict: false,
			paramKeys: ["ndjson"],
			configKeys: [],
			options: { defaultSource: "cursor" },
			validation: {
				events: [
					{
						eventId: "evt-1",
						eventType: "git.commit.created",
						source: "cursor",
						occurredAt: "2026-06-06T00:00:00.000Z",
						payload: { token: "secret-value", branch: "main" },
						attributes: { authorization: "Bearer secret-value" },
					},
				],
				rejected: [],
			},
		}

		const first = await ingestCursorAutomationEvents(storageDir, request, () => Date.UTC(2026, 5, 6))
		const second = await ingestCursorAutomationEvents(storageDir, request, () => Date.UTC(2026, 5, 6))

		expect(first).to.deep.include({
			accepted: 1,
			rejected: 0,
			stored: 1,
			duplicates: 0,
			strictFailed: false,
		})
		expect(first.events[0]).to.deep.include({
			eventId: "evt-1",
			eventType: "git.commit.created",
			source: "cursor",
		})
		expect(first.events[0].payloadKeys).to.deep.equal(["branch", "token"])
		expect(first.events[0].attributeKeys).to.deep.equal(["authorization"])
		expect(second.stored).to.equal(0)
		expect(second.duplicates).to.equal(1)

		const storePath = resolveCursorAutomationIngestStorePath(storageDir)
		const storedLines = (await fs.readFile(storePath, "utf8")).trim().split("\n")
		expect(storedLines).to.have.length(1)
		expect(JSON.parse(storedLines[0])).to.deep.include({
			ingestedAt: "2026-06-06T00:00:00.000Z",
		})
		const stored = JSON.parse(storedLines[0])
		expect(stored.event).to.deep.include({
			eventId: "evt-1",
			eventType: "git.commit.created",
			source: "cursor",
			occurredAt: "2026-06-06T00:00:00.000Z",
		})
		expect(stored.event.payload).to.equal(undefined)
		expect(stored.event.attributes).to.equal(undefined)
		expect(stored.event.payloadKeys).to.deep.equal(["branch", "token"])
		expect(stored.event.attributeKeys).to.deep.equal(["authorization"])
		expect(JSON.stringify(stored)).not.to.contain("secret-value")
	})

	it("blocks storage when strict mode has rejected lines", async () => {
		const result = await ingestCursorAutomationEvents(storageDir, {
			strict: true,
			paramKeys: ["ndjson", "strict"],
			configKeys: [],
			validation: {
				events: [
					{
						eventId: "evt-1",
						eventType: "git.commit.created",
						source: "cursor",
						occurredAt: "2026-06-06T00:00:00.000Z",
					},
				],
				rejected: [
					{
						lineNumber: 2,
						lineLength: "{ bad json".length,
						reason: "invalid_json" as const,
						message: "Unexpected token",
					},
				],
			},
		})

		expect(result).to.deep.include({
			accepted: 1,
			rejected: 1,
			stored: 0,
			duplicates: 0,
			strict: true,
			strictFailed: true,
		})
		try {
			await fs.stat(resolveCursorAutomationIngestStorePath(storageDir))
			throw new Error("expected store file to be missing")
		} catch (error) {
			expect((error as NodeJS.ErrnoException).code).to.equal("ENOENT")
		}
	})
})
