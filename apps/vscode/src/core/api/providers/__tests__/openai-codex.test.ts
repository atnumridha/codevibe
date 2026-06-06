import { expect } from "chai"
import sinon from "sinon"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { OpenAiCodexHandler } from "../openai-codex"

describe("OpenAiCodexHandler", () => {
	afterEach(() => {
		sinon.restore()
	})

	it("adds ChatGPT account and Codex installation headers", async () => {
		sinon.stub(openAiCodexOAuthManager, "getAccountId").resolves("acct_123")
		sinon.stub(openAiCodexOAuthManager, "getInstallationId").resolves("install_123")

		const handler = new OpenAiCodexHandler({})
		const headers = await (handler as any).buildCodexHeaders()

		expect(headers).to.deep.include({
			originator: "cline",
			"ChatGPT-Account-Id": "acct_123",
			"x-codex-installation-id": "install_123",
		})
		expect(headers.session_id).to.be.a("string").and.not.equal("")
		expect(headers["User-Agent"]).to.match(/^cline\//)
	})

	it("adds client_version to Codex responses endpoints", () => {
		const handler = new OpenAiCodexHandler({})

		expect((handler as any).buildResponsesUrl("0.136.0-test")).to.equal(
			"https://chatgpt.com/backend-api/codex/responses?client_version=0.136.0-test",
		)
		expect((handler as any).buildResponsesWebsocketUrl("0.136.0-test")).to.equal(
			"wss://chatgpt.com/backend-api/codex/responses?client_version=0.136.0-test",
		)
	})
})
