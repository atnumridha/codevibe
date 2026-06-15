import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import {
	buildLocalPlanExecutionMessage,
	cyclePlanTodoStatus,
	derivePlanStatus,
	extractMarkdownTodos,
	markdownTodosToPlanTodos,
	planMetadataToTaskProgress,
	resetMarkdownTodosToPending,
} from "../plan-build"

describe("plan-build", () => {
	it("builds a local-only execution handoff with accepted plan context", () => {
		const message = buildLocalPlanExecutionMessage({
			planText: "## Plan\n\n- [ ] Inspect\n- [ ] Implement",
			planPath: "/tmp/task/local-plan.plan.md",
			taskProgress: "- [ ] Inspect\n- [ ] Implement",
		})

		assert.match(message, /Build this plan locally in Act mode\./)
		assert.match(message, /"type": "ExecutePlanAction"/)
		assert.match(message, /"isPlanExecution": true/)
		assert.match(message, /"unifiedMode": "agent"/)
		assert.match(message, /"planUri": "\/tmp\/task\/local-plan\.plan\.md"/)
		assert.match(message, /local agent build only/)
		assert.match(message, /Do not start or transfer to a cloud\/background build/)
		assert.match(message, /Do not edit the plan file/)
		assert.match(message, /do not recreate duplicate todos/)
		assert.match(message, /<accepted_todos>\n- \[ \] Inspect\n- \[ \] Implement\n<\/accepted_todos>/)
		assert.match(message, /<accepted_plan>\n## Plan/)
		assert.match(message, /Plan file reference: \/tmp\/task\/local-plan\.plan\.md/)
	})

	it("extracts markdown checklist todos and resets them to pending", () => {
		const source = "- [x] Done\n- [X] Also done\n- [ ] Remaining\nplain text"

		assert.deepEqual(extractMarkdownTodos(source), ["- [x] Done", "- [X] Also done", "- [ ] Remaining"])
		assert.equal(resetMarkdownTodosToPending(source), "- [ ] Done\n- [ ] Also done\n- [ ] Remaining")
	})

	it("cycles todo statuses in Cursor order", () => {
		assert.equal(cyclePlanTodoStatus("pending"), "in_progress")
		assert.equal(cyclePlanTodoStatus("in_progress"), "completed")
		assert.equal(cyclePlanTodoStatus("completed"), "cancelled")
		assert.equal(cyclePlanTodoStatus("cancelled"), "pending")
	})

	it("serializes plan metadata back to task_progress", () => {
		const todos = markdownTodosToPlanTodos("- [ ] Inspect\n- [x] Implement")
		const metadata = {
			name: "Plan",
			overview: "",
			todos,
			isProject: false,
		}

		assert.equal(derivePlanStatus(metadata), "in_progress")
		assert.equal(planMetadataToTaskProgress(metadata), "- [ ] Inspect\n- [x] Implement")
	})

	it("builds a local parallel execution handoff without cloud/background routing", () => {
		const message = buildLocalPlanExecutionMessage({
			planText: "## Plan",
			taskProgress: "- [ ] A\n- [ ] B",
			mode: "multitask",
			selectedTodoIds: ["todo-a", "todo-b"],
			skipSubmission: true,
		})

		assert.match(message, /parallel subagents/)
		assert.match(message, /"unifiedMode": "multitask"/)
		assert.match(message, /"skipSubmission": true/)
		assert.match(message, /local parallel build/)
		assert.match(message, /Do not start or transfer to a cloud\/background build/)
		assert.match(message, /<selected_todo_ids>\ntodo-a\ntodo-b\n<\/selected_todo_ids>/)
	})
})
