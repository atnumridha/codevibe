import { describe, it } from "mocha"
import "should"
import { getTaskLockTarget } from "../TaskLockUtils"

describe("TaskLockUtils", () => {
	it("uses a path-free CodeVibe logical lock target", () => {
		getTaskLockTarget("task-123").should.equal("codevibe:task:task-123")
	})
})
