import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import {
	buildLocalPlanExecutionMessage,
	extractMarkdownTodos,
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
})
