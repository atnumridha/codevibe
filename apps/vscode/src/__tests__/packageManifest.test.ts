import { strict as assert } from "node:assert"
import { readFile } from "node:fs/promises"
import path from "node:path"

const vscodeRoot = process.cwd()
const packagePath = path.join(vscodeRoot, "package.json")
const CODEVIBE_CHAT_PARTICIPANT_ID = "codevibe"
const CODEVIBE_CHAT_SESSION_TYPE = "codevibe-agent"
const CODEVIBE_AGENT_HOST_CHAT_SESSION_TYPE = "agent-host-codevibe"
const CODEVIBE_NATIVE_AGENT_FILE_NAME = "00-codevibe-agent.agent.md"
const CODEVIBE_ACTIVITY_ICON = "assets/icons/activitybar.svg"
const CODEVIBE_MARKETPLACE_ICON = "assets/icons/icon.png"
const CHAT_PROMPT_CONTRIBUTION_KEYS = new Set(["path", "name", "description", "when", "sessionTypes"])
const CHAT_SESSION_CONTRIBUTION_KEYS = new Set([
	"id",
	"type",
	"name",
	"displayName",
	"description",
	"when",
	"icon",
	"order",
	"welcomeTitle",
	"welcomeMessage",
	"welcomeTips",
	"inputPlaceholder",
	"capabilities",
	"commands",
	"canDelegate",
	"requiresCustomModels",
	"autoAttachReferences",
	"useRequestToPopulateBuiltInPickers",
])
const CHAT_SESSION_CAPABILITY_KEYS = new Set([
	"supportsFileAttachments",
	"supportsToolAttachments",
	"supportsMCPAttachments",
	"supportsImageAttachments",
	"supportsSearchResultAttachments",
	"supportsInstructionAttachments",
	"supportsSourceControlAttachments",
	"supportsProblemAttachments",
	"supportsSymbolAttachments",
	"supportsPromptAttachments",
	"supportsHandOffs",
])
const CHAT_SESSION_COMMAND_KEYS = new Set(["name", "description", "when"])
const FAST_CURSOR_PARITY_EVIDENCE_FLAGS = [
	"--run-retrieval-indexing",
	"--run-mcp-oauth",
	"--run-standalone-ui",
	"--run-sandbox-policy",
	"--run-deeplinks",
	"--run-ndjson",
	"--run-background-agents",
	"--run-browser-tools",
	"--run-mermaid-planning",
]

async function readPackageManifest(): Promise<Record<string, any>> {
	return JSON.parse(await readFile(packagePath, "utf8"))
}

async function readJsonFile(filePath: string): Promise<Record<string, any>> {
	return JSON.parse(await readFile(filePath, "utf8"))
}

function assertOnlyAllowedKeys(value: Record<string, any>, allowedKeys: Set<string>, label: string) {
	for (const key of Object.keys(value)) {
		assert.equal(allowedKeys.has(key), true, `${label} unsupported key: ${key}`)
	}
}

describe("Package manifest", () => {
	it("declares valid CodeVibe native agent contributions", async () => {
		const packageJSON = await readPackageManifest()
		const participant = packageJSON.contributes.chatParticipants?.[0]
		const activitybarContainers = packageJSON.contributes.viewsContainers?.activitybar ?? []
		const activitybarContainerIds = activitybarContainers.map((container: { id: string }) => container.id)
		const codeVibeActivitybarContainer = activitybarContainers.find(
			(container: { id?: string }) => container.id === "codevibe-agent",
		)
		const views = packageJSON.contributes.views ?? {}
		const codeVibeAgentViews = views["codevibe-agent"] ?? []
		const nativeAgentView = codeVibeAgentViews.find((view: { id?: string }) => view.id === "codevibe-agent-chat")

		assert.equal(packageJSON.icon, CODEVIBE_MARKETPLACE_ICON)
		assert.equal(participant.id, CODEVIBE_CHAT_PARTICIPANT_ID)
		assert.match(participant.id, /^[A-Za-z0-9_-]+$/)
		assert.deepEqual(activitybarContainerIds, ["codevibe-agent"])
		assert.equal(codeVibeActivitybarContainer?.icon, CODEVIBE_ACTIVITY_ICON)
		assert.notEqual(codeVibeActivitybarContainer?.icon, CODEVIBE_MARKETPLACE_ICON)
		for (const containerId of activitybarContainerIds) {
			assert.match(containerId, /^[A-Za-z0-9_-]+$/)
		}
		for (const [viewContainerId, viewEntries] of Object.entries(views)) {
			assert.match(viewContainerId, /^[A-Za-z0-9_-]+$/)
			assert.equal(activitybarContainerIds.includes(viewContainerId), true)
			for (const view of Array.isArray(viewEntries) ? viewEntries : []) {
				assert.match((view as { id: string }).id, /^[A-Za-z0-9_-]+$/)
			}
		}
		assert.ok(Object.hasOwn(views, "codevibe-agent"))
		assert.equal(Object.hasOwn(views, "codevibe.agent"), false)
		assert.equal(packageJSON.activationEvents.includes("onView:codevibe.agent.chat"), false)
		assert.equal(packageJSON.activationEvents.includes("onView:codevibe-agent-chat"), true)
		assert.equal(packageJSON.activationEvents.includes(`onChatSession:${CODEVIBE_AGENT_HOST_CHAT_SESSION_TYPE}`), false)
		assert.equal(nativeAgentView?.visibility, "hidden")
		assert.equal(nativeAgentView?.name, "Compatibility Timeline")
		assert.equal(nativeAgentView?.icon, CODEVIBE_ACTIVITY_ICON)
		assert.equal(
			codeVibeAgentViews.some((view: { id?: string }) => view.id === "codevibe.SidebarProvider"),
			false,
		)
		assert.equal(
			codeVibeAgentViews.some((view: { id?: string }) => view.id === "claude-dev.SidebarProvider"),
			false,
		)
	})

	it("places CodeVibe before Copilot-style native agents", async () => {
		const packageJSON = await readPackageManifest()
		const [chatSession] = packageJSON.contributes.chatSessions ?? []
		const [newSessionMenu] = packageJSON.contributes.menus?.["chatSessions/newSession"] ?? []
		const sessionTypes = (packageJSON.contributes.chatSessions ?? []).map((session: { type?: string }) => session.type)
		const agentFile = await readFile(path.join(vscodeRoot, "agents", CODEVIBE_NATIVE_AGENT_FILE_NAME), "utf8")

		assertOnlyAllowedKeys(chatSession, CHAT_SESSION_CONTRIBUTION_KEYS, "chatSessions[0]")
		assertOnlyAllowedKeys(chatSession.capabilities, CHAT_SESSION_CAPABILITY_KEYS, "chatSessions[0].capabilities")
		for (const [index, command] of (chatSession.commands ?? []).entries()) {
			assertOnlyAllowedKeys(command, CHAT_SESSION_COMMAND_KEYS, `chatSessions[0].commands[${index}]`)
			assert.match(command.name, /^[A-Za-z0-9_-]+$/)
		}
		assert.deepEqual(packageJSON.contributes.chatAgents ?? [], [])
		assert.match(agentFile, /^---\nid: codevibe\n/m)
		assert.match(agentFile, /fenced `mermaid`/)
		assert.match(agentFile, /sandboxed execution/)
		assert.match(agentFile, /elevated trust/)
		assert.match(agentFile, /OpenAI skills/)
		assert.match(agentFile, /subagents/)
		assert.equal(chatSession?.id, CODEVIBE_CHAT_SESSION_TYPE)
		assert.equal(chatSession?.type, CODEVIBE_CHAT_SESSION_TYPE)
		assert.equal(chatSession?.customAgentTarget, undefined)
		assert.equal(chatSession?.alternativeIds, undefined)
		assert.equal(chatSession?.order, -1000)
		assert.match(chatSession?.type, /^[A-Za-z0-9_-]+$/)
		assert.equal(chatSession?.type.startsWith("agent-host-"), false)
		assert.deepEqual(sessionTypes, [CODEVIBE_CHAT_SESSION_TYPE])
		assert.equal(sessionTypes.some((sessionType?: string) => sessionType?.startsWith("agent-host-")), false)
		assert.equal(sessionTypes.includes(CODEVIBE_AGENT_HOST_CHAT_SESSION_TYPE), false)
		assert.equal(newSessionMenu?.command, "codevibe.newNativeAgentSession")
		assert.equal(newSessionMenu?.group, "navigation@-1000")
		assert.equal(newSessionMenu?.when, undefined)
	})

	it("ships native CodeVibe prompt and skill contributions", async () => {
		const packageJSON = await readPackageManifest()
		const promptFiles = packageJSON.contributes.chatPromptFiles ?? []
		const skillFiles = packageJSON.contributes.chatSkills ?? []
		const expectedPrompts = [
			"./assets/prompts/codevibe-plan.prompt.md",
			"./assets/prompts/codevibe-review.prompt.md",
			"./assets/prompts/codevibe-standalone-readiness.prompt.md",
		]
		const expectedSkills = [
			"./assets/prompts/skills/codevibe-customizations/SKILL.md",
			"./assets/prompts/skills/codevibe-cursor-compatibility/SKILL.md",
			"./assets/prompts/skills/codevibe-mcp/SKILL.md",
			"./assets/prompts/skills/codevibe-background-sessions/SKILL.md",
			"./assets/prompts/skills/codevibe-release-validation/SKILL.md",
			"./assets/prompts/skills/codevibe-performance-troubleshooting/SKILL.md",
		]

		assert.deepEqual(
			promptFiles.map((entry: { path?: string }) => entry.path),
			expectedPrompts,
		)
		assert.deepEqual(
			skillFiles.map((entry: { path?: string }) => entry.path),
			expectedSkills,
		)

		for (const entry of [...promptFiles, ...skillFiles] as Array<{ path?: string; sessionTypes?: string[] }>) {
			assert.deepEqual(entry.sessionTypes, [CODEVIBE_CHAT_SESSION_TYPE], entry.path)
			assert.equal(typeof entry.path, "string")
			assert.match(entry.path ?? "", /^\.\/assets\/prompts\//)
			const fileText = await readFile(path.join(vscodeRoot, entry.path?.replace(/^\.\//, "") ?? ""), "utf8")
			assert.match(fileText, /^---\nname: [a-z0-9-]+\n/m, entry.path)
			assert.match(fileText, /\ndescription: .+\n/m, entry.path)
			assert.equal(/\bCline\b/.test(fileText), false, entry.path)
		}
	})

	it("keeps visible contribution strings on CodeVibe branding", async () => {
		const packageJSON = await readPackageManifest()
		const serializedContributions = JSON.stringify(packageJSON.contributes)
		const brandingAuditScript = await readFile(
			path.join(vscodeRoot, "scripts", "check-codevibe-branding.mjs"),
			"utf8",
		)

		assert.equal(/\bCline\b/.test(serializedContributions), false)
		assert.equal(serializedContributions.includes("claude-dev.SidebarProvider"), false)
		for (const command of packageJSON.contributes.commands ?? []) {
			assert.equal(String(command.command).startsWith("cline."), false)
		}
		const commandIds = new Set(
			(packageJSON.contributes.commands ?? []).map((command: { command?: string }) => command.command),
		)
		assert.equal(commandIds.has("codevibe.fixWithCodeVibe"), true)
		assert.equal(packageJSON.activationEvents.includes("onCommand:codevibe.fixWithCodeVibe"), true)
		for (const [menuId, items] of Object.entries(packageJSON.contributes.menus ?? {})) {
			for (const item of Array.isArray(items) ? items : []) {
				assert.equal(String((item as { command?: string }).command).startsWith("cline."), false, menuId)
			}
		}
		assert.equal(brandingAuditScript.includes("stale VSIX artifact version"), true)
		assert.equal(brandingAuditScript.includes("extension.vsixmanifest"), true)
		assert.equal(brandingAuditScript.includes("ClineModelPicker"), true)
		assert.equal(brandingAuditScript.includes("legacy Cline version payload key"), true)
	})

	it("cleans stale invalid CodeVibe view containers during VSIX install", async () => {
		const packageJSON = await readPackageManifest()
		const packageScript = await readFile(path.join(vscodeRoot, "scripts", "package-github-vsix.mjs"), "utf8")
		const extensionSource = await readFile(path.join(vscodeRoot, "src", "extension.ts"), "utf8")
		const webviewProviderSource = await readFile(path.join(vscodeRoot, "src", "hosts", "vscode", "VscodeWebviewProvider.ts"), "utf8")

		assert.equal(packageScript.includes("pruneInstalledCodeVibeExtensionVersions"), true)
		assert.equal(packageScript.includes("createNativeAgentDiscoveryTombstones"), false)
		assert.equal(packageScript.includes("native-agent tombstone"), false)
		assert.equal(packageScript.includes("enableNativeAgentInVSCodeArgv(metadata)"), true)
		assert.equal(packageScript.includes('"Code", "User", "argv.json"'), true)
		assert.equal(packageScript.includes("resolveVsCodeUserStorageDirs"), true)
		assert.equal(/path\.join\([\s\S]*"VibeCode IDE"[\s\S]*"User"[\s\S]*\)/.test(packageScript), true)
		assert.equal(packageScript.includes("CODEVIBE_VSCODE_USER_STORAGE_DIRS"), true)
		assert.equal(packageScript.includes("--clean-legacy-view-state-only"), true)
		assert.equal(packageScript.includes("options.cleanLegacyViewStateOnly"), true)
		assert.equal(
			packageJSON.scripts?.["repair:vscode-state"],
			"node scripts/package-github-vsix.mjs --clean-legacy-view-state-only",
		)
		assert.equal(packageScript.includes("resolveLegacyVSCodeArgvJsonPaths"), true)
		assert.equal(packageScript.includes("writeInstalledNativeAgentCache(metadata)"), false)
		assert.equal(packageScript.includes("nativeAgentMarkdownPath"), false)
		assert.equal(packageScript.includes("readNativeAgentMarkdown()"), false)
		assert.equal(packageScript.includes("Repaired CodeVibe native agent cache file"), false)
		assert.equal(packageScript.includes("removeInstalledNativeAgentCache(metadata)"), true)
		assert.equal(packageScript.includes("Removed stale CodeVibe native agent cache"), true)
		assert.equal(packageScript.includes("cleanLegacyCodeVibeNativeChatStateDatabase"), true)
		assert.equal(packageScript.includes("agent-host-codevibe"), true)
		assert.equal(packageScript.includes("resolveVsCodeExtensionsDir"), true)
		assert.equal(packageScript.includes("fs.rmSync(extensionPath, { recursive: true, force: true })"), true)
		assert.equal(packageScript.includes("installed VSIX package.json"), true)
		assert.equal(packageScript.includes("verifyDefaultInstallWithCode(metadata, options.code)"), true)
		assert.equal(packageScript.includes("default installed VSIX package.json"), true)
		assert.equal(packageScript.includes("assertNoStaleInstalledCodeVibeExtensionVersions"), true)
		assert.equal(packageScript.includes("VSIX install left stale CodeVibe extension folder"), true)
		assert.equal(packageScript.includes("VSIX default install verified"), true)
		assert.equal(packageScript.includes("workbench.view.extension.codevibe.agent"), true)
		assert.equal(packageScript.includes("workbench.view.extension.codevibe-agent"), true)
		assert.equal(packageScript.includes("'workbench.view.extension.codevibe.agent.state'"), true)
		assert.equal(packageScript.includes("'workbench.view.extension.codevibe.agent.state.hidden'"), true)
		assert.equal(packageScript.includes("'workbench.view.extension.codevibe.agent.numberOfVisibleViews'"), true)
		assert.equal(packageScript.includes("'workbench.view.extension.codevibe-agent.state'"), true)
		assert.equal(packageScript.includes("'workbench.view.extension.codevibe-agent.state.hidden'"), true)
		assert.equal(packageScript.includes("'workbench.view.extension.codevibe-agent.numberOfVisibleViews'"), true)
		assert.equal(packageScript.includes('"codevibe.agentPanel"'), true)
		assert.equal(packageScript.includes('"codevibe-agent-chat"'), true)
		assert.equal(packageScript.includes('"memento/mainThreadWebviewPanel.origins"'), true)
		assert.equal(/filterJsonArrayByIdSql\(\s*"workbench\.auxiliarybar\.placeholderPanels"/.test(packageScript), true)
		assert.equal(/filterJsonArrayByIdSql\(\s*"workbench\.auxiliarybar\.pinnedPanels"/.test(packageScript), true)
		assert.equal(
			/filterJsonArrayByIdSql\(\s*"workbench\.auxiliarybar\.viewContainersWorkspaceState"/.test(packageScript),
			true,
		)
		assert.equal(packageScript.includes("assertCodeVibeChatResourceContributions"), true)
		assert.equal(packageScript.includes("packageJson.contributes?.chatPromptFiles"), true)
		assert.equal(packageScript.includes("packageJson.contributes?.chatSkills"), true)
		assert.equal(extensionSource.includes("`id: ${CODEVIBE_CHAT_PARTICIPANT_ID}`"), true)
		assert.equal(extensionSource.includes("hostChatParticipantRegistered"), false)
		assert.equal(extensionSource.includes("CODEVIBE_AGENT_HOST_CHAT_SESSION_TYPE"), false)
		assert.equal(extensionSource.includes("agentHostChatParticipant || defaultChatParticipant"), false)
		assert.equal(extensionSource.includes("await webview.showPanel(preserveEditorFocus)"), true)
		assert.equal(extensionSource.includes("await webview.show(preserveEditorFocus)"), false)
		assert.equal(webviewProviderSource.includes('createWebviewPanel(ExtensionRegistryInfo.views.Panel'), true)
		assert.equal(webviewProviderSource.includes('"codevibe.agentPanel"'), false)
		assert.equal(webviewProviderSource.includes("revealAgentSidebar"), false)
	})

	it("keeps GitHub release packaging non-interactive", async () => {
		const packageJSON = await readPackageManifest()
		const packageScript = await readFile(path.join(vscodeRoot, "scripts", "package-github-vsix.mjs"), "utf8")
		const candidateWorkflow = await readFile(
			path.join(vscodeRoot, "..", "..", ".github", "workflows", "ext-vscode-github-release.yml"),
			"utf8",
		)
		const stableWorkflow = await readFile(
			path.join(vscodeRoot, "..", "..", ".github", "workflows", "ext-vscode-publish-stable.yml"),
			"utf8",
		)

		assert.equal(packageScript.includes("CODEVIBE_PACKAGE_COMMAND_TIMEOUT_MS"), true)
		assert.equal(packageScript.includes("CODEVIBE_VSCODE_SMOKE_INSTALL_TIMEOUT_MS"), true)
		assert.equal(candidateWorkflow.includes("package_args=(--out-dir . --verify-install)"), false)
		assert.equal(stableWorkflow.includes("package_args=(--out-dir . --verify-install --require-release-gate)"), false)
		assert.equal(candidateWorkflow.includes("package_args=(--out-dir .)"), true)
		assert.equal(stableWorkflow.includes("package_args=(--out-dir . --require-release-gate)"), true)
		const fastEvidenceScript = packageJSON.scripts?.["release:cursor-parity:evidence:fast"] ?? ""
		for (const workflow of [candidateWorkflow, stableWorkflow]) {
			assert.equal(workflow.includes("Prepare standalone release assets"), true)
			assert.equal(workflow.includes("prepare-standalone-release-assets.mjs"), true)
			assert.equal(workflow.includes("apps/vscode/dist-standalone/standalone.zip"), true)
			assert.equal(workflow.includes("apps/vscode/dist-standalone/standalone.zip.sha256"), true)
			assert.equal(workflow.includes("apps/vscode/dist-standalone/standalone-manifest.json"), true)
			assert.equal(workflow.includes("collect-cursor-parity-evidence.mjs"), true)
			for (const flag of FAST_CURSOR_PARITY_EVIDENCE_FLAGS) {
				assert.equal(workflow.includes(flag), true, flag)
			}
		}
		for (const flag of FAST_CURSOR_PARITY_EVIDENCE_FLAGS) {
			assert.equal(fastEvidenceScript.includes(flag), true, flag)
		}
		assert.equal(
			candidateWorkflow.includes(
				"continue-on-error: ${{ (github.event.inputs.release_stage || 'candidate') == 'candidate' }}",
			),
			true,
		)
		assert.equal(stableWorkflow.includes("continue-on-error:"), false)
	})

	it("keeps upstream base patch scripts CodeVibe-native and strips them from packaged metadata", async () => {
		const packageJSON = await readPackageManifest()
		const packageScript = await readFile(path.join(vscodeRoot, "scripts", "package-github-vsix.mjs"), "utf8")
		const scriptNames = Object.keys(packageJSON.scripts ?? {})

		assert.equal(packageJSON.scripts?.["upstream:base:plan"], "node scripts/prepare-upstream-base-patch.mjs")
		assert.equal(
			packageJSON.scripts?.["upstream:base:fetch"],
			"node scripts/prepare-upstream-base-patch.mjs --fetch --write-report",
		)
		assert.equal(
			packageJSON.scripts?.["upstream:base:export-patch"],
			"node scripts/prepare-upstream-base-patch.mjs --export-patch --write-report",
		)
		assert.equal(scriptNames.some((name) => name.startsWith("upstream:cline:")), false)
		assert.equal(packageScript.includes('for (const key of ["scripts", "lint-staged", "devDependencies"])'), true)
		assert.equal(/assertPackagedManifestNoDevMetadata\(\s*packagedPackageJson/.test(packageScript), true)
		assert.equal(/assertPackagedManifestNoDevMetadata\(\s*installedPackageJson/.test(packageScript), true)
	})

	it("brands the standalone runtime entrypoint as CodeVibe core", async () => {
		const packageJSON = await readPackageManifest()
		const runtimePackage = await readJsonFile(path.join(vscodeRoot, "standalone", "runtime-files", "package.json"))
		const runtimePackageLock = await readJsonFile(path.join(vscodeRoot, "standalone", "runtime-files", "package-lock.json"))
		const esbuildScript = await readFile(path.join(vscodeRoot, "esbuild.mjs"), "utf8")
		const standaloneServerScript = await readFile(
			path.join(vscodeRoot, "scripts", "test-standalone-core-api-server.ts"),
			"utf8",
		)
		const standalonePackageScript = await readFile(path.join(vscodeRoot, "scripts", "package-standalone.mjs"), "utf8")
		const standaloneVerifierScript = await readFile(path.join(vscodeRoot, "scripts", "verify-standalone-package.mjs"), "utf8")
		const standaloneSmokeScript = await readFile(path.join(vscodeRoot, "scripts", "smoke-standalone-package.ts"), "utf8")
		const standaloneReleaseAssetsScript = await readFile(
			path.join(vscodeRoot, "scripts", "prepare-standalone-release-assets.mjs"),
			"utf8",
		)
		const cursorParityEvidenceScript = await readFile(
			path.join(vscodeRoot, "scripts", "collect-cursor-parity-evidence.mjs"),
			"utf8",
		)

		assert.equal(runtimePackage.name, "codevibe-core")
		assert.equal(runtimePackage.main, "codevibe-core.js")
		assert.equal(runtimePackageLock.name, "codevibe-core")
		assert.equal(runtimePackageLock.packages?.[""]?.name, "codevibe-core")
		assert.equal(esbuildScript.includes("standaloneDebugBuild"), true)
		assert.equal(esbuildScript.includes("standalone && !standaloneDebugBuild"), true)
		assert.equal(esbuildScript.includes('entryPoints: ["src/standalone/codevibe-core.ts"]'), true)
		assert.equal(esbuildScript.includes("codevibe-core.js"), true)
		assert.equal(esbuildScript.includes("src/standalone/cline-core.ts"), false)
		assert.equal(standaloneServerScript.includes("CODEVIBE_CORE_FILE"), true)
		assert.equal(standaloneServerScript.includes('"codevibe-core.js"'), true)
		assert.equal(standalonePackageScript.includes("standalone-manifest.json"), true)
		assert.equal(standalonePackageScript.includes("requiresExternalHostBridge: true"), true)
		assert.equal(standalonePackageScript.includes("selfContainedApp: false"), true)
		assert.equal(standalonePackageScript.includes("providesCoreGrpcServer: true"), true)
		assert.equal(standalonePackageScript.includes("providesHostBridgeServer: false"), true)
		assert.equal(standalonePackageScript.includes("verify-standalone-package.mjs"), true)
		assert.equal(standalonePackageScript.includes("not being used by cline"), false)
		assert.equal(standalonePackageScript.includes("upstreamPatchBase"), false)
		assert.equal(standalonePackageScript.includes("legacyEnvironmentAliases"), false)
		assert.equal(standalonePackageScript.includes('buildDirIgnore.push("**/*.map")'), true)
		assert.equal(standaloneServerScript.includes("validateStandaloneManifest"), true)
		assert.equal(standaloneServerScript.includes("manifest.uiContract?.selfContainedApp, false"), true)
		assert.equal(standaloneServerScript.includes("manifest.services?.hostBridge?.bundled, false"), true)
		assert.equal(standaloneVerifierScript.includes("standalone-manifest.json"), true)
		assert.equal(standaloneVerifierScript.includes("requiresExternalHostBridge"), true)
		assert.equal(standaloneVerifierScript.includes("manifest.uiContract?.webviewBuildPath"), true)
		assert.equal(standaloneVerifierScript.includes("standalone.zip must not include standalone.zip.sha256"), true)
		assert.equal(standaloneVerifierScript.includes("non-debug standalone.zip must not include codevibe-core.js.map"), true)
		assert.equal(standaloneVerifierScript.includes("manifest must not expose upstream patch metadata"), true)
		assert.equal(standaloneSmokeScript.includes("standalone-manifest.json"), true)
		assert.equal(standaloneSmokeScript.includes("resolveNodePath"), true)
		assert.equal(standaloneSmokeScript.includes("resolveRuntimeNode"), true)
		assert.equal(standaloneSmokeScript.includes("CODEVIBE_STANDALONE_NODE"), true)
		assert.equal(standaloneSmokeScript.includes("nodeTargetVersion"), true)
		assert.equal(standaloneSmokeScript.includes("waitForGrpcHealth"), true)
		assert.equal(standaloneSmokeScript.includes("CodeVibeApiServerMock"), true)
		assert.equal(standaloneSmokeScript.includes("npx"), false)
		assert.equal(packageJSON.scripts?.["smoke:standalone-package"], "node node_modules/tsx/dist/cli.mjs scripts/smoke-standalone-package.ts")
		assert.equal(cursorParityEvidenceScript.includes("Standalone package artifact build and manifest verification"), true)
		assert.equal(cursorParityEvidenceScript.includes("Standalone extracted package consumer smoke"), true)
		assert.equal(cursorParityEvidenceScript.includes("BrowserToolHandler.evaluate.test.ts"), true)
		assert.equal(cursorParityEvidenceScript.includes("BrowserToolHandler evaluate safety"), true)
		assert.equal(cursorParityEvidenceScript.includes('"compile-standalone"'), true)
		assert.equal(cursorParityEvidenceScript.includes("smoke-standalone-package.ts"), true)
		assert.equal(cursorParityEvidenceScript.includes("verify-standalone-package.mjs"), true)
		assert.equal(cursorParityEvidenceScript.includes("dist-standalone/standalone.zip"), true)
		assert.equal(cursorParityEvidenceScript.includes("npm exec --package"), false)
		assert.equal(cursorParityEvidenceScript.includes("const localTsxCli"), true)
		assert.equal(cursorParityEvidenceScript.includes('"tsx", "dist", "cli.mjs"'), true)
		assert.equal(standaloneReleaseAssetsScript.includes("createHash"), true)
		assert.equal(standaloneReleaseAssetsScript.includes("standaloneChecksumPath"), true)
		assert.equal(standaloneReleaseAssetsScript.includes(".sha256"), true)
		assert.equal(standaloneReleaseAssetsScript.includes("verify-standalone-package.mjs"), true)
		assert.equal(standaloneReleaseAssetsScript.includes("inspectStandaloneReleaseAssets"), true)
		assert.equal(standaloneReleaseAssetsScript.includes("extension/package.json"), true)
		assert.equal(standaloneReleaseAssetsScript.includes("standalone.zip.sha256 is missing or malformed"), true)
		assert.equal(standaloneReleaseAssetsScript.includes("standalone.zip contains standalone.zip.sha256"), true)
		assert.equal(standaloneReleaseAssetsScript.includes("standalone.zip contains codevibe-core.js.map"), true)
	})
})
