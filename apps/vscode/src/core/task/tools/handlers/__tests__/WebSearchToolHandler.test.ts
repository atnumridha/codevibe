import assert from "node:assert/strict"
import axios from "axios"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { AuthService } from "@/services/auth/AuthService"
import { getFeatureFlagsService } from "@/services/feature-flags"
import { ClineDefaultTool } from "@/shared/tools"
import { MIN_WEB_SEARCH_QUERY_LENGTH, WebSearchToolHandler } from "../WebSearchToolHandler"

function createConfig() {
	const policy = {
		source: "cursor-sandbox",
		status: "loaded",
		networkPolicy: { default: "deny", allow: ["example.com"] },
	}
	const callbacks = {
		sayAndCreateMissingParamError: sinon.stub().resolves("missing query"),
	}
	const config = {
		ulid: "task-web-search",
		taskState: { consecutiveMistakeCount: 0 },
		cursorSandboxPolicy: policy,
		services: {
			stateManager: {
				getApiConfiguration: sinon.stub().returns({
					planModeApiProvider: "openai-codex",
					actModeApiProvider: "openai-codex",
				}),
				getGlobalSettingsKey: sinon.stub().callsFake((key: string) => {
					if (key === "mode") {
						return "act"
					}
					if (key === "clineWebToolsEnabled") {
						return true
					}
					return undefined
				}),
			},
		},
		callbacks,
		api: {
			getModel: () => ({ id: "gpt-5-codex" }),
		},
		autoApprovalSettings: { enableNotifications: false },
	} as any

	return { config, callbacks, policy }
}

function makeWebSearchBlock(params: Record<string, string>) {
	return {
		type: "tool_use" as const,
		name: ClineDefaultTool.WEB_SEARCH,
		params,
		partial: false,
	}
}

describe("WebSearchToolHandler", () => {
	const sandbox = sinon.createSandbox()

	afterEach(() => {
		sandbox.restore()
	})

	function enableWebTools() {
		sandbox.stub(getFeatureFlagsService(), "getWebtoolsEnabled").returns(true)
		const getAuthToken = sandbox.stub().resolves("token")
		sandbox.stub(AuthService, "getInstance").returns({
			getAuthToken,
		} as unknown as AuthService)
		return {
			getAuthToken,
			post: sandbox.stub(axios, "post"),
		}
	}

	it("rejects blank web_search queries before auth or network work", async () => {
		const webTools = enableWebTools()
		const { config, callbacks } = createConfig()
		const validator = {
			checkCursorSandboxWebSearchDomains: sandbox.stub().returns({ ok: true }),
		}

		const result = await new WebSearchToolHandler(validator as any).execute(
			config,
			makeWebSearchBlock({ query: "   " }),
		)

		assert.equal(result, "missing query")
		assert.equal(callbacks.sayAndCreateMissingParamError.calledOnceWith(ClineDefaultTool.WEB_SEARCH, "query"), true)
		assert.equal(validator.checkCursorSandboxWebSearchDomains.called, false)
		assert.equal(webTools.getAuthToken.called, false)
		assert.equal(webTools.post.called, false)
	})

	it("rejects one-character web_search queries before auth or network work", async () => {
		const webTools = enableWebTools()
		const { config } = createConfig()
		const validator = {
			checkCursorSandboxWebSearchDomains: sandbox.stub().returns({ ok: true }),
		}

		const result = await new WebSearchToolHandler(validator as any).execute(
			config,
			makeWebSearchBlock({ query: " a " }),
		)

		assert.equal(config.taskState.consecutiveMistakeCount, 1)
		assert.match(String(result), new RegExp(`at least ${MIN_WEB_SEARCH_QUERY_LENGTH} characters`))
		assert.equal(validator.checkCursorSandboxWebSearchDomains.called, false)
		assert.equal(webTools.getAuthToken.called, false)
		assert.equal(webTools.post.called, false)
	})

	it("applies Cursor sandbox domain checks before approval, auth, or network work", async () => {
		const webTools = enableWebTools()
		const { config, policy } = createConfig()
		const validator = {
			checkCursorSandboxWebSearchDomains: sandbox.stub().returns({
				ok: false,
				error: "Codie sandbox blocked web search outside allowed domains.",
			}),
		}

		const result = await new WebSearchToolHandler(validator as any).execute(
			config,
			makeWebSearchBlock({ query: "example docs", allowed_domains: '["example.net"]' }),
		)

		assert.equal(config.taskState.consecutiveMistakeCount, 1)
		assert.match(String(result), /blocked web search/)
		assert.equal(validator.checkCursorSandboxWebSearchDomains.calledOnceWith(["example.net"], policy), true)
		assert.equal(webTools.getAuthToken.called, false)
		assert.equal(webTools.post.called, false)
	})
})
