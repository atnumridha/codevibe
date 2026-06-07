import { strict as assert } from "node:assert"
import os from "node:os"
import path from "node:path"
import type { CursorSandboxRuntimePolicy } from "@core/config/cursor-sandbox"
import { describe, it } from "mocha"
import { ToolValidator } from "../../ToolValidator"
import type { TaskConfig } from "../../types/TaskConfig"
import { PathResolver } from "../PathResolver"

function makePolicy(
	workspaceRoot: string,
	readablePaths: string[],
	writablePaths: string[],
): CursorSandboxRuntimePolicy {
	return {
		source: "cursor-sandbox",
		status: "loaded",
		configPath: path.join(workspaceRoot, ".cursor", "sandbox.json"),
		workspaceRoot,
		effectiveAccess: "workspace",
			readablePaths,
			writablePaths,
			networkPolicy: { default: "allow", allow: [] },
			blockGitWrites: false,
			disableTmpWrite: false,
			enableSharedBuildCache: false,
		allowReadAutoApprove: true,
		allowWriteAutoApprove: writablePaths.length > 0,
		allowTerminalAutoApprove: false,
		allowNetworkAutoApprove: true,
	}
}

function makeResolver(config: Pick<TaskConfig, "cwd" | "cursorSandboxPolicy">): PathResolver {
	return new PathResolver(config as TaskConfig, new ToolValidator({ validateAccess: () => true } as any))
}

describe("PathResolver Cursor sandbox", () => {
	const workspaceRoot = path.join(os.tmpdir(), "cursor-path-resolver-workspace")
	const writableRoot = path.join(workspaceRoot, "writable")
	const outsideRoot = path.join(os.tmpdir(), "cursor-path-resolver-outside")

	it("validates the resolved absolute path, not the raw relative path", async () => {
		const resolver = makeResolver({
			cwd: workspaceRoot,
			cursorSandboxPolicy: makePolicy(workspaceRoot, [workspaceRoot], [workspaceRoot]),
		})

		const result = await resolver.resolveAndValidate("src/app.ts", "PathResolver.cursorSandbox.test")

		assert.deepEqual(result, {
			absolutePath: path.join(workspaceRoot, "src", "app.ts"),
			resolvedPath: "src/app.ts",
		})
	})

	it("denies traversal outside readablePaths", async () => {
		const resolver = makeResolver({
			cwd: workspaceRoot,
			cursorSandboxPolicy: makePolicy(workspaceRoot, [workspaceRoot], [workspaceRoot]),
		})
		const relativeOutsidePath = path.relative(workspaceRoot, path.join(outsideRoot, "secret.txt"))

		const result = await resolver.resolveAndValidate(relativeOutsidePath, "PathResolver.cursorSandbox.test")

		assert.equal(result, undefined)
	})

	it("uses write access kind to require writablePaths", async () => {
		const resolver = makeResolver({
			cwd: workspaceRoot,
			cursorSandboxPolicy: makePolicy(workspaceRoot, [workspaceRoot], [writableRoot]),
		})

		const denied = await resolver.resolveAndValidate("readonly/notes.md", "PathResolver.cursorSandbox.test", "write")
		const allowed = await resolver.resolveAndValidate("writable/notes.md", "PathResolver.cursorSandbox.test", "write")

		assert.equal(denied, undefined)
		assert.deepEqual(allowed, {
			absolutePath: path.join(writableRoot, "notes.md"),
			resolvedPath: "writable/notes.md",
		})
	})
})
