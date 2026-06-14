import assert from "node:assert/strict"
import path from "path"
import { describe, it } from "mocha"
import type { CursorSandboxRuntimePolicy } from "@core/config/cursor-sandbox"
import { validateCursorSandboxTerminalPreflight } from "../CursorSandboxCommandPolicy"

const workspaceRoot = path.resolve("/workspace/project")
const readonlyRoot = path.resolve("/workspace/readonly")
const outsideRoot = path.resolve("/outside/project")

function makePolicy(overrides: Partial<CursorSandboxRuntimePolicy> = {}): CursorSandboxRuntimePolicy {
	return {
		source: "cursor-sandbox",
		status: "loaded",
		configPath: path.join(workspaceRoot, ".cursor", "sandbox.json"),
		workspaceRoot,
		effectiveAccess: "workspace",
		config: {
			type: "workspace_readwrite",
			additionalReadwritePaths: [],
			additionalReadonlyPaths: [],
			disableTmpWrite: false,
			enableSharedBuildCache: false,
			blockGitWrites: false,
			networkPolicy: { default: "allow", allow: [] },
			networkPolicyStrict: false,
		},
		readablePaths: [workspaceRoot],
		writablePaths: [workspaceRoot],
		networkPolicy: { default: "allow", allow: [] },
		disableTmpWrite: false,
		enableSharedBuildCache: false,
		blockGitWrites: false,
		allowReadAutoApprove: true,
		allowWriteAutoApprove: true,
		allowTerminalAutoApprove: true,
		allowNetworkAutoApprove: true,
		...overrides,
	}
}

describe("CursorSandboxCommandPolicy", () => {
	it("allows default terminal runs when no sandbox policy is active", () => {
		const result = validateCursorSandboxTerminalPreflight({
			command: `cat ${path.join(outsideRoot, "secret.txt")}`,
			executionDir: outsideRoot,
			terminalRunMode: "default",
		})

		assert.deepEqual(result, { ok: true })
	})

	it("blocks sandboxed terminal runs when no enforceable sandbox policy is active", () => {
		const result = validateCursorSandboxTerminalPreflight({
			command: "npm test",
			executionDir: workspaceRoot,
			terminalRunMode: "sandboxed",
		})

		assert.equal(result.ok, false)
		if (!result.ok) {
			assert.match(result.error, /no enforceable sandbox policy is active/)
			assert.match(result.error, /unelevated terminal mode/)
		}
	})

	it("blocks sandboxed execution from outside the sandbox roots", () => {
		const result = validateCursorSandboxTerminalPreflight({
			command: "npm test",
			executionDir: outsideRoot,
			policy: makePolicy(),
			terminalRunMode: "sandboxed",
		})

		assert.equal(result.ok, false)
		if (!result.ok) {
			assert.match(result.error, /execution directory/)
			assert.match(result.error, /outside sandbox write paths/)
		}
	})

	it("requires writable execution roots when a read-write sandbox has writable paths", () => {
		const result = validateCursorSandboxTerminalPreflight({
			command: "npm test",
			executionDir: readonlyRoot,
			policy: makePolicy({ readablePaths: [workspaceRoot, readonlyRoot], writablePaths: [workspaceRoot] }),
			terminalRunMode: "sandboxed",
		})

		assert.equal(result.ok, false)
		if (!result.ok) {
			assert.match(result.error, /outside sandbox write paths/)
		}
	})

	it("allows read-only sandbox execution from readable roots", () => {
		const result = validateCursorSandboxTerminalPreflight({
			command: "ls .",
			executionDir: workspaceRoot,
			policy: makePolicy({ effectiveAccess: "readOnly", writablePaths: [] }),
			terminalRunMode: "sandboxed",
		})

		assert.deepEqual(result, { ok: true })
	})

	it("blocks write-like commands when a sandbox has no writable roots", () => {
		const result = validateCursorSandboxTerminalPreflight({
			command: "touch out.txt",
			executionDir: workspaceRoot,
			policy: makePolicy({ effectiveAccess: "readOnly", writablePaths: [] }),
			terminalRunMode: "sandboxed",
		})

		assert.equal(result.ok, false)
		if (!result.ok) {
			assert.match(result.error, /read-only sandbox mode/)
		}
	})

	it("blocks path arguments outside sandbox read roots", () => {
		const result = validateCursorSandboxTerminalPreflight({
			command: `cat ${path.join(outsideRoot, "secret.txt")}`,
			executionDir: workspaceRoot,
			policy: makePolicy(),
			terminalRunMode: "sandboxed",
		})

		assert.equal(result.ok, false)
		if (!result.ok) {
			assert.match(result.error, /path argument/)
			assert.match(result.error, /outside sandbox read paths/)
		}
	})

	it("blocks redirect targets outside sandbox write roots", () => {
		const result = validateCursorSandboxTerminalPreflight({
			command: `echo ok > ${path.join(readonlyRoot, "out.txt")}`,
			executionDir: workspaceRoot,
			policy: makePolicy({ readablePaths: [workspaceRoot, readonlyRoot], writablePaths: [workspaceRoot] }),
			terminalRunMode: "sandboxed",
		})

		assert.equal(result.ok, false)
		if (!result.ok) {
			assert.match(result.error, /outside sandbox write paths/)
		}
	})

	it("blocks privileged wrappers until the user elevates the run", () => {
		const result = validateCursorSandboxTerminalPreflight({
			command: "sudo make install",
			executionDir: workspaceRoot,
			policy: makePolicy(),
			terminalRunMode: "sandboxed",
		})

		assert.equal(result.ok, false)
		if (!result.ok) {
			assert.match(result.error, /requires elevated terminal mode/)
		}
	})

	it("bypasses sandbox path checks for explicitly elevated runs", () => {
		const result = validateCursorSandboxTerminalPreflight({
			command: `sudo cat ${path.join(outsideRoot, "secret.txt")}`,
			executionDir: outsideRoot,
			policy: makePolicy(),
			terminalRunMode: "elevated",
		})

		assert.deepEqual(result, { ok: true })
	})

	it("blocks opaque inline shell evaluators in sandboxed runs", () => {
		const result = validateCursorSandboxTerminalPreflight({
			command: `bash -c "cat ${path.join(outsideRoot, "secret.txt")}"`,
			executionDir: workspaceRoot,
			policy: makePolicy(),
			terminalRunMode: "sandboxed",
		})

		assert.equal(result.ok, false)
		if (!result.ok) {
			assert.match(result.error, /inline code/)
			assert.match(result.error, /elevated terminal mode/)
		}
	})

	it("blocks combined opaque evaluator flags in sandboxed runs", () => {
		const commands = [
			`bash -lc "cat ${path.join(outsideRoot, "secret.txt")}"`,
			`zsh -fc "cat ${path.join(outsideRoot, "secret.txt")}"`,
			`node -pe "require('fs').readFileSync('${path.join(outsideRoot, "secret.txt")}', 'utf8')"`,
		]

		for (const command of commands) {
			const result = validateCursorSandboxTerminalPreflight({
				command,
				executionDir: workspaceRoot,
				policy: makePolicy(),
				terminalRunMode: "sandboxed",
			})

			assert.equal(result.ok, false, command)
			if (!result.ok) {
				assert.match(result.error, /inline code/)
				assert.match(result.error, /elevated terminal mode/)
			}
		}
	})

	it("allows opaque inline evaluators after explicit elevation", () => {
		const result = validateCursorSandboxTerminalPreflight({
			command: `bash -c "cat ${path.join(outsideRoot, "secret.txt")}"`,
			executionDir: outsideRoot,
			policy: makePolicy(),
			terminalRunMode: "elevated",
		})

		assert.deepEqual(result, { ok: true })
	})

	it("blocks network URLs that are outside .cursor/sandbox.json network allow entries", () => {
		const result = validateCursorSandboxTerminalPreflight({
			command: "curl https://example.com/data.json",
			executionDir: workspaceRoot,
			policy: makePolicy({ networkPolicy: { default: "deny", allow: ["api.openai.com"] } }),
			terminalRunMode: "sandboxed",
		})

		assert.equal(result.ok, false)
		if (!result.ok) {
			assert.match(result.error, /network access to example.com/)
		}
	})

	it("allows network URLs that match sandbox network allow entries", () => {
		const result = validateCursorSandboxTerminalPreflight({
			command: "curl https://api.openai.com/v1/models",
			executionDir: workspaceRoot,
			policy: makePolicy({ networkPolicy: { default: "deny", allow: ["api.openai.com"] } }),
			terminalRunMode: "sandboxed",
		})

		assert.deepEqual(result, { ok: true })
	})

	it("blocks network URLs that match sandbox deny entries even when default is allow", () => {
		const result = validateCursorSandboxTerminalPreflight({
			command: "curl https://blocked.example.com/data.json",
			executionDir: workspaceRoot,
			policy: makePolicy({ networkPolicy: { default: "allow", allow: [], deny: ["blocked.example.com"] } }),
			terminalRunMode: "sandboxed",
		})

		assert.equal(result.ok, false)
		if (!result.ok) {
			assert.match(result.error, /network access to blocked\.example\.com/)
		}
	})

	it("does not treat ordinary command words as filesystem paths", () => {
		const result = validateCursorSandboxTerminalPreflight({
			command: "npm run build -- --watch",
			executionDir: workspaceRoot,
			policy: makePolicy(),
			terminalRunMode: "sandboxed",
		})

		assert.deepEqual(result, { ok: true })
	})
})
