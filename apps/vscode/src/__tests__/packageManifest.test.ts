import { strict as assert } from "node:assert"
import { readFile } from "node:fs/promises"
import path from "node:path"
import {
	CODEVIBE_CHAT_PARTICIPANT_ID,
	CODEVIBE_CHAT_SESSION_TYPE,
	CODEVIBE_LEGACY_CHAT_SESSION_TYPE,
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
		const nativeAgentView = codeVibeAgentViews.find((view: { id?: string }) => view.id === "codevibe.agent.chat")

		assert.equal(participant.id, CODEVIBE_CHAT_PARTICIPANT_ID)
		assert.match(participant.id, /^[A-Za-z0-9_-]+$/)
		assert.deepEqual(activitybarContainerIds, ["codevibe-agent"])
		assert.ok(Object.hasOwn(views, "codevibe-agent"))
		assert.equal(Object.hasOwn(views, "codevibe.agent"), false)
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
		const [chatSession, legacyAliasSession] = packageJSON.contributes.chatSessions ?? []
		const [newSessionMenu] = packageJSON.contributes.menus?.["chatSessions/newSession"] ?? []

		assert.equal(chatAgent?.id, CODEVIBE_CHAT_PARTICIPANT_ID)
		assert.equal(chatAgent?.path, `agents/${CODEVIBE_NATIVE_AGENT_FILE_NAME}`)
		assert.equal(chatSession?.id, CODEVIBE_CHAT_SESSION_TYPE)
		assert.equal(chatSession?.type, CODEVIBE_CHAT_SESSION_TYPE)
		assert.equal(chatSession?.customAgentTarget, CODEVIBE_CHAT_PARTICIPANT_ID)
		assert.equal(chatSession?.order, -1000)
		assert.match(chatSession?.id, /^[A-Za-z0-9_-]+$/)
		assert.equal(legacyAliasSession?.id, CODEVIBE_LEGACY_CHAT_SESSION_TYPE)
		assert.equal(legacyAliasSession?.type, CODEVIBE_LEGACY_CHAT_SESSION_TYPE)
		assert.equal(legacyAliasSession?.order, -999)
		assert.match(legacyAliasSession?.id, /^[A-Za-z0-9_-]+$/)
		assert.equal(newSessionMenu?.command, "codevibe.newNativeAgentSession")
		assert.equal(newSessionMenu?.group, "navigation@-1000")
		assert.equal(newSessionMenu?.when, undefined)
	})

	it("keeps visible contribution strings on CodeVibe branding", async () => {
		const packageJSON = await readPackageManifest()
		const serializedContributions = JSON.stringify(packageJSON.contributes)

		assert.equal(/\bCline\b/.test(serializedContributions), false)
		assert.equal(serializedContributions.includes("claude-dev.SidebarProvider"), false)
		for (const command of packageJSON.contributes.commands ?? []) {
			assert.equal(String(command.command).startsWith("cline."), false)
		}
		const commandIds = new Set((packageJSON.contributes.commands ?? []).map((command: { command?: string }) => command.command))
		assert.equal(commandIds.has("codevibe.fixWithCodeVibe"), true)
		assert.equal(packageJSON.activationEvents.includes("onCommand:codevibe.fixWithCodeVibe"), true)
		for (const [menuId, items] of Object.entries(packageJSON.contributes.menus ?? {})) {
			for (const item of Array.isArray(items) ? items : []) {
				assert.equal(String((item as { command?: string }).command).startsWith("cline."), false, menuId)
			}
		}
	})

	it("cleans stale invalid CodeVibe view containers during VSIX install", async () => {
		const packageScript = await readFile(path.join(__dirname, "..", "..", "scripts", "package-github-vsix.mjs"), "utf8")

		assert.equal(packageScript.includes("workbench.view.extension.codevibe.agent"), true)
		assert.equal(packageScript.includes("'workbench.view.extension.codevibe.agent.state'"), true)
		assert.equal(packageScript.includes("'workbench.view.extension.codevibe.agent.state.hidden'"), true)
		assert.equal(packageScript.includes("'workbench.view.extension.codevibe.agent.numberOfVisibleViews'"), true)
	})

	it("brands the standalone runtime entrypoint as CodeVibe core", async () => {
		const runtimePackage = await readJsonFile(path.join(vscodeRoot, "standalone", "runtime-files", "package.json"))
		const runtimePackageLock = await readJsonFile(path.join(vscodeRoot, "standalone", "runtime-files", "package-lock.json"))
		const esbuildScript = await readFile(path.join(vscodeRoot, "esbuild.mjs"), "utf8")
		const standaloneServerScript = await readFile(path.join(vscodeRoot, "scripts", "test-standalone-core-api-server.ts"), "utf8")

		assert.equal(runtimePackage.name, "codevibe-core")
		assert.equal(runtimePackage.main, "codevibe-core.js")
		assert.equal(runtimePackageLock.name, "codevibe-core")
		assert.equal(runtimePackageLock.packages?.[""]?.name, "codevibe-core")
		assert.equal(esbuildScript.includes('entryPoints: ["src/standalone/codevibe-core.ts"]'), true)
		assert.equal(esbuildScript.includes("codevibe-core.js"), true)
		assert.equal(esbuildScript.includes("src/standalone/cline-core.ts"), false)
		assert.equal(standaloneServerScript.includes("CODEVIBE_CORE_FILE"), true)
		assert.equal(standaloneServerScript.includes('"codevibe-core.js"'), true)
	})
})
