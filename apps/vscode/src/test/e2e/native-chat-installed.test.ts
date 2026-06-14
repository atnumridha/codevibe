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
		chatPromptFiles?: Array<{ path?: string; sessionTypes?: string[] }>
		chatSessions?: Array<{ id?: string; type?: string; displayName?: string }>
		chatSkills?: Array<{ path?: string; sessionTypes?: string[] }>
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
const EXPECTED_PROMPT_FILES = [
	"./assets/prompts/codevibe-plan.prompt.md",
	"./assets/prompts/codevibe-review.prompt.md",
	"./assets/prompts/codevibe-standalone-readiness.prompt.md",
]
const EXPECTED_SKILL_FILES = [
	"./assets/prompts/skills/codevibe-customizations/SKILL.md",
	"./assets/prompts/skills/codevibe-cursor-compatibility/SKILL.md",
	"./assets/prompts/skills/codevibe-local-plan-build/SKILL.md",
	"./assets/prompts/skills/codevibe-mcp/SKILL.md",
	"./assets/prompts/skills/codevibe-background-sessions/SKILL.md",
	"./assets/prompts/skills/codevibe-release-validation/SKILL.md",
	"./assets/prompts/skills/codevibe-performance-troubleshooting/SKILL.md",
]

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
	expect(manifest?.contributes?.chatPromptFiles?.map((entry) => entry.path)).toEqual(EXPECTED_PROMPT_FILES)
	expect(manifest?.contributes?.chatSkills?.map((entry) => entry.path)).toEqual(EXPECTED_SKILL_FILES)
	for (const entry of [
		...(manifest?.contributes?.chatPromptFiles ?? []),
		...(manifest?.contributes?.chatSkills ?? []),
	]) {
		expect(entry.sessionTypes).toEqual([CODEVIBE_NATIVE_CHAT_SESSION_TYPE])
		expect(entry.path).toMatch(/^\.\/assets\/prompts\//)
		const fileText = readFileSync(path.join(installed?.extensionPath ?? "", entry.path?.replace(/^\.\//, "") ?? ""), "utf8")
		expect(fileText).toMatch(/^---\nname: [a-z0-9-]+\n/m)
		expect(fileText).toMatch(/\ndescription: .+\n/m)
		expect(fileText).not.toMatch(/\bCline\b/)
	}
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

installedE2e("Installed VSIX opens native plan editor for local plan files", async ({ app: _app }) => {
	await expect
		.poll(
			async () => {
				const diagnosticsResponse = await E2ETestHelper.getNativeAgentDiagnostics().catch(() => ({ success: false }))
				return diagnosticsResponse.success === true
			},
			{
				message: "Installed Codie VSIX should activate its E2E command server before plan commands run",
				timeout: 60_000,
			},
		)
		.toBe(true)

	const created = await E2ETestHelper.createNativePlan({
		composerId: "installed-native-plan-e2e",
		response:
			"## Native Plan E2E\n\nCreate and open a plan from the installed VSIX.\n\n```mermaid\nflowchart TD\n  A[\"Create .plan.md\"] --> B[\"Open custom editor\"]\n```\n\n## Acceptance Criteria\n\n- Plan is persisted locally.\n- The native plan editor opens.",
		taskProgress: "- [ ] Create installed plan file\n- [ ] Open native plan editor",
	})

	expect(created.success).toBe(true)
	expect(created.plan?.planId).toMatch(/^Native-Plan-E2E_[a-z0-9]{8}$/)
	expect(created.plan?.planPath).toMatch(/\.plan\.md$/)
	expect(created.plan?.todoCount).toBe(2)
	expect(created.plan?.metadata?.name).toBe("Native Plan E2E")
	expect(created.plan?.metadata?.todos?.map((todo) => todo.status)).toEqual(["pending", "pending"])

	const planPath = created.plan?.planPath
	expect(planPath).toBeTruthy()
	const planText = readFileSync(planPath ?? "", "utf8")
	expect(planText).toMatch(/^---\nname: Native Plan E2E/m)
	expect(planText).toContain("todos:")
	expect(planText).toContain("```mermaid")
	expect(planText).not.toMatch(/\bCline\b/)

	const opened = await E2ETestHelper.openLatestNativePlan()
	expect(opened.success).toBe(true)
	expect(opened.latestPlan?.uri).toBe(planPath)
	expect(opened.latestPlan?.name).toBe("Native Plan E2E")
	expect(opened.activeTab?.inputUri).toBe(planPath)
	expect(opened.activeTab?.inputViewType).toBe("codevibe.planEditor")
	expect(opened.activeTab?.label).toContain("Native-Plan-E2E")
})

installedE2e("Installed VSIX uses VS Code native text search before file reads", async ({ app: _app }) => {
	await expect
		.poll(
			async () => {
				const diagnosticsResponse = await E2ETestHelper.getNativeAgentDiagnostics().catch(() => ({ success: false }))
				return diagnosticsResponse.success === true
			},
			{
				message: "Installed Codie VSIX should activate its E2E command server before search commands run",
				timeout: 60_000,
			},
		)
		.toBe(true)

	const response = await E2ETestHelper.searchNativeWorkspaceText({
		regex: "installedSearchNeedle",
		filePattern: "*.ts",
		maxResults: 10,
		files: [
			{
				relativePath: "src/search-target.ts",
				content: "const before = false\nexport const installedSearchNeedle = true\nconst after = true\n",
			},
			{
				relativePath: "docs/search-target.md",
				content: "installedSearchNeedle should not appear when the *.ts include pattern is respected\n",
			},
		],
	})

	expect(response.success).toBe(true)
	expect(response.nativeTextSearchAvailable).toBe(true)
	expect(response.nativeFindTextInFilesCalls).toBe(1)
	expect(response.fallbackFindFilesCalls).toBe(0)
	expect(response.fallbackReadFileCalls).toBe(0)
	expect(response.limitHit).toBe(false)
	expect(response.matches).toEqual([
		expect.objectContaining({
			path: "src/search-target.ts",
			line: 2,
			column: 13,
			match: "export const installedSearchNeedle = true",
		}),
	])
	expect(response.matches?.[0]?.beforeContext).toEqual(expect.any(Array))
	expect(response.matches?.[0]?.afterContext).toEqual(expect.any(Array))
})

installedE2e("Installed VSIX evaluates Cursor sandbox policy and inline terminal run modes", async ({ app: _app }) => {
	await expect
		.poll(
			async () => {
				const diagnosticsResponse = await E2ETestHelper.getNativeAgentDiagnostics().catch(() => ({ success: false }))
				return diagnosticsResponse.success === true
			},
			{
				message: "Installed Codie VSIX should activate its E2E command server before sandbox diagnostics run",
				timeout: 60_000,
			},
		)
		.toBe(true)

	const response = await E2ETestHelper.evaluateNativeSandboxPolicy()

	expect(response.success).toBe(true)
	expect(response.policy?.status).toBe("loaded")
	expect(response.policy?.configSource).toBe("cursorCompatibility")
	expect(response.policy?.configPathRelative).toBe(".cursor/sandbox.json")
	expect(response.policy?.effectiveAccess).toBe("readOnly")
	expect(response.policy?.allowReadAutoApprove).toBe(true)
	expect(response.policy?.allowWriteAutoApprove).toBe(false)
	expect(response.policy?.allowTerminalAutoApprove).toBe(false)
	expect(response.policy?.allowNetworkAutoApprove).toBe(false)
	expect(response.policy?.commandPermissions?.allow).toContain("git diff")
	expect(response.policy?.commandPermissions?.deny).toContain("git commit *")
	expect(response.policy?.commandPermissions?.allowRedirects).toBe(false)

	expect(response.defaultRunModes).toEqual({
		withSandboxPolicy: "sandboxed",
		withoutSandboxPolicy: "default",
	})

	expect(response.commands?.readOnly?.sandboxed).toEqual(
		expect.objectContaining({ allowed: true, reason: "allowed" }),
	)
	expect(response.commands?.mutating?.sandboxed).toEqual(
		expect.objectContaining({ allowed: false, reason: "no_match_deny_default" }),
	)
	expect(response.commands?.mutating?.elevated).toEqual(expect.objectContaining({ allowed: true, reason: "no_config" }))
	expect(response.commands?.gitWrite?.sandboxed).toEqual(
		expect.objectContaining({ allowed: false, reason: "denied", matchedPattern: "git commit *" }),
	)
	expect(response.commands?.redirect?.sandboxed).toEqual(
		expect.objectContaining({ allowed: false, reason: "redirect_detected" }),
	)

	expect(response.inlineRequests?.sandboxed).toEqual(
		expect.objectContaining({
			ok: true,
			request: expect.objectContaining({ requestedTerminalRunMode: "sandboxed", requiresManualApproval: false }),
		}),
	)
	expect(response.inlineRequests?.unelevated).toEqual(
		expect.objectContaining({
			ok: true,
			request: expect.objectContaining({ requestedTerminalRunMode: "default", requiresManualApproval: false }),
		}),
	)
	expect(response.inlineRequests?.requireEscalated).toEqual(
		expect.objectContaining({
			ok: true,
			request: expect.objectContaining({ requestedTerminalRunMode: "elevated", requiresManualApproval: true }),
		}),
	)
	expect(response.inlineRequests?.booleanEscalated).toEqual(
		expect.objectContaining({
			ok: true,
			request: expect.objectContaining({ requestedTerminalRunMode: "elevated", requiresManualApproval: true }),
		}),
	)
})

installedE2e("Installed VSIX opens the Codie webview composer", async ({ page, sidebar, helper }) => {
	const signInButton = sidebar.getByRole("button", { name: "Sign in to Codie" })
	if (await signInButton.isVisible().catch(() => false)) {
		sidebar = await helper.signin(sidebar, page)
	} else {
		sidebar = await helper.getReadySidebar(page)
	}

	const chatInput = await helper.getChatInput(sidebar)
	await expect(chatInput).toBeVisible()
	await expect(chatInput).toHaveAttribute("placeholder", /Start a Codie task|Message Codie/i)

	const modeSwitch = await helper.getModeSwitch(sidebar)
	await expect(modeSwitch).toBeVisible()

	const smokePrompt = "Plan a Codie installed-webview smoke test"
	await chatInput.fill(smokePrompt)
	await expect(chatInput).toHaveValue(smokePrompt)

	const visibleWebviewText = await sidebar.locator("body").innerText()
	expect(visibleWebviewText).toContain("Codie")
	expect(visibleWebviewText).not.toMatch(/\bCline\b/)
})
