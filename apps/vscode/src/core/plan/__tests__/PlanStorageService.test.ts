import { strict as assert } from "node:assert"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, it } from "mocha"
import { disposePlanStorageServiceForTests, PlanStorageService } from "../PlanStorageService"

describe("PlanStorageService", () => {
	let tempDir: string | undefined
	let service: PlanStorageService | undefined

	afterEach(async () => {
		delete process.env.CODEVIBE_PLAN_HOME
		await service?.dispose()
		service = undefined
		await disposePlanStorageServiceForTests()
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true })
			tempDir = undefined
		}
	})

	async function createService() {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codevibe-plan-storage-"))
		process.env.CODEVIBE_PLAN_HOME = tempDir
		service = new PlanStorageService()
		await service.getPlanDir(tempDir)
		return service
	}

	it("stores local plans in Cursor-style plan home with registry metadata", async () => {
		const service = await createService()

		const plan = await service.createOrUpdatePlanForComposer({
			composerId: "task-123",
			response: "## Implementation Plan\n\nDo the work.",
			taskProgress: "- [ ] Inspect\n- [ ] Implement",
			workspacePath: tempDir,
		})

		assert.equal(plan.planId, "local-plan-task-123")
		assert.equal(path.dirname(plan.planPath), tempDir)
		assert.equal(plan.todoCount, 2)
		assert.equal(plan.metadata.todos[0].id.startsWith("todo-"), true)
		assert.equal(plan.metadata.todos[0].status, "pending")

		const serialized = await fs.readFile(plan.planPath, "utf8")
		assert.match(serialized, /^---\nname: Implementation Plan/m)
		assert.match(serialized, /todos:/)
		assert.match(serialized, /isProject: false/)

		const registry = await service.listPlans(tempDir)
		assert.equal(registry.length, 1)
		assert.equal(registry[0].id, "local-plan-task-123")
		assert.equal(registry[0].uri, plan.planPath)
		assert.deepEqual(registry[0].referencedBy, ["task-123"])
	})

	it("updates todo statuses through the shared plan file", async () => {
		const service = await createService()
		const plan = await service.createOrUpdatePlanForComposer({
			composerId: "task-456",
			response: "## Plan",
			taskProgress: "- [ ] Inspect\n- [ ] Implement",
			workspacePath: tempDir,
		})

		const updated = await service.updateTodoStatus({
			planId: plan.planId,
			todoIds: [plan.metadata.todos[0].id],
			status: "in_progress",
			workspacePath: tempDir,
		})

		assert.equal(updated.metadata.todos[0].status, "in_progress")
		assert.equal(updated.status, "in_progress")
		assert.equal(service.planToTaskProgress(updated), "- [ ] Inspect\n- [ ] Implement")
	})

	it("edits frontmatter todos from native plan editor actions", async () => {
		const service = await createService()
		const plan = await service.createOrUpdatePlanForComposer({
			composerId: "task-editor",
			response: "## Plan",
			taskProgress: "- [ ] Inspect files\n- [ ] Implement patch",
			workspacePath: tempDir,
		})

		const renamed = await service.updateTodoContent({
			planId: plan.planId,
			todoId: plan.metadata.todos[0].id,
			content: "Search and rank likely files",
			workspacePath: tempDir,
		})
		assert.equal(renamed.metadata.todos[0].content, "Search and rank likely files")

		const split = await service.splitTodo({
			planId: plan.planId,
			todoId: renamed.metadata.todos[1].id,
			beforeContent: "Implement",
			afterContent: "Verify",
			workspacePath: tempDir,
		})
		assert.equal(split.metadata.todos.length, 3)
		assert.equal(split.metadata.todos[1].content, "Implement")
		assert.equal(split.metadata.todos[2].content, "Verify")

		const merged = await service.mergeTodoBackward({
			planId: plan.planId,
			todoId: split.metadata.todos[2].id,
			workspacePath: tempDir,
		})
		assert.equal(merged.metadata.todos.length, 2)
		assert.equal(merged.metadata.todos[1].content, "Implement Verify")

		const removed = await service.removeTodoIds({
			planId: plan.planId,
			todoIds: [merged.metadata.todos[0].id],
			workspacePath: tempDir,
		})
		assert.equal(removed.metadata.todos.length, 1)
		assert.equal(removed.metadata.todos[0].content, "Implement Verify")
	})

	it("recovers legacy to-do sections when frontmatter is absent", async () => {
		const service = await createService()
		const legacyPath = path.join(tempDir!, "legacy.plan.md")
		await fs.writeFile(
			legacyPath,
			"# Legacy Plan\n\n### To-dos\n\n- [x] Existing\n- [ ] Remaining\n\n## Notes\nDone.",
			"utf8",
		)

		const plan = await service.readPlan({ planPath: legacyPath, workspacePath: tempDir })

		assert.equal(plan.metadata.todos.length, 2)
		assert.equal(plan.metadata.todos[0].content, "Existing")
		assert.equal(plan.metadata.todos[0].status, "completed")
		assert.equal(plan.metadata.todos[1].status, "pending")
	})

	it("sanitizes common unquoted colon values in frontmatter", async () => {
		const service = await createService()
		const malformedPath = path.join(tempDir!, "malformed.plan.md")
		await fs.writeFile(
			malformedPath,
			"---\nname: Fix: Plan\noverview: API: local only\ntodos:\n  - id: todo-a\n    content: Read: file\n    status: pending\n    dependencies: []\nisProject: false\n---\n\nBody",
			"utf8",
		)

		const plan = await service.readPlan({ planPath: malformedPath, workspacePath: tempDir })

		assert.equal(plan.metadata.name, "Fix: Plan")
		assert.equal(plan.metadata.overview, "API: local only")
		assert.equal(plan.metadata.todos[0].content, "Read: file")
	})
})
