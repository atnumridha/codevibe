import { name, publisher, version } from "../package.json"
import { HostProvider } from "./hosts/host-provider"

const prefix = name === "claude-dev" ? "cline" : name
const viewPrefix = name === "codevibe" ? "codevibe" : name.replace(/[^A-Za-z0-9_-]/g, "-")

/**
 * List of commands with the name of the extension they are registered under.
 * These should match the command IDs defined in package.json.
 * For Nightly build, the publish script has updated all the commands to use the extension name as prefix.
 * In production, commands keep the extension name prefix, with selected legacy aliases.
 */
const CodeVibeCommands = {
	PlusButton: prefix + ".plusButtonClicked",
	McpButton: prefix + ".mcpButtonClicked",
	SettingsButton: prefix + ".settingsButtonClicked",
	HistoryButton: prefix + ".historyButtonClicked",
	AccountButton: prefix + ".accountButtonClicked",
	WorktreesButton: prefix + ".worktreesButtonClicked",
	NativeAgentDiagnostics: prefix + ".nativeAgentDiagnostics",
	NewNativeAgentSession: prefix + ".newNativeAgentSession",
	TerminalOutput: prefix + ".addTerminalOutputToChat",
	AddToChat: prefix + ".addToChat",
	FixWithCodeVibe: prefix + ".fixWithCodeVibe",
	// Keep the legacy command ID so older keybindings and generated protobus calls keep working.
	LegacyFixWithCline: prefix + ".fixWithCline",
	ExplainCode: prefix + ".explainCode",
	ImproveCode: prefix + ".improveCode",
	FocusChatInput: prefix + ".focusChatInput",
	OpenLegacyWebview: prefix + ".openLegacyWebview",
	Walkthrough: prefix + ".openWalkthrough",
	GenerateCommit: prefix + ".generateGitCommitMessage",
	AbortCommit: prefix + ".abortGitCommitMessage",
	CompatibilityNdjsonStart: prefix + ".compatibility.ndjson.start",
	CompatibilityNdjsonStop: prefix + ".compatibility.ndjson.stop",
	CompatibilityNdjsonCopyCurl: prefix + ".compatibility.ndjson.copyCurl",
	CompatibilityNdjsonReassignPort: prefix + ".compatibility.ndjson.reassignPort",
	CompatibilityNdjsonShowStatus: prefix + ".compatibility.ndjson.showStatus",
	CompatibilityDeeplinkDebugTrigger: prefix + ".compatibility.deeplink.debug.trigger",
	ReconstructTaskHistory: prefix + ".reconstructTaskHistory",
	// Jupyter Notebook commands
	JupyterGenerateCell: prefix + ".jupyterGenerateCell",
	JupyterExplainCell: prefix + ".jupyterExplainCell",
	JupyterImproveCell: prefix + ".jupyterImproveCell",
}

/**
 * IDs for the views registered by the extension.
 * These should match the name + view IDs defined in package.json.
 */
const CodeVibeViewIds = {
	AgentContainer: viewPrefix + "-agent",
	Sidebar: viewPrefix + "-agent-chat",
	LegacySidebar: name + ".SidebarProvider",
}

/**
 * The registry info for the extension, including its ID, name, version, commands, and views
 * registered for the current host.
 */
export const ExtensionRegistryInfo = {
	id: publisher + "." + name,
	name,
	version,
	publisher,
	commands: CodeVibeCommands,
	views: CodeVibeViewIds,
}

export interface HostInfo {
	/**
	 * The name of the host platform, e.g VSCode, IntelliJ Ultimate Edition, etc.
	 */
	platform: string
	/**
	 * The operating system platform, e.g. linux, darwin, win32
	 */
	os: string
	/**
	 * The type of the host environment, e.g. 'VSCode Extension', 'JetBrains', 'CLI'
	 * This is different from the platform because there are many JetBrains IDEs, but they all use the same
	 * plugin.
	 */
	ide: string
	/**
	 * A distinct ID for this installation of the host client
	 */
	distinctId: string
	/**
	 * The version of the host platform, e.g. 1.103.0 for VSCode, or 2025.1.1.1 for JetBrains IDEs.
	 */
	hostVersion?: string
	/**
	 * The version of CodeVibe that the host client is running
	 */
	extensionVersion: string
}

let hostInfo = null as HostInfo | null

export const HostRegistryInfo = {
	init: async (distinctId: string) => {
		const host = await HostProvider.env.getHostVersion({})
		const hostVersion = host.version
		const extensionVersion = host.clineVersion || ExtensionRegistryInfo.version
		const platform = host.platform || "unknown"
		const os = process.platform || "unknown"
		const ide = host.clineType || "unknown"
		hostInfo = { hostVersion, extensionVersion, platform, os, ide, distinctId }
	},
	get: () => hostInfo,
}
