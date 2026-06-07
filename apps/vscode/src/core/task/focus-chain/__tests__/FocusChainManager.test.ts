import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import sinon from "sinon"
import { TaskState } from "../../TaskState"
import { FocusChainManager } from "../index"

describe("FocusChainManager", () => {
	it("ignores duplicate task_progress updates", async () => {
		const taskProgress = "- [ ] Inspect\n- [x] Plan"
		const taskState = new TaskState()
		taskState.currentFocusChainChecklist = taskProgress
		const say = sinon.stub().resolves(undefined)
		const manager = new FocusChainManager({
			taskId: "task-1",
			taskState,
			mode: "plan",
			stateManager: {} as any,
			postStateToWebview: sinon.stub().resolves(),
			say,
			focusChainSettings: { enabled: true, remindClineInterval: 6 },
		})
		const writeStub = sinon.stub(manager as any, "writeFocusChainToDisk").resolves()

		await manager.updateFCListFromToolResponse(`\n${taskProgress}\n`)

		sinon.assert.notCalled(writeStub)
		sinon.assert.notCalled(say)
		assert.equal(taskState.apiRequestsSinceLastTodoUpdate, 0)
	})
})
