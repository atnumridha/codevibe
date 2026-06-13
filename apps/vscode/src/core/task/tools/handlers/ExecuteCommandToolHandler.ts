import type { ToolUse } from "@core/assistant-message"
import { CommandPermissionController } from "@core/permissions"
import { formatResponse } from "@core/prompts/responses"
import { WorkspacePathAdapter } from "@core/workspace/WorkspacePathAdapter"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { showApprovalNotification, showSystemNotification } from "@integrations/notifications"
import { COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import { ClineAsk } from "@shared/ExtensionMessage"
import {
	appendTerminalRequestMarker,
	appendTerminalRunModeMarker,
	type CodeVibeTerminalRunMode,
	decodeTerminalApprovalPayload,
} from "@shared/terminalPolicy"
import { arePathsEqual } from "@utils/path"
import { telemetryService } from "@/services/telemetry"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { validateCursorSandboxTerminalPreflight } from "../utils/CursorSandboxCommandPolicy"
import { applyModelContentFixes } from "../utils/ModelContentProcessor"
import { ToolResultUtils } from "../utils/ToolResultUtils"

// Default timeout for commands in yolo mode and background exec mode
const DEFAULT_COMMAND_TIMEOUT_SECONDS = 30
const LONG_RUNNING_COMMAND_TIMEOUT_SECONDS = 300

const LONG_RUNNING_COMMAND_PATTERNS: RegExp[] = [
	/\b(npm|pnpm|yarn|bun)\s+(install|ci|build|test)\b/i,
	/\b(npm|pnpm|yarn|bun)\s+run\s+(build|test|lint|typecheck|check)\b/i,
	/\b(pip|pip3|uv)\s+install\b/i,
	/\b(poetry|pipenv)\s+install\b/i,
	/\b(cargo|go|mvn|gradle|gradlew)\s+(build|test|check|install)\b/i,
	/\b(make|cmake|ctest)\b/i,
	/\b(pytest|tox|nox|jest|vitest|mocha)\b/i,
	/\b(docker|podman)\s+build\b/i,
	/\b(torchrun|deepspeed|accelerate\s+launch)\b/i,
	/\bffmpeg\b/i,
	/\bpython(?:\d+(?:\.\d+)?)?\s+.*\b(train|finetune)\b/i,
]

type InlineTerminalRequest = {
	requestedTerminalRunMode?: CodeVibeTerminalRunMode
	prefixRule?: string[]
	requiresManualApproval: boolean
}

type InlineTerminalRequestResult =
	| {
			ok: true
			request: InlineTerminalRequest
	  }
	| {
			ok: false
			error: string
	  }

export function isLikelyLongRunningCommand(command: string): boolean {
	const normalized = command.trim().replace(/\s+/g, " ")
	return LONG_RUNNING_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function resolveCommandTimeoutSeconds(
	command: string,
	timeoutParam: string | undefined,
	useManagedTimeout: boolean,
): number | undefined {
	if (!useManagedTimeout) {
		return undefined
	}

	const parsed = timeoutParam ? Number.parseInt(timeoutParam, 10) : Number.NaN
	if (Number.isFinite(parsed) && parsed > 0) {
		return parsed
	}

	return isLikelyLongRunningCommand(command) ? LONG_RUNNING_COMMAND_TIMEOUT_SECONDS : DEFAULT_COMMAND_TIMEOUT_SECONDS
}

export function getDefaultTerminalRunMode(hasSandboxPolicy: boolean): CodeVibeTerminalRunMode {
	return hasSandboxPolicy ? "sandboxed" : "default"
}

export function resolveInlineTerminalRequest(
	command: string,
	options: {
		sandboxPermissionsRaw?: string
		requireEscalatedRaw?: string
		prefixRuleRaw?: string
	},
): InlineTerminalRequestResult {
	const requireEscalated = parseOptionalBoolean(options.requireEscalatedRaw)
	if (requireEscalated === "invalid") {
		return {
			ok: false,
			error: "Invalid execute_command require_escalated value. Use true or false.",
		}
	}

	const sandboxPermission = parseSandboxPermissions(options.sandboxPermissionsRaw)
	if (sandboxPermission === "invalid") {
		return {
			ok: false,
			error: "Invalid execute_command sandbox_permissions value. Use one of: use_default, sandboxed, unelevated, require_escalated.",
		}
	}

	const prefixRule = parsePrefixRule(options.prefixRuleRaw)
	if (prefixRule === "invalid") {
		return {
			ok: false,
			error: 'Invalid execute_command prefix_rule value. Use a JSON array of strings such as ["npm","run","dev"].',
		}
	}
	if (prefixRule && !commandStartsWithPrefixRule(command, prefixRule)) {
		return {
			ok: false,
			error: `execute_command prefix_rule [${prefixRule.map((part) => JSON.stringify(part)).join(", ")}] does not match the command prefix.`,
		}
	}

	const requestedTerminalRunMode =
		requireEscalated === true
			? "elevated"
			: sandboxPermission === "sandboxed"
				? "sandboxed"
				: sandboxPermission === "unelevated"
					? "default"
					: sandboxPermission === "require_escalated"
						? "elevated"
						: undefined

	return {
		ok: true,
		request: {
			...(requestedTerminalRunMode ? { requestedTerminalRunMode } : {}),
			...(prefixRule ? { prefixRule } : {}),
			requiresManualApproval: requestedTerminalRunMode === "elevated",
		},
	}
}

function parseOptionalBoolean(value: string | undefined): boolean | "invalid" | undefined {
	const normalized = value?.trim().toLowerCase()
	if (!normalized) {
		return undefined
	}
	if (["true", "1", "yes"].includes(normalized)) {
		return true
	}
	if (["false", "0", "no"].includes(normalized)) {
		return false
	}
	return "invalid"
}

function parseSandboxPermissions(
	value: string | undefined,
): "use_default" | "sandboxed" | "unelevated" | "require_escalated" | "invalid" | undefined {
	const normalized = value?.trim().toLowerCase().replace(/-/g, "_")
	if (!normalized) {
		return undefined
	}
	if (["use_default", "default"].includes(normalized)) {
		return "use_default"
	}
	if (["sandbox", "sandboxed"].includes(normalized)) {
		return "sandboxed"
	}
	if (["unelevated", "non_elevated"].includes(normalized)) {
		return "unelevated"
	}
	if (["require_escalated", "elevated"].includes(normalized)) {
		return "require_escalated"
	}
	return "invalid"
}

function parsePrefixRule(value: string | undefined): string[] | "invalid" | undefined {
	const trimmed = value?.trim()
	if (!trimmed) {
		return undefined
	}

	if (trimmed.startsWith("[")) {
		try {
			const parsed = JSON.parse(trimmed)
			if (!Array.isArray(parsed)) {
				return "invalid"
			}
			const parts = parsed.map((part) => (typeof part === "string" ? part.trim() : "")).filter(Boolean)
			return parts.length > 0 ? parts : "invalid"
		} catch {
			return "invalid"
		}
	}

	const parts = trimmed.split(/\s+/).filter(Boolean)
	return parts.length > 0 ? parts : "invalid"
}

function commandStartsWithPrefixRule(command: string, prefixRule: string[]): boolean {
	const normalizedCommand = command.trim().replace(/\s+/g, " ")
	const normalizedPrefix = prefixRule.join(" ").trim().replace(/\s+/g, " ")
	return normalizedCommand === normalizedPrefix || normalizedCommand.startsWith(`${normalizedPrefix} `)
}

export class ExecuteCommandToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.BASH

	constructor(_validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.command}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const command = block.params.command
		if (uiHelpers.getConfig().isSubagentExecution) {
			return
		}

		// Check if this should be auto-approved to determine UI flow
		const shouldAutoApprove = uiHelpers.shouldAutoApproveTool(this.name)

		if (shouldAutoApprove) {
			// For auto-approved commands, we can't partially stream a say prematurely
			// since it may become an ask based on the requires_approval parameter
			// So we wait for the complete block
			return
		}
		await uiHelpers
			.ask("command" as ClineAsk, uiHelpers.removeClosingTag(block, "command", command), block.partial)
			.catch(() => {})
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		let command: string | undefined = block.params.command
		const requiresApprovalRaw: string | undefined = block.params.requires_approval
		const requiresApprovalPerLLM = requiresApprovalRaw?.toLowerCase() === "true"
		const timeoutParam: string | undefined = block.params.timeout
		const sandboxPermissionsRaw: string | undefined = block.params.sandbox_permissions
		const requireEscalatedRaw: string | undefined = block.params.require_escalated
		const prefixRuleRaw: string | undefined = block.params.prefix_rule
		let timeoutSeconds: number | undefined

		// Extract provider using the proven pattern from ReportBugHandler
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

		// Validate required parameters
		if (!command) {
			config.taskState.consecutiveMistakeCount++
			await config.callbacks.say(
				"error",
				"Codie tried to use execute_command without value for required parameter 'command'. Retrying...",
			)
			return formatResponse.toolError(formatResponse.executeCommandMissingCommandError())
		}

		if (!requiresApprovalRaw) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "requires_approval")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Handling of timeout while in yolo mode or background exec mode
		timeoutSeconds = resolveCommandTimeoutSeconds(
			command,
			timeoutParam,
			config.yoloModeToggled || config.vscodeTerminalExecutionMode === "backgroundExec",
		)

		// Pre-process command for certain models
		if (config.api.getModel().id.includes("gemini")) {
			command = applyModelContentFixes(command)
		}

		// Handle multi-workspace command execution
		let executionDir: string = config.cwd
		let actualCommand: string = command

		let workspaceHintUsed = false
		let workspaceHint: string | undefined

		if (config.isMultiRootEnabled && config.workspaceManager) {
			// Check if command has a workspace hint prefix
			// e.g., "@backend:npm install" or just "npm install"
			const commandMatch = command.match(/^@(\w+):(.+)$/)

			if (commandMatch) {
				workspaceHintUsed = true
				workspaceHint = commandMatch[1]
				actualCommand = commandMatch[2].trim()

				// Find the workspace root for this hint
				const adapter = new WorkspacePathAdapter({
					cwd: config.cwd,
					isMultiRootEnabled: true,
					workspaceManager: config.workspaceManager,
				})

				// Resolve to get the workspace directory
				executionDir = adapter.resolvePath(".", workspaceHint)

				// Update command to remove the workspace prefix for display
				command = actualCommand
			}
			// If no hint, use primary workspace (cwd)
		}

		const inlineTerminalRequestResult = resolveInlineTerminalRequest(actualCommand, {
			sandboxPermissionsRaw,
			requireEscalatedRaw,
			prefixRuleRaw,
		})
		if (!inlineTerminalRequestResult.ok) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(inlineTerminalRequestResult.error)
		}
		const inlineTerminalRequest = inlineTerminalRequestResult.request
		if (config.isSubagentExecution && inlineTerminalRequest.requestedTerminalRunMode === "elevated") {
			return formatResponse.toolError(
				"execute_command requested elevated terminal mode, but elevated commands require direct user approval and cannot run from a subagent.",
			)
		}
		if (
			config.isSubagentExecution &&
			config.cursorSandboxPolicy &&
			inlineTerminalRequest.requestedTerminalRunMode === "default"
		) {
			return formatResponse.toolError(
				"execute_command requested unelevated terminal mode, but subagents must run sandboxed while a Codie sandbox policy is active. Omit sandbox_permissions or use sandboxed.",
			)
		}

		// Check workspace ignore validation for command.
		const ignoredFileAttemptedToAccess = config.services.clineIgnoreController.validateCommand(actualCommand)
		if (ignoredFileAttemptedToAccess) {
			if (!config.isSubagentExecution) {
				await config.callbacks.say("workspace_ignore_error", ignoredFileAttemptedToAccess)
			}
			return formatResponse.toolError(formatResponse.clineIgnoreError(ignoredFileAttemptedToAccess))
		}

		let didAutoApprove = false
		let terminalRunMode: CodeVibeTerminalRunMode =
			inlineTerminalRequest.requestedTerminalRunMode ?? getDefaultTerminalRunMode(Boolean(config.cursorSandboxPolicy))

		// If the model says this command is safe and auto approval for safe commands is true, execute the command
		// If the model says the command is risky, but *BOTH* auto approve settings are true, execute the command
		const autoApproveResult = config.autoApprover?.shouldAutoApproveTool(block.name)
		const [autoApproveSafe, autoApproveAll] = Array.isArray(autoApproveResult)
			? autoApproveResult
			: [autoApproveResult, false]

		// Determine workspace context for telemetry
		const resolvedToNonPrimary = !arePathsEqual(executionDir, config.cwd)
		const workspaceContext = {
			isMultiRootEnabled: config.isMultiRootEnabled || false,
			usedWorkspaceHint: workspaceHintUsed,
			resolvedToNonPrimary,
			resolutionMethod: (workspaceHintUsed ? "hint" : "primary_fallback") as "hint" | "primary_fallback",
		}

		// Capture workspace path resolution telemetry
		if (config.isMultiRootEnabled && config.workspaceManager) {
			telemetryService.captureWorkspacePathResolved(
				config.ulid,
				"ExecuteCommandToolHandler",
				workspaceHintUsed ? "hint_provided" : "fallback_to_primary",
				workspaceHintUsed ? "workspace_name" : undefined,
				resolvedToNonPrimary, // resolution success = resolved to different workspace
				undefined, // TODO: could calculate workspace index if needed
				true,
			)
		}

		if (
			!inlineTerminalRequest.requiresManualApproval &&
			(config.isSubagentExecution ||
				(!requiresApprovalPerLLM && autoApproveSafe) ||
				(requiresApprovalPerLLM && autoApproveSafe && autoApproveAll))
		) {
			// Auto-approve flow
			terminalRunMode =
				inlineTerminalRequest.requestedTerminalRunMode ?? getDefaultTerminalRunMode(Boolean(config.cursorSandboxPolicy))
			if (!config.isSubagentExecution) {
				await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "command")
				await config.callbacks.say(
					"command",
					appendTerminalRunModeMarker(
						appendTerminalRequestMarker(actualCommand, inlineTerminalRequest),
						terminalRunMode,
					),
					undefined,
					undefined,
					false,
				)
			}
			didAutoApprove = true
			telemetryService.captureToolUsage(
				config.ulid,
				block.name,
				config.api.getModel().id,
				provider,
				true,
				true,
				workspaceContext,
				block.isNativeToolCall,
			)
		} else {
			// Manual approval flow
			void showApprovalNotification(
				{ message: actualCommand, requiresExplicitApproval: autoApproveSafe && requiresApprovalPerLLM },
				config.autoApprovalSettings.enableNotifications,
			)

			const approval = await askCommandApprovalAndResolveRunMode(
				appendTerminalRequestMarker(
					actualCommand + `${autoApproveSafe && requiresApprovalPerLLM ? COMMAND_REQ_APP_STRING : ""}`,
					inlineTerminalRequest,
				),
				config,
			)
			if (!approval.didApprove) {
				telemetryService.captureToolUsage(
					config.ulid,
					block.name,
					config.api.getModel().id,
					provider,
					false,
					false,
					workspaceContext,
					block.isNativeToolCall,
				)
				return formatResponse.toolDenied()
			}
			terminalRunMode =
				approval.terminalRunMode ??
				inlineTerminalRequest.requestedTerminalRunMode ??
				getDefaultTerminalRunMode(Boolean(config.cursorSandboxPolicy))
			await annotateLatestCommandMessageWithRunMode(config, actualCommand, terminalRunMode, inlineTerminalRequest)
			telemetryService.captureToolUsage(
				config.ulid,
				block.name,
				config.api.getModel().id,
				provider,
				false,
				true,
				workspaceContext,
				block.isNativeToolCall,
			)
		}

		const commandPermissionError = await validateCommandPermissionForRunMode(config, actualCommand, terminalRunMode)
		if (commandPermissionError) {
			return commandPermissionError
		}

		const sandboxPreflightError = await validateCursorSandboxTerminalRun(config, actualCommand, executionDir, terminalRunMode)
		if (sandboxPreflightError) {
			return sandboxPreflightError
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

		// Setup timeout notification for long-running auto-approved commands
		let timeoutId: NodeJS.Timeout | undefined
		if (didAutoApprove && config.autoApprovalSettings.enableNotifications && !config.isSubagentExecution) {
			// if the command was auto-approved, and it's long running we need to notify the user after some time has passed without proceeding
			timeoutId = setTimeout(() => {
				showSystemNotification({
					subtitle: "Command is still running",
					message: "An auto-approved command has been running for 30s, and may need your attention.",
				})
			}, 30_000)
		}

		// Execute the command in the correct directory
		// If executionDir is different from cwd, prepend cd command
		let finalCommand: string = actualCommand
		if (executionDir !== config.cwd) {
			// Use && to chain commands so they run in sequence
			finalCommand = `cd "${executionDir}" && ${actualCommand}`
		}

		const [userRejected, result] = await config.callbacks.executeCommandTool(finalCommand, timeoutSeconds, {
			terminalRunMode,
			useBackgroundExecution: terminalRunMode === "sandboxed",
			cursorSandboxPolicy: config.cursorSandboxPolicy,
		})

		if (timeoutId) {
			clearTimeout(timeoutId)
		}

		// Invalidate the entire file read cache after any command execution.
		// Bash commands can modify files in ways we can't predict (sed, npm install, git checkout, mv, etc.),
		// so we must clear the cache to prevent stale reads.
		// Invalidate the entire file read cache after any command execution.
		// Bash commands can modify files in ways we can't predict (sed, npm install, git checkout, mv, etc.),
		// so we must clear the cache to prevent stale reads.
		if (!userRejected) {
			config.taskState.fileReadCache.clear()
		}

		if (userRejected) {
			config.taskState.didRejectTool = true
		}

		return result
	}
}

async function annotateLatestCommandMessageWithRunMode(
	config: TaskConfig,
	actualCommand: string,
	terminalRunMode: CodeVibeTerminalRunMode,
	inlineTerminalRequest: InlineTerminalRequest,
): Promise<void> {
	const clineMessages = config.messageState.getClineMessages()
	for (let index = clineMessages.length - 1; index >= 0; index--) {
		const message = clineMessages[index]
		if (message.ask !== "command" && message.say !== "command") {
			continue
		}
		await config.messageState.updateClineMessage(index, {
			text: appendTerminalRunModeMarker(appendTerminalRequestMarker(actualCommand, inlineTerminalRequest), terminalRunMode),
		})
		return
	}
}

async function askCommandApprovalAndResolveRunMode(
	completeMessage: string,
	config: TaskConfig,
): Promise<{ didApprove: boolean; terminalRunMode?: CodeVibeTerminalRunMode }> {
	if (config.isSubagentExecution) {
		return { didApprove: true, terminalRunMode: getDefaultTerminalRunMode(Boolean(config.cursorSandboxPolicy)) }
	}

	const { response, text, images, files } = await config.callbacks.ask("command", completeMessage, false)
	const terminalRunMode = decodeTerminalApprovalPayload(text)
	const hasRunModeApprovalPayload = Boolean(terminalRunMode)

	if (!hasRunModeApprovalPayload && (text || (images && images.length > 0) || (files && files.length > 0))) {
		let fileContentString = ""
		if (files && files.length > 0) {
			fileContentString = await processFilesIntoText(files)
		}

		ToolResultUtils.pushAdditionalToolFeedback(config.taskState.userMessageContent, text, images, fileContentString)
		await config.callbacks.say("user_feedback", text, images, files)
	}

	if (response !== "yesButtonClicked") {
		config.taskState.didRejectTool = true
		return { didApprove: false }
	}

	return { didApprove: true, terminalRunMode }
}

async function validateCommandPermissionForRunMode(
	config: TaskConfig,
	actualCommand: string,
	terminalRunMode: CodeVibeTerminalRunMode,
): Promise<ToolResponse | undefined> {
	const commandPermissionController =
		terminalRunMode === "elevated" ? new CommandPermissionController() : config.services.commandPermissionController
	const permissionResult = commandPermissionController.validateCommand(actualCommand)
	if (permissionResult.allowed) {
		return undefined
	}

	let errorMessage: string
	if (permissionResult.failedSegment) {
		errorMessage =
			`Command "${actualCommand}" was denied by configured command permissions. ` +
			`Segment "${permissionResult.failedSegment}" ${permissionResult.reason}.`
	} else {
		const matchedPattern = permissionResult.matchedPattern ? ` (matched pattern: ${permissionResult.matchedPattern})` : ""
		errorMessage =
			`Command "${actualCommand}" was denied by configured command permissions. ` +
			`Reason: ${permissionResult.reason}${matchedPattern}`
	}
	if (!config.isSubagentExecution) {
		await config.callbacks.say("command_permission_denied", errorMessage)
	}
	return formatResponse.toolError(formatResponse.permissionDeniedError(errorMessage))
}

async function validateCursorSandboxTerminalRun(
	config: TaskConfig,
	actualCommand: string,
	executionDir: string,
	terminalRunMode: CodeVibeTerminalRunMode,
): Promise<ToolResponse | undefined> {
	const sandboxResult = validateCursorSandboxTerminalPreflight({
		command: actualCommand,
		executionDir,
		policy: config.cursorSandboxPolicy,
		terminalRunMode,
	})
	if (sandboxResult.ok) {
		return undefined
	}

	if (!config.isSubagentExecution) {
		await config.callbacks.say("command_permission_denied", sandboxResult.error)
	}
	return formatResponse.toolError(formatResponse.permissionDeniedError(sandboxResult.error))
}
