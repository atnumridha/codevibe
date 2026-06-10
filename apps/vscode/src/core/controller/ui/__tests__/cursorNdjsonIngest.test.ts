import { expect } from "chai"
import { afterEach, describe, it } from "mocha"
import { EmptyRequest } from "@shared/proto/cline/common"
import {
	registerCursorNdjsonIngestBridge,
	resetCursorNdjsonIngestBridge,
} from "@/services/automation/CursorNdjsonIngestBridge"
import { getCursorNdjsonIngestCurlCommand } from "../getCursorNdjsonIngestCurlCommand"
import { getCursorNdjsonIngestStatus } from "../getCursorNdjsonIngestStatus"
import { reassignCursorNdjsonIngestPort } from "../reassignCursorNdjsonIngestPort"
import { startCursorNdjsonIngest } from "../startCursorNdjsonIngest"
import { stopCursorNdjsonIngest } from "../stopCursorNdjsonIngest"

describe("ui cursor NDJSON ingest controls", () => {
	afterEach(() => {
		resetCursorNdjsonIngestBridge()
	})

	it("routes status, start, stop, reassign, and curl requests through the registered bridge", async () => {
		const calls: string[] = []
		registerCursorNdjsonIngestBridge({
			getStatus: () => {
				calls.push("status")
				return { running: false, bindAddress: "127.0.0.1" }
			},
			start: async () => {
				calls.push("start")
				return { running: true, bindAddress: "127.0.0.1", port: 7242, url: "http://127.0.0.1:7242" }
			},
			stop: async () => {
				calls.push("stop")
				return { running: false, bindAddress: "127.0.0.1" }
			},
			reassignPort: async () => {
				calls.push("reassign")
				return { running: true, bindAddress: "127.0.0.1", port: 7243, url: "http://127.0.0.1:7243" }
			},
			buildCurlCommand: async () => {
				calls.push("curl")
				return "curl -X POST 'http://127.0.0.1:7243/ingest' --data-binary @events.ndjson"
			},
		})

		const request = EmptyRequest.create({})

		expect((await getCursorNdjsonIngestStatus({} as any, request)).running).to.equal(false)
		expect((await startCursorNdjsonIngest({} as any, request)).port).to.equal(7242)
		expect((await stopCursorNdjsonIngest({} as any, request)).running).to.equal(false)
		expect((await reassignCursorNdjsonIngestPort({} as any, request)).port).to.equal(7243)
		expect((await getCursorNdjsonIngestCurlCommand({} as any, request)).value).to.contain("curl -X POST")
		expect(calls).to.deep.equal(["status", "start", "stop", "reassign", "curl"])
	})
})
