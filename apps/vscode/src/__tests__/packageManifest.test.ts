import { strict as assert } from "node:assert"
import { readFile } from "node:fs/promises"
import path from "node:path"

const packagePath = path.join(__dirname, "..", "..", "package.json")

describe("Package manifest", () => {
	it("declares valid CodeVibe native agent contributions", async () => {
		const packageJSON = JSON.parse(await readFile(packagePath, "utf8"))
		const participant = packageJSON.contributes.chatParticipants?.[0]
		const activitybarContainers = packageJSON.contributes.viewsContainers?.activitybar ?? []
		const activitybarContainerIds = activitybarContainers.map((container: { id: string }) => container.id)
		const views = packageJSON.contributes.views ?? {}

		assert.equal(participant.id, "codevibe")
		assert.match(participant.id, /^[A-Za-z0-9_-]+$/)
		assert.deepEqual(activitybarContainerIds, ["codevibe-agent"])
		assert.ok(Object.hasOwn(views, "codevibe-agent"))
		assert.equal(Object.hasOwn(views, "codevibe.agent"), false)
	})
})
