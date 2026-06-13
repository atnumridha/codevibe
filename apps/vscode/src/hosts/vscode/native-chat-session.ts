import type { HistoryItem } from "@shared/HistoryItem"
import type { ClineMessage } from "@shared/ExtensionMessage"
import type { CodeVibeNativeChatRequestLike } from "./native-chat-adapter"

export type CodeVibeNativeSessionDescriptor = {
	taskId: string
	resourcePath: string
	label: string
	tooltip: string
	timing: {
		created: number
		lastRequestStarted: number
		lastRequestEnded: number
	}
	metadata: Record<string, unknown>
}

export type CodeVibeNativeSessionDescriptorOptions = {
	limit?: number
	workspacePath?: string
}

export type CodeVibeNativeChatSessionHistoryOptions = {
	participantId: string
	maxTurns?: number
	maxMarkdownLength?: number
}

export type CodeVibeNativeChatSessionHistoryTurn =
	| {
			prompt: string
			participant: string
			command?: string
			references: unknown[]
			toolReferences: unknown[]
			result?: {
				metadata: Record<string, unknown>
			}
	  }
	| {
			response: Array<{ value: string }>
			result: {
				metadata: Record<string, unknown>
			}
			participant: string
			command?: string
	  }

const DEFAULT_NATIVE_SESSION_HISTORY_LIMIT = 50
const MAX_NATIVE_SESSION_LABEL_LENGTH = 80
const DEFAULT_NATIVE_SESSION_TRANSCRIPT_LIMIT = 80
const DEFAULT_NATIVE_SESSION_MARKDOWN_LIMIT = 4_000
const SKIPPED_TRANSCRIPT_MESSAGE_TYPES = new Set([
	"api_req_started",
	"api_req_finished",
	"api_req_retried",
	"deleted_api_reqs",
	"checkpoint_created",
])

export function buildCodeVibeChatSessionLabel(request: CodeVibeNativeChatRequestLike | undefined): string {
	const prompt = typeof request?.prompt === "string" ? normalizeLabel(request.prompt) : ""
	if (!prompt) {
		return "New Codie Session"
	}
	return truncateNativeSessionLabel(prompt)
}

export function buildCodeVibeNativeSessionDescriptors(
	history: readonly HistoryItem[],
	options: CodeVibeNativeSessionDescriptorOptions = {},
): CodeVibeNativeSessionDescriptor[] {
	const limit = Math.max(0, options.limit ?? DEFAULT_NATIVE_SESSION_HISTORY_LIMIT)
	return history
		.filter(isUsableHistoryItem)
		.slice()
		.sort((a, b) => b.ts - a.ts)
		.slice(0, limit)
		.map((item) => buildCodeVibeNativeSessionDescriptor(item, options))
}

export function buildCodeVibeNativeSessionDescriptor(
	item: HistoryItem,
	options: CodeVibeNativeSessionDescriptorOptions = {},
): CodeVibeNativeSessionDescriptor {
	const label = truncateNativeSessionLabel(normalizeLabel(item.task) || `Codie Task ${item.id}`)
	const workspacePath = item.cwdOnTaskInitialization || options.workspacePath
	const metadata: Record<string, unknown> = {
		source: "codevibe.taskHistory",
		taskId: item.id,
		totalCost: item.totalCost,
		tokensIn: item.tokensIn,
		tokensOut: item.tokensOut,
	}
	if (workspacePath) {
		metadata.workingDirectoryPath = workspacePath
	}
	if (item.modelId) {
		metadata.modelId = item.modelId
	}
	if (item.isFavorited !== undefined) {
		metadata.isFavorited = item.isFavorited
	}

	return {
		taskId: item.id,
		resourcePath: `/${encodeURIComponent(item.id)}`,
		label,
		tooltip: buildCodeVibeNativeSessionTooltip(item, label, workspacePath),
		timing: {
			created: item.ts,
			lastRequestStarted: item.ts,
			lastRequestEnded: item.ts,
		},
		metadata,
	}
}

export function getCodeVibeNativeSessionTaskIdFromPath(path: string): string | undefined {
	const encodedTaskId = path.replace(/^\/+/, "")
	if (!encodedTaskId) {
		return undefined
	}
	try {
		return decodeURIComponent(encodedTaskId)
	} catch {
		return encodedTaskId
	}
}

export function buildCodeVibeNativeChatSessionHistory(
	messages: readonly ClineMessage[],
	options: CodeVibeNativeChatSessionHistoryOptions,
): CodeVibeNativeChatSessionHistoryTurn[] {
	const maxTurns = Math.max(0, options.maxTurns ?? DEFAULT_NATIVE_SESSION_TRANSCRIPT_LIMIT)
	return messages
		.filter((message) => !message.partial)
		.map((message) => buildCodeVibeNativeChatSessionHistoryTurn(message, options))
		.filter((turn): turn is CodeVibeNativeChatSessionHistoryTurn => Boolean(turn))
		.slice(-maxTurns)
}

function buildCodeVibeNativeChatSessionHistoryTurn(
	message: ClineMessage,
	options: CodeVibeNativeChatSessionHistoryOptions,
): CodeVibeNativeChatSessionHistoryTurn | undefined {
	const text = normalizeTranscriptText(message.text)
	if (!text) {
		return undefined
	}

	if (message.type === "say" && message.say === "task") {
		return createNativeRequestTurn(text, options.participantId, message)
	}

	if (message.type === "say" && (message.say === "user_feedback" || message.say === "user_feedback_diff")) {
		return createNativeRequestTurn(`User feedback:\n\n${text}`, options.participantId, message)
	}

	if (message.type === "say" && message.say && SKIPPED_TRANSCRIPT_MESSAGE_TYPES.has(message.say)) {
		return undefined
	}

	const markdown = createNativeResponseMarkdown(message, text, options.maxMarkdownLength)
	if (!markdown) {
		return undefined
	}
	return {
		response: [{ value: markdown }],
		result: {
			metadata: {
				source: "codevibe.uiMessages",
				messageType: message.type,
				ask: message.ask,
				say: message.say,
				ts: message.ts,
			},
		},
		participant: options.participantId,
	}
}

function isUsableHistoryItem(item: HistoryItem): boolean {
	return Boolean(item.id.trim() && Number.isFinite(item.ts) && item.task.trim())
}

function normalizeLabel(value: string): string {
	return value.trim().replace(/\s+/g, " ")
}

function truncateNativeSessionLabel(label: string): string {
	return label.length > MAX_NATIVE_SESSION_LABEL_LENGTH ? `${label.slice(0, MAX_NATIVE_SESSION_LABEL_LENGTH - 3)}...` : label
}

function buildCodeVibeNativeSessionTooltip(item: HistoryItem, label: string, workspacePath: string | undefined): string {
	const lines = [`Codie task: ${label}`, `Task ID: ${item.id}`]
	if (workspacePath) {
		lines.push(`Workspace: ${workspacePath}`)
	}
	if (item.modelId) {
		lines.push(`Model: ${item.modelId}`)
	}
	return lines.join("\n")
}

function createNativeRequestTurn(
	prompt: string,
	participantId: string,
	message: ClineMessage,
): CodeVibeNativeChatSessionHistoryTurn {
	return {
		prompt,
		participant: participantId,
		references: [],
		toolReferences: [],
		result: {
			metadata: {
				source: "codevibe.uiMessages",
				messageType: message.type,
				say: message.say,
				ts: message.ts,
			},
		},
	}
}

function createNativeResponseMarkdown(
	message: ClineMessage,
	text: string,
	maxMarkdownLength: number | undefined,
): string | undefined {
	const body = summarizeStructuredTranscriptText(message, text)
	const markdown = labelNativeResponseMarkdown(message, body)
	return truncateTranscriptMarkdown(markdown, maxMarkdownLength ?? DEFAULT_NATIVE_SESSION_MARKDOWN_LIMIT)
}

function labelNativeResponseMarkdown(message: ClineMessage, body: string): string {
	if (message.type === "ask") {
		const label = message.ask ? formatTranscriptLabel(message.ask) : "Request"
		return `**${label}**\n\n${body}`
	}

	switch (message.say) {
		case "reasoning":
			return `**Reasoning**\n\n${body}`
		case "tool":
			return `**Tool**\n\n${body}`
		case "command":
			return `**Command**\n\n${body}`
		case "command_output":
			return `**Command output**\n\n${body}`
		case "browser_action":
		case "browser_action_launch":
		case "browser_action_result":
			return `**Browser**\n\n${body}`
		case "mcp_server_request_started":
		case "mcp_server_response":
		case "mcp_notification":
			return `**MCP**\n\n${body}`
		case "task_progress":
			return `**Progress**\n\n${body}`
		case "completion_result":
			return body
		default:
			return body
	}
}

function summarizeStructuredTranscriptText(message: ClineMessage, text: string): string {
	if (message.say !== "tool") {
		return text
	}

	const parsed = parseJsonObject(text)
	if (!parsed) {
		return text
	}

	const lines: string[] = []
	if (typeof parsed.tool === "string") {
		lines.push(`Tool: \`${parsed.tool}\``)
	}
	if (typeof parsed.path === "string") {
		lines.push(`Path: \`${parsed.path}\``)
	}
	if (typeof parsed.command === "string") {
		lines.push(`Command: \`${parsed.command}\``)
	}
	if (typeof parsed.content === "string") {
		lines.push("", parsed.content)
	}
	return lines.length ? lines.join("\n") : text
}

function normalizeTranscriptText(value: string | undefined): string {
	return typeof value === "string" ? value.trim() : ""
}

function truncateTranscriptMarkdown(markdown: string, maxLength: number): string {
	if (markdown.length <= maxLength) {
		return markdown
	}
	return `${markdown.slice(0, Math.max(0, maxLength - 32)).trimEnd()}\n\n... transcript truncated ...`
}

function formatTranscriptLabel(value: string): string {
	return value
		.split("_")
		.filter(Boolean)
		.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
		.join(" ")
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(value)
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined
	} catch {
		return undefined
	}
}
