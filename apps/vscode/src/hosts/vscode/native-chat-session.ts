import type { HistoryItem } from "@shared/HistoryItem"
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

const DEFAULT_NATIVE_SESSION_HISTORY_LIMIT = 50
const MAX_NATIVE_SESSION_LABEL_LENGTH = 80

export function buildCodeVibeChatSessionLabel(request: CodeVibeNativeChatRequestLike | undefined): string {
	const prompt = typeof request?.prompt === "string" ? normalizeLabel(request.prompt) : ""
	if (!prompt) {
		return "New CodeVibe Session"
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
	const label = truncateNativeSessionLabel(normalizeLabel(item.task) || `CodeVibe Task ${item.id}`)
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
	const lines = [`CodeVibe task: ${label}`, `Task ID: ${item.id}`]
	if (workspacePath) {
		lines.push(`Workspace: ${workspacePath}`)
	}
	if (item.modelId) {
		lines.push(`Model: ${item.modelId}`)
	}
	return lines.join("\n")
}
