import { expect } from "chai"
import {
	CODEVIBE_CHAT_PARTICIPANT_ID,
	CODEVIBE_CHAT_PARTICIPANT_IDS,
	CODEVIBE_CHAT_SESSION_TYPE,
	CODEVIBE_NATIVE_AGENT_CACHE_DIR,
	CODEVIBE_NATIVE_AGENT_FILE_NAME,
	CODEVIBE_NATIVE_CHAT_AGENT_PARTICIPANT_ID,
	CODEVIBE_NATIVE_CHAT_SESSION_TYPES,
	CODEVIBE_OPEN_NATIVE_CHAT_EDITOR_COMMAND,
	CODEVIBE_OPEN_NATIVE_CHAT_SIDEBAR_COMMAND,
	canRegisterCodeVibeNativeChatSessions,
	getCodeVibeNativeCustomAgentSessionTypes,
	registerCodeVibeNativeChatSessionTypes,
} from "../native-chat-registration"

describe("native Codie chat registration", () => {
	it("defines the Codie participant and ordered session types used by VS Code Chat", () => {
		expect(CODEVIBE_CHAT_PARTICIPANT_ID).to.equal("codevibe")
		expect(CODEVIBE_NATIVE_CHAT_AGENT_PARTICIPANT_ID).to.equal("codevibe-agent")
		expect(CODEVIBE_CHAT_PARTICIPANT_IDS).to.deep.equal(["codevibe", "codevibe-agent"])
		expect(CODEVIBE_CHAT_SESSION_TYPE).to.equal("codevibe-agent")
		expect(CODEVIBE_CHAT_SESSION_TYPE.startsWith("agent-host-")).to.equal(false)
		expect(CODEVIBE_NATIVE_CHAT_SESSION_TYPES).to.deep.equal(["codevibe-agent"])
		expect(CODEVIBE_OPEN_NATIVE_CHAT_SIDEBAR_COMMAND).to.equal("workbench.action.chat.openNewSessionSidebar.codevibe-agent")
		expect(CODEVIBE_OPEN_NATIVE_CHAT_EDITOR_COMMAND).to.equal("workbench.action.chat.openNewSessionEditor.codevibe-agent")
		expect(CODEVIBE_NATIVE_AGENT_CACHE_DIR).to.equal("native-agents")
		expect(CODEVIBE_NATIVE_AGENT_FILE_NAME).to.equal("00-codevibe-agent.agent.md")
	})

	it("exposes Codie and local session types for custom agent discovery", () => {
		expect(getCodeVibeNativeCustomAgentSessionTypes()).to.deep.equal(["codevibe-agent", "local"])
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

	it("registers only the public native Codie session type", () => {
		const registered: string[] = []
		const returned = registerCodeVibeNativeChatSessionTypes((chatSessionType) => {
			registered.push(chatSessionType)
		})

		expect(registered).to.deep.equal(["codevibe-agent"])
		expect(returned).to.deep.equal(registered)
	})
})
