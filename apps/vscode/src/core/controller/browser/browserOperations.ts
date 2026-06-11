import {
	BrowserAction,
	type BrowserActionResult,
	type BrowserSnapshotNode as BrowserSnapshotNodeValue,
	browserActions,
} from "@shared/ExtensionMessage"
import { getEffectiveBrowserSettings } from "@shared/BrowserSettings"
import {
	BrowserActionRequest,
	BrowserPageResult,
	BrowserScreenshotRequest,
	BrowserSnapshotNode,
	BrowserSnapshotRequest,
	BrowserTab,
	BrowserTabs,
} from "@shared/proto/cline/browser"
import { EmptyRequest } from "@shared/proto/cline/common"
import { BrowserSession } from "@/services/browser/BrowserSession"
import { Logger } from "@/shared/services/Logger"
import { getCodeVibeConfigurationValue } from "@/utils/codevibe-config"
import { validateCursorSandboxUrl } from "../../task/tools/ToolValidator"
import {
	sanitizeBrowserActionResult,
	validateBrowserClickCoordinate,
} from "../../task/tools/handlers/BrowserToolHandler"
import { Controller } from "../index"

function getActiveBrowserSession(controller: Controller): BrowserSession {
	const browserSession = controller.task?.browserSession
	if (!browserSession) {
		throw new Error("No active managed browser session is available.")
	}
	return browserSession
}

function requireActiveTab(tabId?: string): string | undefined {
	const normalized = tabId?.trim()
	if (normalized && normalized !== "active") {
		throw new Error("Only the active browser tab is currently supported.")
	}
	return normalized || undefined
}

function getEffectiveControllerBrowserSettings(controller: Controller) {
	return getEffectiveBrowserSettings(controller.stateManager.getGlobalSettingsKey("browserSettings"), {
		cursorCompatibilitySafeBrowserEvaluateEnabled:
			getCodeVibeConfigurationValue<boolean>("cursorCompatibility.enabled", true) &&
			getCodeVibeConfigurationValue<boolean>("cursorCompatibility.safeBrowserEvaluate.enabled", false),
	})
}

function optionalString(value: string | undefined): string | undefined {
	const normalized = value?.trim()
	return normalized || undefined
}

function assertCursorSandboxBrowserUrlAllowed(controller: Controller, url: string): void {
	const validation = validateCursorSandboxUrl(url, controller.task?.getCursorSandboxPolicy?.())
	if (!validation.ok) {
		throw new Error(validation.error)
	}
}

function toProtoNode(node: BrowserSnapshotNodeValue): BrowserSnapshotNode {
	return BrowserSnapshotNode.create({
		ref: optionalString(node.ref),
		role: optionalString(node.role),
		name: optionalString(node.name),
		text: optionalString(node.text),
		value: optionalString(node.value),
		attributes: node.attributes ?? {},
		children: node.children?.map(toProtoNode) ?? [],
	})
}

function toBrowserPageResult(result: BrowserActionResult): BrowserPageResult {
	const sanitized = sanitizeBrowserActionResult(result)
	return BrowserPageResult.create({
		screenshot: optionalString(
			typeof sanitized.screenshot === "string" ? sanitized.screenshot : undefined,
		),
		logs: optionalString(sanitized.logs),
		evaluationResult: optionalString(sanitized.evaluationResult),
		currentUrl: optionalString(sanitized.currentUrl),
		currentMousePosition: optionalString(sanitized.currentMousePosition),
		tabId: optionalString(sanitized.tabId),
		title: optionalString(sanitized.title),
		text: optionalString(sanitized.text),
		html: optionalString(sanitized.html),
		nodes: sanitized.nodes?.map(toProtoNode) ?? [],
	})
}

export async function listBrowserTabs(controller: Controller, _: EmptyRequest): Promise<BrowserTabs> {
	try {
		const browserSession = controller.task?.browserSession
		const info = browserSession?.getConnectionInfo()
		if (!info?.isConnected) {
			return BrowserTabs.create({ tabs: [] })
		}
		return BrowserTabs.create({
			tabs: [
				BrowserTab.create({
					id: "active",
					active: true,
					isRemote: info.isRemote,
					host: optionalString(info.host),
				}),
			],
		})
	} catch (error) {
		Logger.error("Error listing browser tabs:", error)
		return BrowserTabs.create({ tabs: [] })
	}
}

export async function browserSnapshot(
	controller: Controller,
	request: BrowserSnapshotRequest,
): Promise<BrowserPageResult> {
	const tabId = requireActiveTab(request.tabId)
	const browserSession = getActiveBrowserSession(controller)
	return toBrowserPageResult(
		await browserSession.snapshot({
			tabId,
			includeScreenshot: request.includeScreenshot ?? true,
			includeLogs: request.includeLogs ?? true,
		}),
	)
}

export async function browserScreenshot(
	controller: Controller,
	request: BrowserScreenshotRequest,
): Promise<BrowserPageResult> {
	const tabId = requireActiveTab(request.tabId)
	const browserSession = getActiveBrowserSession(controller)
	return toBrowserPageResult(
		await browserSession.snapshot({
			tabId,
			includeScreenshot: true,
			includeLogs: false,
			fullPage: request.fullPage === true,
		}),
	)
}

export async function browserAction(
	controller: Controller,
	request: BrowserActionRequest,
): Promise<BrowserPageResult> {
	const action = request.action as BrowserAction
	if (!action || !browserActions.includes(action)) {
		throw new Error("Browser action is required.")
	}
	requireActiveTab(request.tabId)
	const browserSession = getActiveBrowserSession(controller)

	switch (action) {
		case "launch": {
			const url = optionalString(request.url)
			if (!url) {
				throw new Error("url is required for browser launch.")
			}
			assertCursorSandboxBrowserUrlAllowed(controller, url)
			await browserSession.launchBrowser()
			return toBrowserPageResult(await browserSession.navigateToUrl(url))
		}
		case "navigate": {
			const url = optionalString(request.url)
			if (!url) {
				throw new Error("url is required for browser navigate.")
			}
			assertCursorSandboxBrowserUrlAllowed(controller, url)
			return toBrowserPageResult(await browserSession.navigateToUrl(url))
		}
		case "click": {
			const coordinate = optionalString(request.coordinate)
			if (!coordinate) {
				throw new Error("coordinate is required for browser click.")
			}
			const browserSettings = getEffectiveControllerBrowserSettings(controller)
			const validation = validateBrowserClickCoordinate(coordinate, browserSettings.viewport)
			if (!validation.ok) {
				throw new Error(validation.error ?? "Browser click coordinate is invalid.")
			}
			return toBrowserPageResult(await browserSession.click(coordinate))
		}
		case "hover": {
			const coordinate = optionalString(request.coordinate)
			if (!coordinate) {
				throw new Error("coordinate is required for browser hover.")
			}
			const browserSettings = getEffectiveControllerBrowserSettings(controller)
			const validation = validateBrowserClickCoordinate(coordinate, browserSettings.viewport)
			if (!validation.ok) {
				throw new Error(validation.error ?? "Browser coordinate is invalid.")
			}
			return toBrowserPageResult(await browserSession.hover(coordinate))
		}
		case "fill": {
			const coordinate = optionalString(request.coordinate)
			if (!coordinate) {
				throw new Error("coordinate is required for browser fill.")
			}
			const text = request.text ?? ""
			if (!text) {
				throw new Error("text is required for browser fill.")
			}
			const browserSettings = getEffectiveControllerBrowserSettings(controller)
			const validation = validateBrowserClickCoordinate(coordinate, browserSettings.viewport)
			if (!validation.ok) {
				throw new Error(validation.error ?? "Browser coordinate is invalid.")
			}
			return toBrowserPageResult(await browserSession.fill(coordinate, text))
		}
		case "select": {
			const coordinate = optionalString(request.coordinate)
			if (!coordinate) {
				throw new Error("coordinate is required for browser select.")
			}
			const text = request.text ?? ""
			if (!text) {
				throw new Error("text is required for browser select.")
			}
			const browserSettings = getEffectiveControllerBrowserSettings(controller)
			const validation = validateBrowserClickCoordinate(coordinate, browserSettings.viewport)
			if (!validation.ok) {
				throw new Error(validation.error ?? "Browser coordinate is invalid.")
			}
			return toBrowserPageResult(await browserSession.select(coordinate, text))
		}
		case "type": {
			const text = request.text ?? ""
			if (!text) {
				throw new Error("text is required for browser type.")
			}
			return toBrowserPageResult(await browserSession.type(text))
		}
		case "key_press": {
			const text = request.text ?? ""
			if (!text) {
				throw new Error("text is required for browser key_press.")
			}
			return toBrowserPageResult(await browserSession.keyPress(text))
		}
		case "scroll_down":
			return toBrowserPageResult(await browserSession.scrollDown())
		case "scroll_up":
			return toBrowserPageResult(await browserSession.scrollUp())
		case "evaluate": {
			const text = request.text ?? ""
			if (!text) {
				throw new Error("text is required for browser evaluate.")
			}
			const browserSettings = getEffectiveControllerBrowserSettings(controller)
			if (!browserSettings.allowBrowserEvaluate) {
				throw new Error(
					"Browser JavaScript evaluation is disabled. Enable Browser Settings or codevibe.compatibility.safeBrowserEvaluate.enabled before using evaluate.",
				)
			}
			return toBrowserPageResult(await browserSession.evaluate(text))
		}
		case "close":
			return toBrowserPageResult(await browserSession.closeBrowser())
		default:
			throw new Error(`Unsupported browser action: ${String(action)}`)
	}
}
