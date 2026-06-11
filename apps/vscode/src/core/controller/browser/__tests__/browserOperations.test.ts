import { strict as assert } from "node:assert"
import os from "node:os"
import path from "node:path"
import type { CursorSandboxRuntimePolicy } from "@core/config/cursor-sandbox"
import { BrowserActionRequest } from "@shared/proto/cline/browser"
import { describe, it } from "mocha"
import sinon from "sinon"
import { browserAction } from "../browserOperations"

function makePolicy(networkPolicy: CursorSandboxRuntimePolicy["networkPolicy"]): CursorSandboxRuntimePolicy {
	const workspaceRoot = path.join(os.tmpdir(), "codevibe-browser-sandbox-workspace")
	return {
		source: "cursor-sandbox",
		status: "loaded",
		configPath: path.join(workspaceRoot, ".cursor", "sandbox.json"),
		workspaceRoot,
		effectiveAccess: "workspace",
		readablePaths: [workspaceRoot],
		writablePaths: [workspaceRoot],
		networkPolicy,
		blockGitWrites: false,
		disableTmpWrite: false,
		enableSharedBuildCache: false,
		allowReadAutoApprove: true,
		allowWriteAutoApprove: true,
		allowTerminalAutoApprove: false,
		allowNetworkAutoApprove: networkPolicy.default === "allow",
	}
}

function createController(policy?: CursorSandboxRuntimePolicy) {
	const browserSession = {
		launchBrowser: sinon.stub().resolves(undefined),
		navigateToUrl: sinon.stub().callsFake(async (url: string) => ({ currentUrl: url })),
	}

	const controller = {
		task: {
			browserSession,
			getCursorSandboxPolicy: () => policy,
		},
		stateManager: {
			getGlobalSettingsKey: sinon.stub(),
		},
	} as any

	return { browserSession, controller }
}

describe("browserOperations Cursor sandbox network policy", () => {
	it("rejects controller browser launch before opening a denied URL", async () => {
		const { browserSession, controller } = createController(
			makePolicy({ default: "deny", allow: ["allowed.example.com"] }),
		)

		await assert.rejects(
			browserAction(
				controller,
				BrowserActionRequest.create({
					action: "launch",
					url: "https://blocked.example.com/path",
				}),
			),
			/Network access to blocked\.example\.com is blocked by \.cursor\/sandbox\.json networkPolicy/,
		)

		sinon.assert.notCalled(browserSession.launchBrowser)
		sinon.assert.notCalled(browserSession.navigateToUrl)
	})

	it("rejects controller browser navigate before opening a denied URL", async () => {
		const { browserSession, controller } = createController(
			makePolicy({ default: "deny", allow: ["allowed.example.com"] }),
		)

		await assert.rejects(
			browserAction(
				controller,
				BrowserActionRequest.create({
					action: "navigate",
					url: "https://blocked.example.com/path",
				}),
			),
			/Network access to blocked\.example\.com is blocked by \.cursor\/sandbox\.json networkPolicy/,
		)

		sinon.assert.notCalled(browserSession.navigateToUrl)
	})

	it("allows controller browser launch and navigate for sandbox-allowed URLs", async () => {
		const { browserSession, controller } = createController(
			makePolicy({ default: "deny", allow: ["allowed.example.com"] }),
		)

		const launchResult = await browserAction(
			controller,
			BrowserActionRequest.create({
				action: "launch",
				url: "https://allowed.example.com/start",
			}),
		)
		const navigateResult = await browserAction(
			controller,
			BrowserActionRequest.create({
				action: "navigate",
				url: "https://allowed.example.com/next",
			}),
		)

		assert.equal(launchResult.currentUrl, "https://allowed.example.com/start")
		assert.equal(navigateResult.currentUrl, "https://allowed.example.com/next")
		sinon.assert.calledOnce(browserSession.launchBrowser)
		sinon.assert.calledTwice(browserSession.navigateToUrl)
	})
})
