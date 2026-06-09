import { strict as assert } from "node:assert"
import { readFile } from "node:fs/promises"
import path from "node:path"

const packagePath = path.join(__dirname, "..", "..", "package.json")

async function readPackageManifest(): Promise<Record<string, any>> {
	return JSON.parse(await readFile(packagePath, "utf8"))
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

		assert.equal(participant.id, "codevibe")
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

		assert.equal(chatAgent?.id, "codevibe")
		assert.equal(chatAgent?.path, "agents/00-codevibe-agent.agent.md")
		assert.equal(chatSession?.type, "agent-host-codevibe")
		assert.equal(chatSession?.customAgentTarget, "codevibe")
		assert.equal(chatSession?.order, -1000)
		assert.equal(legacyAliasSession?.type, "codevibe-agent")
		assert.equal(legacyAliasSession?.order, -999)
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
		for (const [menuId, items] of Object.entries(packageJSON.contributes.menus ?? {})) {
			for (const item of Array.isArray(items) ? items : []) {
				assert.equal(String((item as { command?: string }).command).startsWith("cline."), false, menuId)
			}
		}
	})
})
