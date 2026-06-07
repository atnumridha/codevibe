import { strict as assert } from "node:assert"
import { DiffError, PatchActionType, type Patch } from "@/shared/Patch"
import { describe, it } from "mocha"
import sinon from "sinon"
import { ApplyPatchHandler } from "../ApplyPatchHandler"

function makeHandler(resolveAndValidate: sinon.SinonStub): ApplyPatchHandler {
	const handler = new ApplyPatchHandler({} as any)
	;(handler as any).pathResolver = { resolveAndValidate }
	return handler
}

describe("ApplyPatchHandler", () => {
	it("throws when a parsed patch action path fails validation", async () => {
		const resolveAndValidate = sinon.stub().resolves(undefined)
		const handler = makeHandler(resolveAndValidate)
		const patch: Patch = {
			actions: {
				"../outside.ts": {
					type: PatchActionType.ADD,
					newFile: "export const value = 1\n",
					chunks: [],
				},
			},
		}

		await assert.rejects(
			() => (handler as any).patchToCommit(patch, {}),
			(error: Error) =>
				error instanceof DiffError &&
				error.message === "Invalid or disallowed patch path: ../outside.ts",
		)
		sinon.assert.calledOnceWithExactly(
			resolveAndValidate,
			"../outside.ts",
			"ApplyPatchHandler.patchToCommit",
			"write",
		)
	})

	it("throws when a parsed patch move target fails validation", async () => {
		const resolveAndValidate = sinon.stub()
		resolveAndValidate
			.withArgs("src/input.ts", "ApplyPatchHandler.patchToCommit", "write")
			.resolves({ absolutePath: "/workspace/src/input.ts", resolvedPath: "src/input.ts" })
		resolveAndValidate
			.withArgs("../outside.ts", "ApplyPatchHandler.patchToCommit.move", "write")
			.resolves(undefined)
		const handler = makeHandler(resolveAndValidate)
		const patch: Patch = {
			actions: {
				"src/input.ts": {
					type: PatchActionType.UPDATE,
					movePath: "../outside.ts",
					chunks: [],
				},
			},
		}

		await assert.rejects(
			() => (handler as any).patchToCommit(patch, { "src/input.ts": "old\n" }),
			(error: Error) =>
				error instanceof DiffError &&
				error.message === "Invalid or disallowed patch path: ../outside.ts",
		)
		sinon.assert.calledTwice(resolveAndValidate)
	})
})
