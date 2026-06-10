import { strict as assert } from "node:assert"
import { readFile } from "node:fs/promises"
import path from "node:path"
import {
	CODEVIBE_CHAT_PARTICIPANT_ID,
	CODEVIBE_CHAT_SESSION_TYPE,
	CODEVIBE_NATIVE_AGENT_FILE_NAME,
} from "@/hosts/vscode/native-chat-registration"

const packagePath = path.join(__dirname, "..", "..", "package.json")
const vscodeRoot = path.join(__dirname, "..", "..")

async function readPackageManifest(): Promise<Record<string, any>> {
	return JSON.parse(await readFile(packagePath, "utf8"))
}

async function readJsonFile(filePath: string): Promise<Record<string, any>> {
	return JSON.parse(await readFile(filePath, "utf8"))
}

describe("Package manifest", () => {
	it("declares valid CodeVibe native agent contributions", async () => {
		const packageJSON = await readPackageManifest()
		const participant = packageJSON.contributes.chatParticipants?.[0]
		const activitybarContainers = packageJSON.contributes.viewsContainers?.activitybar ?? []
		const activitybarContainerIds = activitybarContainers.map((container: { id: string }) => container.id)
		const views = packageJSON.contributes.views ?? {}
		const codeVibeAgentViews = views["codevibe-agent"] ?? []
		const nativeAgentView = codeVibeAgentViews.find((view: { id?: string }) => view.id === "codevibe-agent-chat")

		assert.equal(participant.id, CODEVIBE_CHAT_PARTICIPANT_ID)
		assert.match(participant.id, /^[A-Za-z0-9_-]+$/)
		assert.deepEqual(activitybarContainerIds, ["codevibe-agent"])
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
		assert.equal(nativeAgentView?.visibility, "hidden")
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
		const [chatAgent] = packageJSON.contributes.chatAgents ?? []
		const [chatSession] = packageJSON.contributes.chatSessions ?? []
		const [newSessionMenu] = packageJSON.contributes.menus?.["chatSessions/newSession"] ?? []
		const sessionTypes = (packageJSON.contributes.chatSessions ?? []).map((session: { type?: string }) => session.type)

		assert.equal(chatAgent?.id, CODEVIBE_CHAT_PARTICIPANT_ID)
		assert.equal(chatAgent?.path, `agents/${CODEVIBE_NATIVE_AGENT_FILE_NAME}`)
		assert.equal(chatSession?.id, CODEVIBE_CHAT_SESSION_TYPE)
		assert.equal(chatSession?.type, CODEVIBE_CHAT_SESSION_TYPE)
		assert.equal(chatSession?.customAgentTarget, CODEVIBE_CHAT_PARTICIPANT_ID)
		assert.equal(chatSession?.order, -1000)
		assert.match(chatSession?.id, /^[A-Za-z0-9_-]+$/)
		assert.match(chatSession?.type, /^[A-Za-z0-9_-]+$/)
		assert.deepEqual(sessionTypes, [CODEVIBE_CHAT_SESSION_TYPE])
		assert.equal(sessionTypes.includes("codevibe-agent"), false)
		assert.equal(newSessionMenu?.command, "codevibe.newNativeAgentSession")
		assert.equal(newSessionMenu?.group, "navigation@-1000")
		assert.equal(newSessionMenu?.when, undefined)
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
	})

	it("cleans stale invalid CodeVibe view containers during VSIX install", async () => {
		const packageScript = await readFile(path.join(__dirname, "..", "..", "scripts", "package-github-vsix.mjs"), "utf8")

		assert.equal(packageScript.includes("pruneInstalledCodeVibeExtensionVersions"), true)
		assert.equal(packageScript.includes("createNativeAgentDiscoveryTombstones"), false)
		assert.equal(packageScript.includes("native-agent tombstone"), false)
		assert.equal(packageScript.includes("enableNativeAgentInVSCodeArgv(metadata)"), true)
		assert.equal(packageScript.includes("resolveVsCodeExtensionsDir"), true)
		assert.equal(packageScript.includes("fs.rmSync(extensionPath, { recursive: true, force: true })"), true)
		assert.equal(packageScript.includes("installed VSIX package.json"), true)
		assert.equal(packageScript.includes("workbench.view.extension.codevibe.agent"), true)
		assert.equal(packageScript.includes("'workbench.view.extension.codevibe.agent.state'"), true)
		assert.equal(packageScript.includes("'workbench.view.extension.codevibe.agent.state.hidden'"), true)
		assert.equal(packageScript.includes("'workbench.view.extension.codevibe.agent.numberOfVisibleViews'"), true)
	})

	it("keeps GitHub release packaging non-interactive", async () => {
		const packageScript = await readFile(path.join(__dirname, "..", "..", "scripts", "package-github-vsix.mjs"), "utf8")
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
		for (const workflow of [candidateWorkflow, stableWorkflow]) {
			assert.equal(workflow.includes("Prepare standalone release assets"), true)
			assert.equal(workflow.includes("prepare-standalone-release-assets.mjs"), true)
			assert.equal(workflow.includes("apps/vscode/dist-standalone/standalone.zip"), true)
			assert.equal(workflow.includes("apps/vscode/dist-standalone/standalone.zip.sha256"), true)
			assert.equal(workflow.includes("apps/vscode/dist-standalone/standalone-manifest.json"), true)
		}
		assert.equal(
			candidateWorkflow.includes(
				"continue-on-error: ${{ (github.event.inputs.release_stage || 'candidate') == 'candidate' }}",
			),
			true,
		)
		assert.equal(stableWorkflow.includes("continue-on-error:"), false)
	})

	it("brands the standalone runtime entrypoint as CodeVibe core", async () => {
		const runtimePackage = await readJsonFile(path.join(vscodeRoot, "standalone", "runtime-files", "package.json"))
		const runtimePackageLock = await readJsonFile(path.join(vscodeRoot, "standalone", "runtime-files", "package-lock.json"))
		const esbuildScript = await readFile(path.join(vscodeRoot, "esbuild.mjs"), "utf8")
		const standaloneServerScript = await readFile(
			path.join(vscodeRoot, "scripts", "test-standalone-core-api-server.ts"),
			"utf8",
		)
		const standalonePackageScript = await readFile(path.join(vscodeRoot, "scripts", "package-standalone.mjs"), "utf8")
		const standaloneVerifierScript = await readFile(path.join(vscodeRoot, "scripts", "verify-standalone-package.mjs"), "utf8")
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
		assert.equal(standaloneServerScript.includes("validateStandaloneManifest"), true)
		assert.equal(standaloneServerScript.includes("manifest.uiContract?.selfContainedApp, false"), true)
		assert.equal(standaloneServerScript.includes("manifest.services?.hostBridge?.bundled, false"), true)
		assert.equal(standaloneVerifierScript.includes("standalone-manifest.json"), true)
		assert.equal(standaloneVerifierScript.includes("requiresExternalHostBridge"), true)
		assert.equal(standaloneVerifierScript.includes("manifest.uiContract?.webviewBuildPath"), true)
		assert.equal(cursorParityEvidenceScript.includes("Standalone package artifact build and manifest verification"), true)
		assert.equal(cursorParityEvidenceScript.includes('"compile-standalone"'), true)
		assert.equal(cursorParityEvidenceScript.includes("verify-standalone-package.mjs"), true)
		assert.equal(cursorParityEvidenceScript.includes("dist-standalone/standalone.zip"), true)
		assert.equal(cursorParityEvidenceScript.includes("npm exec --package"), false)
		assert.equal(cursorParityEvidenceScript.includes("const localTsxCli"), true)
		assert.equal(cursorParityEvidenceScript.includes('"tsx", "dist", "cli.mjs"'), true)
		assert.equal(standaloneReleaseAssetsScript.includes("createHash"), true)
		assert.equal(standaloneReleaseAssetsScript.includes("standaloneChecksumPath"), true)
		assert.equal(standaloneReleaseAssetsScript.includes(".sha256"), true)
		assert.equal(standaloneReleaseAssetsScript.includes("verify-standalone-package.mjs"), true)
	})
})
