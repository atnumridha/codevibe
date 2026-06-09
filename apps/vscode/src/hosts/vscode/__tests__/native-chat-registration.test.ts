import { expect } from "chai"
import {
	canRegisterCodeVibeNativeChatSessions,
	CODEVIBE_CHAT_PARTICIPANT_ID,
	CODEVIBE_CHAT_SESSION_TYPE,
	CODEVIBE_LEGACY_CHAT_SESSION_TYPE,
	CODEVIBE_NATIVE_AGENT_CACHE_DIR,
	CODEVIBE_NATIVE_AGENT_FILE_NAME,
	CODEVIBE_NATIVE_CHAT_SESSION_TYPES,
	CODEVIBE_OPEN_NATIVE_CHAT_EDITOR_COMMAND,
	CODEVIBE_OPEN_NATIVE_CHAT_SIDEBAR_COMMAND,
	getCodeVibeNativeCustomAgentSessionTypes,
	registerCodeVibeNativeChatSessionTypes,
} from "../native-chat-registration"

describe("native CodeVibe chat registration", () => {
	it("defines the CodeVibe participant and ordered session types used by VS Code Chat", () => {
		expect(CODEVIBE_CHAT_PARTICIPANT_ID).to.equal("codevibe")
		expect(CODEVIBE_CHAT_SESSION_TYPE).to.equal("agent-host-codevibe")
		expect(CODEVIBE_LEGACY_CHAT_SESSION_TYPE).to.equal("codevibe-agent")
		expect(CODEVIBE_NATIVE_CHAT_SESSION_TYPES).to.deep.equal(["agent-host-codevibe", "codevibe-agent"])
		expect(CODEVIBE_OPEN_NATIVE_CHAT_SIDEBAR_COMMAND).to.equal(
			"workbench.action.chat.openNewSessionSidebar.agent-host-codevibe",
		)
		expect(CODEVIBE_OPEN_NATIVE_CHAT_EDITOR_COMMAND).to.equal(
			"workbench.action.chat.openNewSessionEditor.agent-host-codevibe",
		)
		expect(CODEVIBE_NATIVE_AGENT_CACHE_DIR).to.equal("native-agents")
		expect(CODEVIBE_NATIVE_AGENT_FILE_NAME).to.equal("00-codevibe-agent.agent.md")
	})

	it("exposes both CodeVibe session types plus local for custom agent discovery", () => {
		expect(getCodeVibeNativeCustomAgentSessionTypes()).to.deep.equal([
			"agent-host-codevibe",
			"codevibe-agent",
			"local",
		])
	})

	it("gates registration on both the native session API and a default participant", () => {
		expect(
			canRegisterCodeVibeNativeChatSessions({
				hasChatSessionContentProvider: true,
				hasDefaultChatParticipant: true,
			}),
		).to.equal(true)
		expect(
			canRegisterCodeVibeNativeChatSessions({
				hasChatSessionContentProvider: false,
				hasDefaultChatParticipant: true,
			}),
		).to.equal(false)
		expect(
			canRegisterCodeVibeNativeChatSessions({
				hasChatSessionContentProvider: true,
				hasDefaultChatParticipant: false,
			}),
		).to.equal(false)
	})

	it("registers primary CodeVibe before the compatibility alias", () => {
		const registered: string[] = []
		const returned = registerCodeVibeNativeChatSessionTypes((chatSessionType) => {
			registered.push(chatSessionType)
		})

		expect(registered).to.deep.equal(["agent-host-codevibe", "codevibe-agent"])
		expect(returned).to.deep.equal(registered)
	})
})
