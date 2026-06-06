import assert from "node:assert/strict"
import { ClineDefaultTool } from "@shared/tools"
import { describe, it } from "mocha"
import sinon from "sinon"
import { BrowserToolHandler, sanitizeBrowserActionResult } from "../BrowserToolHandler"

function createConfig(allowBrowserEvaluate: boolean, evaluateResult?: unknown) {
	const browserSession = {
		evaluate: sinon.stub().resolves(evaluateResult ?? {}),
		closeBrowser: sinon.stub().resolves({}),
	}
	const callbacks = {
		say: sinon.stub().resolves(undefined),
		sayAndCreateMissingParamError: sinon.stub().resolves("missing"),
	}

	return {
		config: {
			taskState: { consecutiveMistakeCount: 0 },
			browserSettings: { allowBrowserEvaluate },
			services: { browserSession },
			callbacks,
		} as any,
		browserSession,
		callbacks,
	}
}

function makeEvaluateBlock(text = "document.title") {
	return {
		type: "tool_use" as const,
		name: ClineDefaultTool.BROWSER,
		params: { action: "evaluate", text },
		partial: false,
	}
}

describe("BrowserToolHandler evaluate safety", () => {
	it("redacts likely secrets from browser action results", () => {
		const result = sanitizeBrowserActionResult({
			logs: "Authorization: Bearer secret-token-value-1234567890",
			currentUrl: "https://example.com/?access_token=secret-token-value-1234567890",
			evaluationResult: JSON.stringify({
				apiKey: "sk-secret-value-1234567890",
				ok: true,
			}),
		})

		const serialized = JSON.stringify(result)
		assert(!serialized.includes("secret-token-value-1234567890"))
		assert(!serialized.includes("sk-secret-value-1234567890"))
		assert(serialized.includes("[REDACTED]"))
	})

	it("rejects evaluate when browser JavaScript evaluation is disabled", async () => {
		const { config, browserSession } = createConfig(false)
		const response = await new BrowserToolHandler().execute(config, makeEvaluateBlock())

		assert.equal(browserSession.evaluate.called, false)
		assert.equal(config.taskState.consecutiveMistakeCount, 1)
		assert(String(response).includes("Browser JavaScript evaluation is disabled"))
	})

	it("runs evaluate when enabled and redacts returned output", async () => {
		const { config, browserSession, callbacks } = createConfig(true, {
			screenshot: "data:image/png;base64,abc",
			logs: "token=secret-token-value-1234567890",
			evaluationResult: "apiKey = sk-secret-value-1234567890",
			currentUrl: "https://example.com/?access_token=secret-token-value-1234567890",
		})

		const response = await new BrowserToolHandler().execute(config, makeEvaluateBlock("window.localStorage"))
		const serializedResponse = JSON.stringify(response)
		const resultSay = callbacks.say.getCalls().find((call) => call.args[0] === "browser_action_result")

		assert.equal(browserSession.evaluate.calledOnceWith("window.localStorage"), true)
		assert(resultSay)
		assert(!String(resultSay?.args[1]).includes("secret-token-value-1234567890"))
		assert(!String(resultSay?.args[1]).includes("sk-secret-value-1234567890"))
		assert(!serializedResponse.includes("secret-token-value-1234567890"))
		assert(!serializedResponse.includes("sk-secret-value-1234567890"))
		assert(serializedResponse.includes("[REDACTED]"))
	})
})
