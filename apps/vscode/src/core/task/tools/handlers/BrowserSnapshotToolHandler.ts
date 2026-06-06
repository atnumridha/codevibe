import type { BrowserActionResult } from "@shared/ExtensionMessage"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import type { ToolResponse } from "../.."
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import { sanitizeBrowserActionResult } from "./BrowserToolHandler"

const MAX_BROWSER_SNAPSHOT_DOM_LENGTH = 12_000

export class BrowserSnapshotToolHandler implements IToolHandler {
	readonly name = ClineDefaultTool.BROWSER_SNAPSHOT

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		try {
			const tabId = getOptionalString(block.params.tab_id)
			if (tabId && tabId !== "active") {
				config.taskState.consecutiveMistakeCount++
				return formatResponse.toolError("Only active tab browser snapshots are currently supported.")
			}

			config.taskState.consecutiveMistakeCount = 0
			await config.callbacks.say("browser_action_result", "")

			const browserActionResult = sanitizeBrowserActionResult(
				await config.services.browserSession.snapshot({
					tabId,
					includeScreenshot: getOptionalBoolean(block.params.include_screenshot, true),
					includeLogs: getOptionalBoolean(block.params.include_logs, true),
				}),
			)
			await config.callbacks.say("browser_action_result", JSON.stringify(browserActionResult))

			return formatBrowserSnapshotResult(browserActionResult)
		} catch (error) {
			config.taskState.consecutiveMistakeCount++
			const message = error instanceof Error ? error.message : String(error)
			return formatResponse.toolError(`Browser snapshot failed: ${message}`)
		}
	}
}

function formatBrowserSnapshotResult(result: BrowserActionResult): ToolResponse {
	const domSnapshot = formatBrowserSnapshotDom(result)

	return formatResponse.toolResult(
		`The browser snapshot has been captured. Use the screenshot, URL, title, visible page text, DOM snapshot, and console logs to decide the next browser action.

URL: ${result.currentUrl || "(unknown)"}
Tab: ${result.tabId || "active"}
Title: ${result.title || "(untitled)"}

Visible page text:
${result.text || "(No visible text captured)"}

DOM snapshot:
${domSnapshot}

Console logs:
${result.logs || "(No new logs)"}

(REMEMBER: while the browser is active, continue with \`browser_action\` or \`browser_snapshot\`; close the browser with \`browser_action\` before using non-browser tools.)`,
		result.screenshot ? [result.screenshot] : [],
	)
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

function formatBrowserSnapshotDom(result: BrowserActionResult): string {
	const serializedNodes =
		result.nodes && result.nodes.length > 0 ? JSON.stringify(result.nodes, null, 2) : result.html || ""
	if (!serializedNodes) {
		return "(No DOM snapshot captured)"
	}

	if (serializedNodes.length <= MAX_BROWSER_SNAPSHOT_DOM_LENGTH) {
		return serializedNodes
	}

	return `${serializedNodes.slice(0, MAX_BROWSER_SNAPSHOT_DOM_LENGTH)}\n[truncated]`
}
