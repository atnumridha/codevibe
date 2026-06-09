import type { ChatSessionConfig } from "@/lib/chat-schema"
import { readModelSelectionStorageFromWindow } from "@/lib/model-selection"
import { CODEVIBE_AGENT_DEFAULT_MODEL_ID, CODEVIBE_AGENT_PROVIDER_ID } from "@/lib/provider-display"

export const CHAT_TRANSPORT_UNAVAILABLE_MESSAGE =
	"Chat connection is unavailable. Reopen the app window to restore realtime chat."
export const CHAT_WS_ENDPOINT_RETRY_ATTEMPTS = 60
export const CHAT_WS_ENDPOINT_RETRY_DELAY_MS = 100
export const CHAT_WS_RECONNECT_BASE_DELAY_MS = 300
export const CHAT_WS_RECONNECT_MAX_DELAY_MS = 3000
export const CHAT_WS_REQUEST_TIMEOUT_MS = 120000
export const OAUTH_MANAGED_PROVIDERS = new Set(["cline", "oca", "openai-codex"])

export const DEFAULT_CODEVIBE_PROVIDER_ID = CODEVIBE_AGENT_PROVIDER_ID
export const DEFAULT_CODEVIBE_MODEL_ID = CODEVIBE_AGENT_DEFAULT_MODEL_ID

export const DEFAULT_CHAT_CONFIG: ChatSessionConfig = {
	sessionId: undefined,
	workspaceRoot: "",
	cwd: "",
	provider: DEFAULT_CODEVIBE_PROVIDER_ID,
	model: DEFAULT_CODEVIBE_MODEL_ID,
	apiKey: process.env.CLINE_API_KEY || "",
	mode: "act",
	systemPrompt: undefined,
	maxIterations: undefined,
	enableTools: true,
	enableSpawn: undefined,
	enableTeams: undefined,
	autoApproveTools: true,
	missionStepInterval: undefined,
	missionTimeIntervalMs: undefined,
}

export function getInitialChatConfig(): ChatSessionConfig {
	const selection = readModelSelectionStorageFromWindow()
	const rememberedModelForDefaultProvider = selection.lastModelByProvider[DEFAULT_CHAT_CONFIG.provider]
	const provider = DEFAULT_CHAT_CONFIG.provider
	const model = rememberedModelForDefaultProvider || DEFAULT_CHAT_CONFIG.model

	return {
		...DEFAULT_CHAT_CONFIG,
		provider,
		model,
	}
}
