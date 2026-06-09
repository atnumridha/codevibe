import { describe, it } from "mocha"
import "should"
import { getCheckpointLockTarget } from "../CheckpointLockUtils"

describe("CheckpointLockUtils", () => {
	it("uses a path-free CodeVibe logical lock target", () => {
		getCheckpointLockTarget("cwd-hash").should.equal("codevibe:checkpoint:cwd-hash")
	})
})
