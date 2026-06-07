import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { StringRequest } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import { authenticateMcpServer } from "../authenticateMcpServer"

describe("authenticateMcpServer", () => {
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		sandbox.stub(Logger, "error").returns()
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("returns structured OAuth state after initiating authentication", async () => {
		const initiateOAuth = sandbox.stub().resolves()
		const response = await authenticateMcpServer(
			{
				mcpHub: {
					initiateOAuth,
					getServers: () => [
						{
							name: "linear",
							config: "{}",
							status: "disconnected",
							oauthRequired: true,
							oauthAuthStatus: "pending",
						},
					],
				},
			} as any,
			StringRequest.create({ value: " linear " }),
		)

		sinon.assert.calledOnceWithExactly(initiateOAuth, "linear")
		expect(response.initiated).to.equal(true)
		expect(response.serverName).to.equal("linear")
		expect(response.oauthRequired).to.equal(true)
		expect(response.oauthAuthStatus).to.equal("pending")
		expect(response.detail).to.equal("OAuth authentication flow initiated.")
		expect(response.error).to.equal(undefined)
	})

	it("returns structured errors when OAuth initiation fails", async () => {
		const response = await authenticateMcpServer(
			{
				mcpHub: {
					initiateOAuth: sandbox.stub().rejects(new Error("No URL found in config for server: local")),
					getServers: () => [],
				},
			} as any,
			StringRequest.create({ value: "local" }),
		)

		expect(response.initiated).to.equal(false)
		expect(response.serverName).to.equal("local")
		expect(response.error).to.contain("No URL found in config")
	})
})
