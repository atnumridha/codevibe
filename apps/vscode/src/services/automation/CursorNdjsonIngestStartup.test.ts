import { expect } from "chai"
import { describe, it } from "mocha"
import sinon from "sinon"
import {
	isCursorNdjsonLoopbackBindAddress,
	maybeAutoStartCursorNdjsonIngestServer,
	shouldAutoStartCursorNdjsonIngest,
} from "./CursorNdjsonIngestStartup"

describe("CursorNdjsonIngestStartup", () => {
	it("skips auto-start when port is zero", async () => {
		const server = { start: sinon.stub().resolves({ running: true, bindAddress: "127.0.0.1", port: 7242 }) }
		const confirm = sinon.stub().resolves(true)

		const status = await maybeAutoStartCursorNdjsonIngestServer({
			settings: { port: 0, bindAddress: "127.0.0.1" },
			server,
			confirmNonLoopbackBindAddress: confirm,
		})

		expect(status).to.equal(undefined)
		expect(shouldAutoStartCursorNdjsonIngest({ port: 0 })).to.equal(false)
		sinon.assert.notCalled(confirm)
		sinon.assert.notCalled(server.start)
	})

	it("starts loopback fixed ports without prompting for non-loopback confirmation", async () => {
		const status = { running: true, bindAddress: "127.0.0.1", port: 7242 }
		const server = { start: sinon.stub().resolves(status) }
		const confirm = sinon.stub().resolves(false)

		const result = await maybeAutoStartCursorNdjsonIngestServer({
			settings: { port: 7242, bindAddress: "127.0.0.1" },
			server,
			confirmNonLoopbackBindAddress: confirm,
		})

		expect(result).to.deep.equal(status)
		expect(isCursorNdjsonLoopbackBindAddress("localhost")).to.equal(true)
		expect(isCursorNdjsonLoopbackBindAddress("127.0.0.1")).to.equal(true)
		sinon.assert.notCalled(confirm)
		sinon.assert.calledOnceWithExactly(server.start, { port: 7242, bindAddress: "127.0.0.1" })
	})

	it("starts non-loopback fixed ports only after confirmation", async () => {
		const status = { running: true, bindAddress: "0.0.0.0", port: 7242 }
		const server = { start: sinon.stub().resolves(status) }
		const confirm = sinon.stub().resolves(true)

		const result = await maybeAutoStartCursorNdjsonIngestServer({
			settings: { port: 7242, bindAddress: "0.0.0.0" },
			server,
			confirmNonLoopbackBindAddress: confirm,
		})

		expect(result).to.deep.equal(status)
		expect(isCursorNdjsonLoopbackBindAddress("0.0.0.0")).to.equal(false)
		sinon.assert.calledOnceWithExactly(confirm, "0.0.0.0")
		sinon.assert.calledOnceWithExactly(server.start, { port: 7242, bindAddress: "0.0.0.0" })
	})

	it("does not start non-loopback fixed ports when confirmation is cancelled", async () => {
		const server = { start: sinon.stub().resolves({ running: true, bindAddress: "0.0.0.0", port: 7242 }) }
		const confirm = sinon.stub().resolves(false)

		const result = await maybeAutoStartCursorNdjsonIngestServer({
			settings: { port: 7242, bindAddress: "0.0.0.0" },
			server,
			confirmNonLoopbackBindAddress: confirm,
		})

		expect(result).to.equal(undefined)
		sinon.assert.calledOnceWithExactly(confirm, "0.0.0.0")
		sinon.assert.notCalled(server.start)
	})
})
