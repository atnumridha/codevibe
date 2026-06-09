export const CODEVIBE_CHAT_PARTICIPANT_ID = "codevibe"
export const CODEVIBE_CHAT_SESSION_TYPE = "agent-host-codevibe"
export const CODEVIBE_LEGACY_CHAT_SESSION_TYPE = "codevibe-agent"
export const CODEVIBE_NATIVE_CHAT_SESSION_TYPES = [
	CODEVIBE_CHAT_SESSION_TYPE,
	CODEVIBE_LEGACY_CHAT_SESSION_TYPE,
] as const
export const CODEVIBE_OPEN_NATIVE_CHAT_SIDEBAR_COMMAND = `workbench.action.chat.openNewSessionSidebar.${CODEVIBE_CHAT_SESSION_TYPE}`
export const CODEVIBE_OPEN_NATIVE_CHAT_EDITOR_COMMAND = `workbench.action.chat.openNewSessionEditor.${CODEVIBE_CHAT_SESSION_TYPE}`
export const CODEVIBE_NATIVE_AGENT_CACHE_DIR = "native-agents"
export const CODEVIBE_NATIVE_AGENT_FILE_NAME = "00-codevibe-agent.agent.md"

export type CodeVibeNativeChatSessionType = (typeof CODEVIBE_NATIVE_CHAT_SESSION_TYPES)[number]

export function getCodeVibeNativeCustomAgentSessionTypes(): string[] {
	return [...CODEVIBE_NATIVE_CHAT_SESSION_TYPES, "local"]
}

export function canRegisterCodeVibeNativeChatSessions(options: {
	hasChatSessionContentProvider: boolean
	hasDefaultChatParticipant: boolean
}): boolean {
	return options.hasChatSessionContentProvider && options.hasDefaultChatParticipant
}

export function registerCodeVibeNativeChatSessionTypes(
	registerSessionType: (chatSessionType: CodeVibeNativeChatSessionType) => void,
): CodeVibeNativeChatSessionType[] {
	const registeredSessionTypes: CodeVibeNativeChatSessionType[] = []
	for (const chatSessionType of CODEVIBE_NATIVE_CHAT_SESSION_TYPES) {
		registerSessionType(chatSessionType)
		registeredSessionTypes.push(chatSessionType)
	}
	return registeredSessionTypes
}
