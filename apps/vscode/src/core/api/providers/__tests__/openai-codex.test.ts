import { expect } from "chai"
import sinon from "sinon"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { mockFetchForTesting } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
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
		expect(headers["User-Agent"]).to.match(/^CodeVibe\//)
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

	it("preserves authenticated backend model ids that are not bundled", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "gpt-6-codex-preview" })

		const model = handler.getModel()

		expect(model.id).to.equal("gpt-6-codex-preview")
		expect(model.info.name).to.equal("gpt-6-codex-preview")
		expect(model.info.supportsPromptCache).to.equal(true)
	})

	it("falls back to the bundled default when no Codex model is selected", () => {
		const handler = new OpenAiCodexHandler({ apiModelId: "  " })

		const model = handler.getModel()

		expect(model.id).to.equal("gpt-5.5")
		expect(model.info.supportsPromptCache).to.equal(true)
	})

	it("redacts Codex backend error messages before throwing", async () => {
		const accessToken = "codex-access-secret"
		const refreshToken = "codex-refresh-secret"
		const handler = new OpenAiCodexHandler({})
		sinon.stub(handler as any, "buildCodexHeaders").resolves({})

		const mockFetch = sinon.stub().resolves(
			new Response(
				JSON.stringify({
					error: {
						message: `backend echoed ${accessToken} and {"refresh_token":"${refreshToken}","authorization":"Bearer ${accessToken}"}`,
					},
				}),
				{ status: 500, statusText: "Internal Server Error" },
			),
		)

		await mockFetchForTesting(mockFetch as any, async () => {
			let thrown: Error | undefined
			try {
				for await (const _ of (handler as any).makeCodexRequest({}, handler.getModel(), accessToken, "0.136.0-test")) {
					// The mocked response fails before yielding stream chunks.
				}
			} catch (error) {
				thrown = error as Error
			}

			expect(thrown?.message).to.contain("Codex API error:")
			expect(thrown?.message).to.contain("[REDACTED]")
			expect(thrown?.message).not.to.contain(accessToken)
			expect(thrown?.message).not.to.contain(refreshToken)
		})
	})

	it("redacts Codex backend account, installation, and session identifiers before throwing", async () => {
		const accessToken = "codex-access-secret"
		const accountId = "acct_secret_identifier"
		const installationId = "install_secret_identifier"
		const sessionId = "session_secret_identifier"
		const handler = new OpenAiCodexHandler({})
		sinon.stub(handler as any, "buildCodexHeaders").resolves({
			"ChatGPT-Account-Id": accountId,
			"x-codex-installation-id": installationId,
			session_id: sessionId,
		})

		const mockFetch = sinon.stub().resolves(
			new Response(
				JSON.stringify({
					error: {
						message: `backend echoed ${accountId}, ${installationId}, ${sessionId}, and Bearer ${accessToken}`,
					},
				}),
				{ status: 500, statusText: "Internal Server Error" },
			),
		)

		await mockFetchForTesting(mockFetch as any, async () => {
			let thrown: Error | undefined
			try {
				for await (const _ of (handler as any).makeCodexRequest({}, handler.getModel(), accessToken, "0.136.0-test")) {
					// The mocked response fails before yielding stream chunks.
				}
			} catch (error) {
				thrown = error as Error
			}

			expect(thrown?.message).to.contain("[REDACTED]")
			expect(thrown?.message).not.to.contain(accessToken)
			expect(thrown?.message).not.to.contain(accountId)
			expect(thrown?.message).not.to.contain(installationId)
			expect(thrown?.message).not.to.contain(sessionId)
		})
	})

	it("redacts Codex websocket errors before logging HTTP fallback", async () => {
		const accessToken = "codex-websocket-access-secret"
		const refreshToken = "codex-websocket-refresh-secret"
		const handler = new OpenAiCodexHandler({})
		sinon.stub(handler as any, "buildCodexHeaders").resolves({})
		sinon.stub(openAiCodexOAuthManager, "getClientVersion").resolves("0.136.0-test")
		sinon.stub(handler as any, "createResponseStreamWebsocket").callsFake(async function* () {
			const error = new Error(
				`websocket echoed Bearer ${accessToken} and {"refresh_token":"${refreshToken}","authorization":"Bearer ${accessToken}"}`,
			) as Error & { code?: string }
			error.code = "websocket_error"
			throw error
		})
		sinon.stub(handler as any, "makeCodexRequest").callsFake(async function* () {
			// HTTP fallback succeeds without yielding chunks.
		})
		const logStub = sinon.stub(Logger, "error")

		for await (const _ of (handler as any).executeRequest({}, {}, handler.getModel(), accessToken, true)) {
			// The mocked fallback completes without stream chunks.
		}

		const logged = logStub.firstCall.args
			.map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack ?? ""}` : String(arg)))
			.join("\n")
		expect(logged).to.contain("[REDACTED]")
		expect(logged).not.to.contain(accessToken)
		expect(logged).not.to.contain(refreshToken)
	})
})
