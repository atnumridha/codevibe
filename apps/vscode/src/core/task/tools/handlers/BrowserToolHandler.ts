import {
	BrowserAction,
	BrowserActionResult,
	BrowserSnapshotNode,
	browserActions,
	ClineSayBrowserAction,
} from "@shared/ExtensionMessage"
import { ClineDefaultTool } from "@/shared/tools"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { ToolResponse } from "../.."
import { showNotificationForApproval } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

const MAX_BROWSER_EVALUATE_RESULT_LENGTH = 12_000
const MAX_BROWSER_SNAPSHOT_TEXT_LENGTH = 12_000
const MAX_BROWSER_SNAPSHOT_HTML_LENGTH = 12_000
const REDACTED_VALUE = "[REDACTED]"

export function redactSensitiveBrowserText(text: string | undefined): string | undefined {
	if (!text) {
		return text
	}

	return text
		.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, `Bearer ${REDACTED_VALUE}`)
		.replace(/\b(?:sk|rk|sess|proj|org)-[A-Za-z0-9_-]{16,}\b/g, REDACTED_VALUE)
		.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, REDACTED_VALUE)
		.replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, REDACTED_VALUE)
		.replace(/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, REDACTED_VALUE)
		.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, REDACTED_VALUE)
		.replace(
			/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret|password|passwd|session|cookie)\b(\s*[:=]\s*["'`]?)([^"'\s`<>{},;]+)/gi,
			`$1$2${REDACTED_VALUE}`,
		)
		.replace(/\b(authorization|cookie)\b(\s*:\s*)([^\n]+)/gi, `$1$2${REDACTED_VALUE}`)
}

export function sanitizeBrowserActionResult(result: BrowserActionResult): BrowserActionResult {
	const redactedEvaluationResult = redactSensitiveBrowserText(result.evaluationResult)
	const redactedSnapshotText = redactSensitiveBrowserText(result.text)
	const redactedSnapshotHtml = redactSensitiveBrowserText(result.html)

	return {
		...result,
		logs: redactSensitiveBrowserText(result.logs),
		currentUrl: redactSensitiveBrowserText(result.currentUrl),
		title: redactSensitiveBrowserText(result.title),
		nodes: sanitizeBrowserSnapshotNodes(result.nodes),
		text:
			redactedSnapshotText && redactedSnapshotText.length > MAX_BROWSER_SNAPSHOT_TEXT_LENGTH
				? `${redactedSnapshotText.slice(0, MAX_BROWSER_SNAPSHOT_TEXT_LENGTH)}\n[truncated]`
				: redactedSnapshotText,
		html:
			redactedSnapshotHtml && redactedSnapshotHtml.length > MAX_BROWSER_SNAPSHOT_HTML_LENGTH
				? `${redactedSnapshotHtml.slice(0, MAX_BROWSER_SNAPSHOT_HTML_LENGTH)}\n[truncated]`
				: redactedSnapshotHtml,
		evaluationResult:
			redactedEvaluationResult && redactedEvaluationResult.length > MAX_BROWSER_EVALUATE_RESULT_LENGTH
				? `${redactedEvaluationResult.slice(0, MAX_BROWSER_EVALUATE_RESULT_LENGTH)}\n[truncated]`
				: redactedEvaluationResult,
	}
}

function sanitizeBrowserSnapshotNodes(nodes: BrowserSnapshotNode[] | undefined): BrowserSnapshotNode[] | undefined {
	return nodes?.map((node) => ({
		...node,
		name: redactSensitiveBrowserText(node.name),
		text: redactSensitiveBrowserText(node.text),
		value: redactSensitiveBrowserText(node.value),
		attributes: sanitizeBrowserSnapshotAttributes(node.attributes),
		children: sanitizeBrowserSnapshotNodes(node.children),
	}))
}

function sanitizeBrowserSnapshotAttributes(
	attributes: Record<string, string> | undefined,
): Record<string, string> | undefined {
	if (!attributes) {
		return attributes
	}

	const redactedAttributes = Object.entries(attributes).map(([key, value]) => [
		redactSensitiveBrowserText(key) ?? key,
		redactSensitiveBrowserText(value) ?? value,
	])
	return Object.fromEntries(redactedAttributes)
}

export class BrowserToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.BROWSER

	constructor(private validator?: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.action}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const action: BrowserAction | undefined = block.params.action as BrowserAction
		const url: string | undefined = block.params.url
		const coordinate: string | undefined = block.params.coordinate
		const text: string | undefined = block.params.text

		// Validate action parameter
		if (!action || !browserActions.includes(action)) {
			return // Wait for more content
		}

		// Handle partial block streaming - exact original logic
		if (action === "launch") {
			if (uiHelpers.shouldAutoApproveTool(block.name)) {
				await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "browser_action_launch")
				await uiHelpers.say(
					"browser_action_launch",
					uiHelpers.removeClosingTag(block, "url", url),
					undefined,
					undefined,
					block.partial,
				)
			} else {
				await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "browser_action_launch")
				await uiHelpers
					.ask("browser_action_launch", uiHelpers.removeClosingTag(block, "url", url), block.partial)
					.catch(() => {})
			}
		} else {
			const displayText = uiHelpers.removeClosingTag(block, "text", text)
			await uiHelpers.say(
				this.name,
				JSON.stringify({
					action: action as BrowserAction,
					coordinate: uiHelpers.removeClosingTag(block, "coordinate", coordinate),
					text: action === "evaluate" ? redactSensitiveBrowserText(displayText) : displayText,
				} satisfies ClineSayBrowserAction),
				undefined,
				undefined,
				block.partial,
			)
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const action: BrowserAction | undefined = block.params.action as BrowserAction
		const url: string | undefined = block.params.url
		const coordinate: string | undefined = block.params.coordinate
		const text: string | undefined = block.params.text

		// Validate action parameter - following original pattern
		if (!action || !browserActions.includes(action)) {
			// if the block is complete and we don't have a valid action this is a mistake
			config.taskState.consecutiveMistakeCount++
			const errorResult = await config.callbacks.sayAndCreateMissingParamError(this.name, "action")
			await config.services.browserSession.closeBrowser()
			return errorResult
		}

		try {
			// Handle complete block execution
			let browserActionResult: BrowserActionResult

			if (action === "launch") {
				if (!url) {
					config.taskState.consecutiveMistakeCount++
					const errorResult = await config.callbacks.sayAndCreateMissingParamError(this.name, "url")
					await config.services.browserSession.closeBrowser()
					return errorResult
				}
				if (this.validator) {
					const sandboxValidation = this.validator.checkCursorSandboxUrl(url, config.cursorSandboxPolicy)
					if (!sandboxValidation.ok) {
						config.taskState.consecutiveMistakeCount++
						return formatResponse.toolError(sandboxValidation.error)
					}
				}
				config.taskState.consecutiveMistakeCount = 0

				// Handle approval flow for launch using callbacks
				const autoApprover = config.autoApprover || { shouldAutoApproveTool: () => false }
				if (autoApprover.shouldAutoApproveTool(block.name)) {
					await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "browser_action_launch")
					await config.callbacks.say("browser_action_launch", url, undefined, undefined, false)
				} else {
					// Show notification for approval if enabled
					showNotificationForApproval(
						`Cline wants to use a browser and launch ${url}`,
						config.autoApprovalSettings.enableNotifications,
					)
					await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "browser_action_launch")
					const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("browser_action_launch", url, config)
					if (!didApprove) {
						return formatResponse.toolDenied()
					}
				}

				// Run PreToolUse hook after approval but before execution
				try {
					const { ToolHookUtils } = await import("../utils/ToolHookUtils")
					await ToolHookUtils.runPreToolUseIfEnabled(config, block)
				} catch (error) {
					const { PreToolUseHookCancellationError } = await import("@core/hooks/PreToolUseHookCancellationError")
					if (error instanceof PreToolUseHookCancellationError) {
						return formatResponse.toolDenied()
					}
					throw error
				}

				// Start loading spinner
				await config.callbacks.say("browser_action_result", "")

				// Re-make browserSession to make sure latest settings apply
				// This updates the ToolExecutor browserSession and returns it, for us to modify the local config object accordingly. (Previously we would set config.services.browserSession = new BrowserSession... but this would not update the ToolExecutor.browserSession which is used in subsequent browser tool calls)
				config.services.browserSession = await config.callbacks.applyLatestBrowserSettings()
				await config.services.browserSession.launchBrowser()
				browserActionResult = await config.services.browserSession.navigateToUrl(url)
			} else {
				// Handle other actions (click, type, scroll, close)
				if (action === "click") {
					if (!coordinate) {
						config.taskState.consecutiveMistakeCount++
						const errorResult = await config.callbacks.sayAndCreateMissingParamError(this.name, "coordinate")
						await config.services.browserSession.closeBrowser()
						return errorResult
					}
				}
				if (action === "type") {
					if (!text) {
						config.taskState.consecutiveMistakeCount++
						const errorResult = await config.callbacks.sayAndCreateMissingParamError(this.name, "text")
						await config.services.browserSession.closeBrowser()
						return errorResult
					}
				}
				if (action === "evaluate") {
					if (!text) {
						config.taskState.consecutiveMistakeCount++
						const errorResult = await config.callbacks.sayAndCreateMissingParamError(this.name, "text")
						await config.services.browserSession.closeBrowser()
						return errorResult
					}
					if (!config.browserSettings.allowBrowserEvaluate) {
						config.taskState.consecutiveMistakeCount++
						return formatResponse.toolError(
							"Browser JavaScript evaluation is disabled. Ask the user to enable it in Browser Settings or set cline.cursorCompatibility.safeBrowserEvaluate.enabled before using the evaluate action.",
						)
					}
				}
				config.taskState.consecutiveMistakeCount = 0

				// Send browser action message
				await config.callbacks.say(
					this.name,
					JSON.stringify({
						action: action as BrowserAction,
						coordinate,
						text: action === "evaluate" ? redactSensitiveBrowserText(text) : text,
					} satisfies ClineSayBrowserAction),
					undefined,
					undefined,
					false,
				)

				// Execute the action
				const browserSession = config.services.browserSession
				switch (action) {
					case "click":
						browserActionResult = await browserSession.click(coordinate!)
						break
					case "type":
						browserActionResult = await browserSession.type(text!)
						break
					case "scroll_down":
						browserActionResult = await browserSession.scrollDown()
						break
					case "scroll_up":
						browserActionResult = await browserSession.scrollUp()
						break
					case "evaluate":
						browserActionResult = await browserSession.evaluate(text!)
						break
					case "close":
						browserActionResult = await browserSession.closeBrowser()
						break
				}
			}

			browserActionResult = sanitizeBrowserActionResult(browserActionResult)

			// Handle results based on action type
			switch (action) {
				case "launch":
				case "click":
				case "type":
				case "scroll_down":
				case "scroll_up":
				case "evaluate":
					await config.callbacks.say("browser_action_result", JSON.stringify(browserActionResult))
					const evaluateResult = browserActionResult.evaluationResult
						? `\n\nEvaluation result:\n${browserActionResult.evaluationResult}`
						: ""
					const result = formatResponse.toolResult(
						`The browser action has been executed. The console logs and screenshot have been captured for your analysis.${evaluateResult}\n\nConsole logs:\n${
							browserActionResult.logs || "(No new logs)"
						}\n\n(REMEMBER: if you need to proceed to using non-\`browser_action\` tools or launch a new browser, you MUST first close this browser. For example, if after analyzing the logs and screenshot you need to edit a file, you must first close the browser before you can use the write_to_file tool.)`,
						browserActionResult.screenshot ? [browserActionResult.screenshot] : [],
					)

					return result

				case "close":
					const closeResult = formatResponse.toolResult(
						`The browser has been closed. You may now proceed to using other tools.`,
					)
					return closeResult
			}
		} catch (error) {
			await config.services.browserSession.closeBrowser() // if any error occurs, the browser session is terminated
			throw error
		}
	}
}
