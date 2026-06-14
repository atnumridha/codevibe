import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { expect } from "@playwright/test"
import { E2ETestHelper, e2e } from "./utils/helpers"

const installedE2e = e2e.extend({
	extensionInstallMode: "installed" as const,
})

interface InstalledExtensionManifest {
	name?: string
	publisher?: string
	version?: string
	activationEvents?: string[]
	enabledApiProposals?: string[]
	contributes?: {
		commands?: Array<{ command?: string; title?: string }>
		chatAgents?: Array<{ id?: string; name?: string; path?: string }>
		chatParticipants?: Array<{ id?: string; name?: string }>
		chatSessions?: Array<{ id?: string; type?: string; displayName?: string }>
		menus?: Record<string, Array<{ command?: string; group?: string; when?: string }>>
	}
}

const NATIVE_CHAT_API_PROPOSALS = [
	"chatParticipantAdditions",
	"chatSessionCustomizationProvider",
	"chatSessionsProvider",
]
const CODEVIBE_NATIVE_CHAT_SESSION_TYPE = "codevibe-agent"
const CODEVIBE_OPEN_NATIVE_CHAT_SIDEBAR_COMMAND =
	`workbench.action.chat.openNewSessionSidebar.${CODEVIBE_NATIVE_CHAT_SESSION_TYPE}`

function readJsonFile(filePath: string): InstalledExtensionManifest {
	return JSON.parse(readFileSync(filePath, "utf8")) as InstalledExtensionManifest
}

function findInstalledCodeVibeExtension(extensionsDir: string) {
	const extensionFolder = readdirSync(extensionsDir).find((entry) => entry.startsWith("atnumridha.codevibe-"))
	if (!extensionFolder) {
		return undefined
	}

	const extensionPath = path.join(extensionsDir, extensionFolder)
	return {
		extensionPath,
		manifest: readJsonFile(path.join(extensionPath, "package.json")),
	}
}

installedE2e("Installed VSIX native chat exposes Codie agent runtime", async ({ app: _app, extensionsDir }) => {
	const sourceManifest = readJsonFile(path.join(E2ETestHelper.CODEBASE_ROOT_DIR, "package.json"))

	await expect
		.poll(() => findInstalledCodeVibeExtension(extensionsDir)?.manifest.version, {
			message: "Codie VSIX should install into the isolated extensions dir",
			timeout: 60_000,
		})
		.toBe(sourceManifest.version)

	const installed = findInstalledCodeVibeExtension(extensionsDir)
	expect(installed).toBeDefined()
	const installedRelativePath = path.relative(extensionsDir, installed?.extensionPath ?? "")
	expect(installedRelativePath.startsWith("..")).toBe(false)
	expect(path.isAbsolute(installedRelativePath)).toBe(false)

	const manifest = installed?.manifest
	expect(manifest?.name).toBe("codevibe")
	expect(manifest?.publisher).toBe("atnumridha")
	expect(manifest?.contributes?.chatParticipants?.map((participant) => participant.id)).toEqual(["codevibe", "codevibe-agent"])
	expect(manifest?.contributes?.chatSessions?.map((session) => session.type)).toEqual(["codevibe-agent"])
	expect(manifest?.contributes?.chatSessions?.[0]).toMatchObject({
		id: CODEVIBE_NATIVE_CHAT_SESSION_TYPE,
		type: CODEVIBE_NATIVE_CHAT_SESSION_TYPE,
		displayName: "Codie Agent",
	})
	expect(manifest?.contributes?.chatAgents?.[0]).toMatchObject({
		id: CODEVIBE_NATIVE_CHAT_SESSION_TYPE,
		name: "codie",
		path: "agents/00-codevibe-agent.agent.md",
	})
	expect(manifest?.contributes?.menus?.["chatSessions/newSession"]?.[0]?.command).toBe("codevibe.newNativeAgentSession")
	expect(manifest?.contributes?.menus?.["chatSessions/newSession"]?.[0]?.group).toBe("navigation@-1000")
	expect(manifest?.contributes?.menus?.["chatSessions/newSession"]?.[0]?.when).toBeUndefined()
	expect(manifest?.contributes?.commands?.some((command) => command.command === "codevibe.newNativeAgentSession")).toBe(true)
	expect(manifest?.contributes?.commands?.some((command) => command.command === "codevibe.nativeAgentDiagnostics")).toBe(true)
	expect(manifest?.activationEvents).toEqual(
		expect.arrayContaining(["onChatParticipant:codevibe-agent", "onChatSession:codevibe-agent"]),
	)
	expect(manifest?.enabledApiProposals).toEqual(expect.arrayContaining(NATIVE_CHAT_API_PROPOSALS))
	expect(manifest?.enabledApiProposals).toEqual(expect.arrayContaining(sourceManifest.enabledApiProposals ?? []))

	const serializedContributions = JSON.stringify(manifest?.contributes ?? {})
	expect(serializedContributions).not.toContain("agent-host-codevibe")
	expect(serializedContributions).not.toContain("codevibe.agentPanel")
	expect(serializedContributions).not.toContain("codevibe.SidebarProvider")
	expect(serializedContributions).not.toContain("claude-dev.SidebarProvider")

	await expect
		.poll(
			async () => {
				const diagnosticsResponse = await E2ETestHelper.getNativeAgentDiagnostics().catch((error) => ({
					success: false,
					error: error instanceof Error ? error.message : String(error),
				}))
				return {
					success: diagnosticsResponse?.success === true,
					ready: diagnosticsResponse?.ready === true,
					diagnostics: diagnosticsResponse?.diagnostics,
					error: diagnosticsResponse?.error,
				}
			},
			{
				message: "Installed Codie VSIX should register native Chat runtime providers",
				timeout: 60_000,
			},
		)
		.toMatchObject({ success: true, ready: true })

	const diagnosticsResponse = await E2ETestHelper.getNativeAgentDiagnostics()
	const diagnostics = diagnosticsResponse.diagnostics
	const apiAvailability = diagnostics?.apiAvailability ?? {}
	const registration = diagnostics?.registration ?? {}

	expect(diagnosticsResponse.success).toBe(true)
	expect(diagnosticsResponse.ready).toBe(true)
	expect(diagnostics?.extensionId).toBe("atnumridha.codevibe")
	expect(diagnostics?.enabledApiProposals).toEqual(expect.arrayContaining(NATIVE_CHAT_API_PROPOSALS))
	expect(diagnostics?.chatSessionContribution).toMatchObject({
		type: CODEVIBE_NATIVE_CHAT_SESSION_TYPE,
		displayName: "Codie Agent",
		order: -1000,
	})
	expect(apiAvailability.chatApi).toBe(true)
	expect(apiAvailability.createChatParticipant).toBe(true)
	expect(apiAvailability.registerChatSessionContentProvider).toBe(true)
	expect(registration.chatParticipant).toBe(true)
	expect(registration.chatParticipantIds).toEqual(expect.arrayContaining(["codevibe", "codevibe-agent"]))
	expect(registration.chatSessionProvider).toBe(true)
	expect(registration.chatSessionProviderTypes).toEqual([CODEVIBE_NATIVE_CHAT_SESSION_TYPE])
	const hasOptionalSessionListApi = Boolean(
		apiAvailability.registerCustomAgentProvider ||
			apiAvailability.registerChatSessionItemProvider ||
			apiAvailability.createChatSessionItemController,
	)
	const hasOptionalSessionListRegistration = Boolean(
		registration.customAgentProvider || registration.chatSessionItemProvider || registration.chatSessionItemController,
	)
	if (hasOptionalSessionListApi) {
		expect(hasOptionalSessionListRegistration).toBe(true)
	}
	expect(diagnostics?.failures).toEqual([])

	const openResponse = await E2ETestHelper.openNativeAgentSessionRuntime("sidebar")
	expect(openResponse.success).toBe(true)
	expect(openResponse.result).toMatchObject({
		position: "sidebar",
		command: CODEVIBE_OPEN_NATIVE_CHAT_SIDEBAR_COMMAND,
		commandAvailable: true,
		opened: true,
	})
	expect(openResponse.result?.error).toBeUndefined()
})

installedE2e("Installed VSIX opens the Codie webview composer", async ({ page, sidebar, helper }) => {
	const chatInput = await helper.getChatInput(sidebar)
	await expect(chatInput).toBeVisible()
	await expect(chatInput).toHaveAttribute("placeholder", /Start a Codie task|Message Codie/i)

	const modeSwitch = await helper.getModeSwitch(sidebar)
	await expect(modeSwitch).toBeVisible()

	const smokePrompt = "Plan a Codie installed-webview smoke test"
	const readySidebar = await helper.enterChatMessage(page, sidebar, smokePrompt)
	const readyChatInput = await helper.getChatInput(readySidebar)
	await expect(readyChatInput).toHaveValue(smokePrompt)

	const visibleWebviewText = await readySidebar.locator("body").innerText()
	expect(visibleWebviewText).toContain("Codie")
	expect(visibleWebviewText).not.toMatch(/\bCline\b/)
})
