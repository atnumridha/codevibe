import type { BrowserActionResult } from "@shared/ExtensionMessage"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import type { ToolResponse } from "../.."
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import { sanitizeBrowserActionResult } from "./BrowserToolHandler"

export class BrowserScreenshotToolHandler implements IToolHandler {
	readonly name = ClineDefaultTool.BROWSER_SCREENSHOT

	getDescription(block: ToolUse): string {
		const tabId = getOptionalString(block.params.tab_id)
		return tabId ? `[${block.name} for '${tabId}']` : `[${block.name}]`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		try {
			const tabId = getOptionalString(block.params.tab_id)
			if (tabId && tabId !== "active") {
				config.taskState.consecutiveMistakeCount++
				return formatResponse.toolError("Only active tab browser screenshots are currently supported.")
			}

			const fullPage = getOptionalBoolean(block.params.full_page, false)
			config.taskState.consecutiveMistakeCount = 0
			await config.callbacks.say("browser_action_result", "")

			const browserActionResult = sanitizeBrowserActionResult(
				await config.services.browserSession.snapshot({
					tabId,
					includeScreenshot: true,
					includeLogs: false,
					fullPage,
				}),
			)
			await config.callbacks.say("browser_action_result", JSON.stringify(toScreenshotPreview(browserActionResult)))

			return formatBrowserScreenshotResult(browserActionResult)
		} catch (error) {
			config.taskState.consecutiveMistakeCount++
			const message = error instanceof Error ? error.message : String(error)
			return formatResponse.toolError(`Browser screenshot failed: ${message}`)
		}
	}
}

function formatBrowserScreenshotResult(result: BrowserActionResult): ToolResponse {
	return formatResponse.toolResult(
		`The browser screenshot has been captured.

URL: ${result.currentUrl || "(unknown)"}
Tab: ${result.tabId || "active"}
Title: ${result.title || "(untitled)"}

(REMEMBER: while the browser is active, continue with \`browser_action\`, \`browser_snapshot\`, or \`browser_screenshot\`; close the browser with \`browser_action\` before using non-browser tools.)`,
		result.screenshot ? [result.screenshot] : [],
	)
}

function toScreenshotPreview(result: BrowserActionResult): BrowserActionResult {
	return {
		screenshot: result.screenshot,
		currentUrl: result.currentUrl,
		tabId: result.tabId,
		title: result.title,
	}
}

function getOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function getOptionalBoolean(value: unknown, defaultValue: boolean): boolean {
	if (value === undefined || value === null || value === "") {
		return defaultValue
	}
	if (typeof value === "boolean") {
		return value
	}
	if (typeof value !== "string") {
		return defaultValue
	}
	const normalized = value.trim().toLowerCase()
	if (["true", "1", "yes"].includes(normalized)) {
		return true
	}
	if (["false", "0", "no"].includes(normalized)) {
		return false
	}
	return defaultValue
}
