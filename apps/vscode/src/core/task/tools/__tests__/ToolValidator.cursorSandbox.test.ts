import { strict as assert } from "node:assert"
import os from "node:os"
import path from "node:path"
import type { CursorSandboxRuntimePolicy } from "@core/config/cursor-sandbox"
import { describe, it } from "mocha"
import { ToolValidator } from "../ToolValidator"

function makePolicy(input: {
	readablePaths?: string[]
	writablePaths?: string[]
	networkPolicy?: CursorSandboxRuntimePolicy["networkPolicy"]
}): CursorSandboxRuntimePolicy {
	const workspaceRoot = path.join(os.tmpdir(), "cursor-sandbox-workspace")
	const readablePaths = input.readablePaths ?? [workspaceRoot]
	const writablePaths = input.writablePaths ?? [workspaceRoot]

	return {
		source: "cursor-sandbox",
		status: "loaded",
		configPath: path.join(workspaceRoot, ".cursor", "sandbox.json"),
		workspaceRoot,
		effectiveAccess: "workspace",
		readablePaths,
		writablePaths,
		networkPolicy: input.networkPolicy ?? { default: "deny", allow: [] },
		disableTmpWrite: false,
		enableSharedBuildCache: false,
		allowReadAutoApprove: true,
		allowWriteAutoApprove: writablePaths.length > 0,
		allowTerminalAutoApprove: false,
		allowNetworkAutoApprove: input.networkPolicy?.default === "allow",
	}
}

describe("ToolValidator Cursor sandbox", () => {
	const validator = new ToolValidator({ validateAccess: () => true } as any)
	const workspaceRoot = path.join(os.tmpdir(), "cursor-sandbox-workspace")
	const readonlyRoot = path.join(os.tmpdir(), "cursor-sandbox-readonly")
	const outsideRoot = path.join(os.tmpdir(), "cursor-sandbox-outside")

	it("allows paths when no Cursor sandbox policy is present", () => {
		const result = validator.checkCursorSandboxPath({
			absolutePath: path.join(outsideRoot, "file.ts"),
			accessKind: "read",
		})

		assert.deepEqual(result, { ok: true })
	})

	it("allows reads inside readablePaths and denies reads outside readablePaths", () => {
		const policy = makePolicy({ readablePaths: [workspaceRoot], writablePaths: [] })

		assert.deepEqual(
			validator.checkCursorSandboxPath({
				absolutePath: path.join(workspaceRoot, "src", "app.ts"),
				accessKind: "read",
				policy,
			}),
			{ ok: true },
		)

		const denied = validator.checkCursorSandboxPath({
			absolutePath: path.join(outsideRoot, "app.ts"),
			accessKind: "read",
			policy,
		})
		assert.equal(denied.ok, false)
	})

	it("denies writes when writablePaths is empty even if the path is readable", () => {
		const policy = makePolicy({ readablePaths: [workspaceRoot], writablePaths: [] })
		const denied = validator.checkCursorSandboxPath({
			absolutePath: path.join(workspaceRoot, "src", "app.ts"),
			accessKind: "write",
			policy,
		})

		assert.equal(denied.ok, false)
	})

	it("allows writes inside writablePaths and denies readonly-only paths", () => {
		const policy = makePolicy({ readablePaths: [workspaceRoot, readonlyRoot], writablePaths: [workspaceRoot] })

		assert.deepEqual(
			validator.checkCursorSandboxPath({
				absolutePath: path.join(workspaceRoot, "src", "app.ts"),
				accessKind: "write",
				policy,
			}),
			{ ok: true },
		)

		const denied = validator.checkCursorSandboxPath({
			absolutePath: path.join(readonlyRoot, "notes.md"),
			accessKind: "write",
			policy,
		})
		assert.equal(denied.ok, false)
	})

	it("enforces network deny with host and wildcard allow entries", () => {
		const policy = makePolicy({
			networkPolicy: { default: "deny", allow: ["api.github.com", "*.example.com"] },
		})

		assert.deepEqual(validator.checkCursorSandboxUrl("https://api.github.com/repos", policy), { ok: true })
		assert.deepEqual(validator.checkCursorSandboxUrl("https://docs.example.com/path", policy), { ok: true })

		const denied = validator.checkCursorSandboxUrl("https://example.net", policy)
		assert.equal(denied.ok, false)
	})

	it("requires constrained allowed_domains for web search when network default is deny", () => {
		const policy = makePolicy({
			networkPolicy: { default: "deny", allow: ["github.com", "*.example.com"] },
		})

		assert.equal(validator.checkCursorSandboxWebSearchDomains([], policy).ok, false)
		assert.deepEqual(validator.checkCursorSandboxWebSearchDomains(["github.com"], policy), { ok: true })
		assert.deepEqual(validator.checkCursorSandboxWebSearchDomains(["docs.example.com"], policy), { ok: true })
		assert.equal(validator.checkCursorSandboxWebSearchDomains(["example.net"], policy).ok, false)
	})
})
