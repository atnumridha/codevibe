import assert from "node:assert/strict"
import { getEffectiveBrowserSettings } from "@shared/BrowserSettings"
import { ClineDefaultTool } from "@shared/tools"
import { describe, it } from "mocha"
import sinon from "sinon"
import { BrowserSnapshotToolHandler } from "../BrowserSnapshotToolHandler"
import { BrowserScreenshotToolHandler } from "../BrowserScreenshotToolHandler"
import { BrowserToolHandler, sanitizeBrowserActionResult } from "../BrowserToolHandler"

function createConfig(allowBrowserEvaluate: boolean, evaluateResult?: unknown) {
	const browserSession = {
		click: sinon.stub().resolves({}),
		evaluate: sinon.stub().resolves(evaluateResult ?? {}),
		fill: sinon.stub().resolves({}),
		hover: sinon.stub().resolves({}),
		keyPress: sinon.stub().resolves({}),
		navigateToUrl: sinon.stub().resolves({}),
		select: sinon.stub().resolves({}),
		type: sinon.stub().resolves({}),
		closeBrowser: sinon.stub().resolves({}),
	}
	const callbacks = {
		say: sinon.stub().resolves(undefined),
		sayAndCreateMissingParamError: sinon.stub().resolves("missing"),
	}

	return {
		config: {
			taskState: { consecutiveMistakeCount: 0 },
			browserSettings: { viewport: { width: 900, height: 600 }, allowBrowserEvaluate },
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

function makeLaunchBlock(url: string) {
	return {
		type: "tool_use" as const,
		name: ClineDefaultTool.BROWSER,
		params: { action: "launch", url },
		partial: false,
	}
}

function makeClickBlock(coordinate: string) {
	return {
		type: "tool_use" as const,
		name: ClineDefaultTool.BROWSER,
		params: { action: "click", coordinate },
		partial: false,
	}
}

function makeBrowserActionBlock(params: Record<string, string>) {
	return {
		type: "tool_use" as const,
		name: ClineDefaultTool.BROWSER,
		params,
		partial: false,
	}
}

function createLaunchConfig(navigateResult?: unknown) {
	const browserSession = {
		launchBrowser: sinon.stub().resolves(undefined),
		navigateToUrl: sinon.stub().resolves(navigateResult ?? {}),
		closeBrowser: sinon.stub().resolves({}),
	}
	const callbacks = {
		say: sinon.stub().resolves(undefined),
		sayAndCreateMissingParamError: sinon.stub().resolves("missing"),
		removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(undefined),
		applyLatestBrowserSettings: sinon.stub().resolves(browserSession),
	}

	return {
		config: {
			taskState: { consecutiveMistakeCount: 0 },
			browserSettings: { allowBrowserEvaluate: false },
			services: {
				browserSession,
				stateManager: {
					getGlobalSettingsKey: sinon.stub().returns(false),
				},
			},
			callbacks,
			autoApprovalSettings: { enableNotifications: false },
			autoApprover: { shouldAutoApproveTool: sinon.stub().returns(true) },
		} as any,
		browserSession,
		callbacks,
	}
}

function createSnapshotConfig(snapshotResult?: unknown) {
	const browserSession = {
		snapshot: sinon.stub().resolves(snapshotResult ?? {}),
		closeBrowser: sinon.stub().resolves({}),
	}
	const callbacks = {
		say: sinon.stub().resolves(undefined),
		sayAndCreateMissingParamError: sinon.stub().resolves("missing"),
	}

	return {
		config: {
			taskState: { consecutiveMistakeCount: 0 },
			browserSettings: { allowBrowserEvaluate: false },
			services: { browserSession },
			callbacks,
		} as any,
		browserSession,
		callbacks,
	}
}

function makeTypeBlock(text = "hello") {
	return {
		type: "tool_use" as const,
		name: ClineDefaultTool.BROWSER,
		params: { action: "type", text },
		partial: false,
	}
}

function makeSnapshotBlock() {
	return {
		type: "tool_use" as const,
		name: ClineDefaultTool.BROWSER_SNAPSHOT,
		params: {},
		partial: false,
	}
}

function makeSnapshotBlockWithParams(params: Record<string, unknown>) {
	return {
		type: "tool_use" as const,
		name: ClineDefaultTool.BROWSER_SNAPSHOT,
		params,
		partial: false,
	}
}

function makeScreenshotBlock(params: Record<string, unknown> = {}) {
	return {
		type: "tool_use" as const,
		name: ClineDefaultTool.BROWSER_SCREENSHOT,
		params,
		partial: false,
	}
}

function getToolResponseText(response: unknown): string {
	if (!Array.isArray(response)) {
		return String(response)
	}
	return response
		.filter((block): block is { type: string; text: string } => block?.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n")
}

function getToolResponseImageData(response: unknown): string[] {
	if (!Array.isArray(response)) {
		return []
	}
	return response
		.map((block) => (block?.type === "image" ? block.source?.data : undefined))
		.filter((data): data is string => typeof data === "string")
}

describe("BrowserToolHandler evaluate safety", () => {
	it("redacts likely secrets from browser action results", () => {
		const result = sanitizeBrowserActionResult({
			logs: "Authorization: Bearer secret-token-value-1234567890",
			currentUrl: "https://example.com/?access_token=secret-token-value-1234567890",
			title: "token=secret-token-value-1234567890",
			text: "api_key=sk-secret-value-1234567890",
			html: "<input value='password=secret-token-value-1234567890'>",
			nodes: [
				{
					role: "textbox",
					value: "password=secret-token-value-1234567890",
				},
			],
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

	it("runs evaluate when Cursor-compatible safe browser evaluate enables the effective gate", async () => {
		const { config, browserSession } = createConfig(false)
		config.browserSettings = getEffectiveBrowserSettings(
			{ viewport: { width: 900, height: 600 }, allowBrowserEvaluate: false },
			{ cursorCompatibilitySafeBrowserEvaluateEnabled: true },
		)

		await new BrowserToolHandler().execute(config, makeEvaluateBlock("document.title"))

		assert.equal(browserSession.evaluate.calledOnceWith("document.title"), true)
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

	it("redacts sensitive launch URLs in browser action display without changing navigation", async () => {
		const secretUrl = "https://example.com/?access_token=secret-token-value-1234567890"
		const { config, browserSession, callbacks } = createLaunchConfig({
			currentUrl: secretUrl,
			title: "Dashboard",
		})

		await new BrowserToolHandler().execute(config, makeLaunchBlock(secretUrl))

		const launchSay = callbacks.say.getCalls().find((call) => call.args[0] === "browser_action_launch")
		const resultSay = callbacks.say.getCalls().find((call) => call.args[0] === "browser_action_result")
		assert.equal(browserSession.navigateToUrl.calledOnceWith(secretUrl), true)
		assert(launchSay)
		assert(!String(launchSay?.args[1]).includes("secret-token-value-1234567890"))
		assert(String(launchSay?.args[1]).includes("[REDACTED]"))
		assert(resultSay)
		assert(!String(resultSay?.args[1]).includes("secret-token-value-1234567890"))
	})

	it("runs click when coordinates are numeric and inside the configured viewport", async () => {
		const { config, browserSession, callbacks } = createConfig(false)

		await new BrowserToolHandler().execute(config, makeClickBlock("450,300"))

		const actionSay = callbacks.say.getCalls().find((call) => call.args[0] === ClineDefaultTool.BROWSER)
		assert.equal(browserSession.click.calledOnceWith("450,300"), true)
		assert.equal(config.taskState.consecutiveMistakeCount, 0)
		assert(actionSay)
		assert.equal(JSON.parse(actionSay?.args[1]).coordinate, "450,300")
	})

	it("runs navigate with URL sandbox validation and redacted display", async () => {
		const { config, browserSession, callbacks } = createConfig(false)
		const validator = {
			checkCursorSandboxUrl: sinon.stub().returns({ ok: true }),
		}
		const secretUrl = "https://example.com/path?access_token=secret-token-value-1234567890"

		await new BrowserToolHandler(validator as any).execute(
			config,
			makeBrowserActionBlock({ action: "navigate", url: secretUrl }),
		)

		const actionSay = callbacks.say.getCalls().find((call) => call.args[0] === ClineDefaultTool.BROWSER)
		assert.equal(validator.checkCursorSandboxUrl.calledOnce, true)
		assert.equal(browserSession.navigateToUrl.calledOnceWith(secretUrl), true)
		assert(actionSay)
		assert(!String(actionSay?.args[1]).includes("secret-token-value-1234567890"))
		assert(String(actionSay?.args[1]).includes("[REDACTED]"))
	})

	it("dispatches Cursor-style hover, fill, select, and key_press actions", async () => {
		const { config, browserSession } = createConfig(false)
		const handler = new BrowserToolHandler()

		await handler.execute(config, makeBrowserActionBlock({ action: "hover", coordinate: "10,20" }))
		await handler.execute(config, makeBrowserActionBlock({ action: "fill", coordinate: "30,40", text: "hello" }))
		await handler.execute(config, makeBrowserActionBlock({ action: "select", coordinate: "50,60", text: "Option A" }))
		await handler.execute(config, makeBrowserActionBlock({ action: "key_press", text: "Enter" }))

		assert.equal(browserSession.hover.calledOnceWith("10,20"), true)
		assert.equal(browserSession.fill.calledOnceWith("30,40", "hello"), true)
		assert.equal(browserSession.select.calledOnceWith("50,60", "Option A"), true)
		assert.equal(browserSession.keyPress.calledOnceWith("Enter"), true)
	})

	it("rejects missing required params for Cursor-style browser actions", async () => {
		const { config, browserSession, callbacks } = createConfig(false)
		const handler = new BrowserToolHandler()

		assert.equal(await handler.execute(config, makeBrowserActionBlock({ action: "navigate" })), "missing")
		assert.equal(await handler.execute(config, makeBrowserActionBlock({ action: "hover" })), "missing")
		assert.equal(await handler.execute(config, makeBrowserActionBlock({ action: "fill", coordinate: "10,20" })), "missing")
		assert.equal(await handler.execute(config, makeBrowserActionBlock({ action: "select", coordinate: "10,20" })), "missing")
		assert.equal(await handler.execute(config, makeBrowserActionBlock({ action: "key_press" })), "missing")

		assert.equal(callbacks.sayAndCreateMissingParamError.callCount, 5)
		assert.equal(browserSession.navigateToUrl.called, false)
		assert.equal(browserSession.hover.called, false)
		assert.equal(browserSession.fill.called, false)
		assert.equal(browserSession.select.called, false)
		assert.equal(browserSession.keyPress.called, false)
	})

	it("rejects malformed browser click coordinates before clicking", async () => {
		const { config, browserSession } = createConfig(false)

		const response = await new BrowserToolHandler().execute(config, makeClickBlock("left,top"))

		assert.equal(browserSession.click.called, false)
		assert.equal(config.taskState.consecutiveMistakeCount, 1)
		assert(String(response).includes("finite numeric x and y values"))
	})

	it("rejects browser click coordinates outside the configured viewport before clicking", async () => {
		const { config, browserSession } = createConfig(false)
		config.browserSettings.viewport = { width: 100, height: 80 }

		const response = await new BrowserToolHandler().execute(config, makeClickBlock("101,40"))

		assert.equal(browserSession.click.called, false)
		assert.equal(config.taskState.consecutiveMistakeCount, 1)
		assert(String(response).includes("outside the configured 100x80 viewport"))
	})

	it("captures a read-only browser snapshot with redacted text and DOM", async () => {
		const { config, browserSession, callbacks } = createSnapshotConfig({
			screenshot: "data:image/png;base64,abc",
			logs: "Authorization: Bearer secret-token-value-1234567890",
			currentUrl: "https://example.com/?access_token=secret-token-value-1234567890",
			title: "Dashboard",
			text: "api_key=sk-secret-value-1234567890",
			html: "<input value='password=secret-token-value-1234567890'>",
			nodes: [
				{
					role: "textbox",
					value: "password=secret-token-value-1234567890",
				},
			],
		})

		const response = await new BrowserSnapshotToolHandler().execute(config, makeSnapshotBlock())
		const serializedResponse = JSON.stringify(response)
		const resultSay = callbacks.say.getCalls().find((call) => call.args[0] === "browser_action_result")

		assert.equal(browserSession.snapshot.calledOnceWith({ tabId: undefined, includeScreenshot: true, includeLogs: true }), true)
		assert.equal(browserSession.closeBrowser.called, false)
		assert(resultSay)
		assert(!String(resultSay?.args[1]).includes("secret-token-value-1234567890"))
		assert(!String(resultSay?.args[1]).includes("sk-secret-value-1234567890"))
		assert(!serializedResponse.includes("secret-token-value-1234567890"))
		assert(!serializedResponse.includes("sk-secret-value-1234567890"))
		assert(serializedResponse.includes("[REDACTED]"))
		assert(serializedResponse.includes("DOM snapshot"))
	})

	it("passes browser snapshot capture options through to the active tab", async () => {
		const { config, browserSession } = createSnapshotConfig({
			currentUrl: "https://example.com",
			tabId: "active",
			title: "Dashboard",
			text: "ready",
		})

		const response = await new BrowserSnapshotToolHandler().execute(
			config,
			makeSnapshotBlockWithParams({
				tab_id: "active",
				include_screenshot: "false",
				include_logs: "0",
			}),
		)

		assert.equal(
			browserSession.snapshot.calledOnceWith({
				tabId: "active",
				includeScreenshot: false,
				includeLogs: false,
			}),
			true,
		)
		assert(!JSON.stringify(response).includes("data:image"))
	})

	it("rejects non-active browser snapshot tab ids until multi-tab capture is available", async () => {
		const { config, browserSession } = createSnapshotConfig()

		const response = await new BrowserSnapshotToolHandler().execute(
			config,
			makeSnapshotBlockWithParams({ tab_id: "tab-2" }),
		)

		assert.equal(browserSession.snapshot.called, false)
		assert.equal(config.taskState.consecutiveMistakeCount, 1)
		assert(String(response).includes("Only active tab"))
	})

	it("returns a tool error when no active browser snapshot is available", async () => {
		const { config, browserSession } = createSnapshotConfig()
		browserSession.snapshot.rejects(new Error("Browser is not launched"))

		const response = await new BrowserSnapshotToolHandler().execute(config, makeSnapshotBlock())

		assert.equal(config.taskState.consecutiveMistakeCount, 1)
		assert(String(response).includes("Browser snapshot failed"))
	})

	it("captures a read-only browser screenshot from the active tab", async () => {
		const { config, browserSession, callbacks } = createSnapshotConfig({
			screenshot: "data:image/png;base64,abc",
			logs: "token=secret-token-value-1234567890",
			currentUrl: "https://example.com/?access_token=secret-token-value-1234567890",
			tabId: "active",
			title: "Dashboard",
			text: "SHOULD_NOT_BE_IN_PREVIEW",
			html: "<main>SHOULD_NOT_BE_IN_PREVIEW</main>",
		})

		const response = await new BrowserScreenshotToolHandler().execute(config, makeScreenshotBlock())
		const responseText = getToolResponseText(response)
		const responseImages = getToolResponseImageData(response)
		const serializedResponse = JSON.stringify(response)
		const resultSay = callbacks.say.getCalls().find((call) => call.args[0] === "browser_action_result")

		assert.equal(
			browserSession.snapshot.calledOnceWith({
				tabId: undefined,
				includeScreenshot: true,
				includeLogs: false,
				fullPage: false,
			}),
			true,
		)
		assert(resultSay)
		assert(!String(resultSay?.args[1]).includes("secret-token-value-1234567890"))
		assert(!String(resultSay?.args[1]).includes("SHOULD_NOT_BE_IN_PREVIEW"))
		assert(!serializedResponse.includes("secret-token-value-1234567890"))
		assert(responseText.includes("browser screenshot"))
		assert.deepEqual(responseImages, ["abc"])
	})

	it("rejects browser screenshots for non-active tab ids until multi-tab capture is available", async () => {
		const { config, browserSession } = createSnapshotConfig()

		const response = await new BrowserScreenshotToolHandler().execute(config, makeScreenshotBlock({ tab_id: "tab-2" }))

		assert.equal(browserSession.snapshot.called, false)
		assert.equal(config.taskState.consecutiveMistakeCount, 1)
		assert(String(response).includes("Only active tab"))
	})

	it("passes full-page browser screenshot requests through to the browser session", async () => {
		const { config, browserSession } = createSnapshotConfig({
			screenshot: "data:image/png;base64,abc",
			currentUrl: "https://example.com",
			title: "Dashboard",
		})

		const response = await new BrowserScreenshotToolHandler().execute(config, makeScreenshotBlock({ full_page: true }))

		assert.equal(
			browserSession.snapshot.calledOnceWith({
				tabId: undefined,
				includeScreenshot: true,
				includeLogs: false,
				fullPage: true,
			}),
			true,
		)
		assert.equal(config.taskState.consecutiveMistakeCount, 0)
		assert(getToolResponseText(response).includes("browser screenshot"))
	})

	it("redacts evaluate text while streaming partial browser action display", async () => {
		const say = sinon.stub().resolves(undefined)
		const uiHelpers = {
			shouldAutoApproveTool: sinon.stub().returns(false),
			removeClosingTag: sinon.stub().callsFake((_block, _tag, value) => value),
			say,
		} as any

		await new BrowserToolHandler().handlePartialBlock(
			makeEvaluateBlock("window.localStorage.setItem('apiKey', 'sk-secret-value-1234567890')"),
			uiHelpers,
		)

		const payload = JSON.parse(say.firstCall.args[1])
		assert.equal(payload.action, "evaluate")
		assert(!payload.text.includes("sk-secret-value-1234567890"))
		assert(payload.text.includes("[REDACTED]"))
	})

	it("redacts sensitive typed text in browser action display without changing browser input", async () => {
		const secretText = "api_key=sk-secret-value-1234567890"
		const { config, browserSession, callbacks } = createConfig(false)

		await new BrowserToolHandler().execute(config, makeTypeBlock(secretText))

		const actionSay = callbacks.say.getCalls().find((call) => call.args[0] === ClineDefaultTool.BROWSER)
		assert(actionSay)
		const payload = JSON.parse(actionSay?.args[1])
		assert.equal(browserSession.type.calledOnceWith(secretText), true)
		assert.equal(payload.action, "type")
		assert(!payload.text.includes("sk-secret-value-1234567890"))
		assert(payload.text.includes("[REDACTED]"))
	})

	it("redacts sensitive typed text while streaming partial browser action display", async () => {
		const say = sinon.stub().resolves(undefined)
		const uiHelpers = {
			shouldAutoApproveTool: sinon.stub().returns(false),
			removeClosingTag: sinon.stub().callsFake((_block, _tag, value) => value),
			say,
		} as any

		await new BrowserToolHandler().handlePartialBlock(
			makeTypeBlock("password=secret-token-value-1234567890"),
			uiHelpers,
		)

		const payload = JSON.parse(say.firstCall.args[1])
		assert.equal(payload.action, "type")
		assert(!payload.text.includes("secret-token-value-1234567890"))
		assert(payload.text.includes("[REDACTED]"))
	})

	it("redacts sensitive launch URLs while streaming partial browser action display", async () => {
		const ask = sinon.stub().resolves(undefined)
		const uiHelpers = {
			shouldAutoApproveTool: sinon.stub().returns(false),
			removeClosingTag: sinon.stub().callsFake((_block, _tag, value) => value),
			removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(undefined),
			ask,
		} as any

		await new BrowserToolHandler().handlePartialBlock(
			makeLaunchBlock("https://example.com/?access_token=secret-token-value-1234567890"),
			uiHelpers,
		)

		assert(!String(ask.firstCall.args[1]).includes("secret-token-value-1234567890"))
		assert(String(ask.firstCall.args[1]).includes("[REDACTED]"))
	})
})
