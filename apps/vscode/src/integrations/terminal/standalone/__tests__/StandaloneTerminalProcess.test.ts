import assert from "node:assert/strict"
import { describe, it } from "mocha"
import {
	buildCodeVibeTerminalPolicyEnv,
	buildMacOsSandboxProfile,
	buildStandaloneTerminalSpawnPlan,
} from "../StandaloneTerminalProcess"
import { StandaloneTerminalManager } from "../StandaloneTerminalManager"

function makeSandboxPolicy(overrides: Record<string, unknown> = {}) {
	return {
		source: "cursor-sandbox",
		status: "loaded",
		configPath: "/workspace/.codie/sandbox.json",
		workspaceRoot: "/workspace",
		effectiveAccess: "workspace",
		readablePaths: ["/workspace"],
		writablePaths: ["/workspace"],
		networkPolicy: { default: "deny", allow: [] },
		disableTmpWrite: false,
		enableSharedBuildCache: false,
		blockGitWrites: false,
		allowReadAutoApprove: true,
		allowWriteAutoApprove: true,
		allowTerminalAutoApprove: true,
		allowNetworkAutoApprove: false,
		...overrides,
	} as any
}

describe("StandaloneTerminalProcess terminal policy env", () => {
	it("defaults to the regular terminal trust boundary", () => {
		assert.deepEqual(buildCodeVibeTerminalPolicyEnv(), {
			CODEVIBE_TERMINAL_RUN_MODE: "default",
			CODEVIBE_TERMINAL_SANDBOX: "0",
			CODEVIBE_TERMINAL_ELEVATED: "0",
			CODEVIBE_TERMINAL_BACKGROUND: "0",
			CODEVIBE_TERMINAL_SANDBOX_ENFORCEMENT: "none",
		})
	})

	it("marks sandboxed commands as background runs that require runtime enforcement", () => {
		assert.deepEqual(buildCodeVibeTerminalPolicyEnv({ terminalRunMode: "sandboxed" }), {
			CODEVIBE_TERMINAL_RUN_MODE: "sandboxed",
			CODEVIBE_TERMINAL_SANDBOX: "1",
			CODEVIBE_TERMINAL_ELEVATED: "0",
			CODEVIBE_TERMINAL_BACKGROUND: "1",
			CODEVIBE_TERMINAL_SANDBOX_ENFORCEMENT: "required",
		})
	})

	it("marks elevated commands as trusted foreground runs", () => {
		assert.deepEqual(buildCodeVibeTerminalPolicyEnv({ terminalRunMode: "elevated" }), {
			CODEVIBE_TERMINAL_RUN_MODE: "elevated",
			CODEVIBE_TERMINAL_SANDBOX: "0",
			CODEVIBE_TERMINAL_ELEVATED: "1",
			CODEVIBE_TERMINAL_BACKGROUND: "0",
			CODEVIBE_TERMINAL_SANDBOX_ENFORCEMENT: "none",
		})
	})

	it("preserves explicit background execution for default mode", () => {
		assert.equal(buildCodeVibeTerminalPolicyEnv({ useBackgroundExecution: true }).CODEVIBE_TERMINAL_BACKGROUND, "1")
	})
})

describe("StandaloneTerminalProcess sandbox runtime enforcement", () => {
	it("keeps default commands on the requested shell", () => {
		const plan = buildStandaloneTerminalSpawnPlan("/bin/zsh", ["-l", "-c", "pwd"], {
			terminalRunMode: "default",
		})

		assert.equal(plan.command, "/bin/zsh")
		assert.deepEqual(plan.args, ["-l", "-c", "pwd"])
		assert.equal(plan.sandboxEnforcement, "none")
	})

	it("wraps sandboxed macOS commands with sandbox-exec", () => {
		const plan = buildStandaloneTerminalSpawnPlan(
			"/bin/zsh",
			["-l", "-c", "touch ok"],
			{
				terminalRunMode: "sandboxed",
				cursorSandboxPolicy: makeSandboxPolicy(),
			},
			{
				platform: "darwin",
				sandboxExecPath: "/usr/bin/sandbox-exec",
				pathExists: () => true,
				tmpDir: "/private/tmp/codie-test",
			},
		)

		assert.equal(plan.command, "/usr/bin/sandbox-exec")
		assert.equal(plan.args[0], "-p")
		assert.match(plan.args[1], /\(deny default\)/)
		assert.match(plan.args[1], /\(allow file-write\*/)
		assert.match(plan.args[1], /\/workspace/)
		assert.deepEqual(plan.args.slice(2), ["/bin/zsh", "-l", "-c", "touch ok"])
		assert.equal(plan.sandboxEnforcement, "macos-sandbox-exec")
	})

	it("fails closed when sandboxed mode has no policy", () => {
		assert.throws(
			() =>
				buildStandaloneTerminalSpawnPlan(
					"/bin/zsh",
					["-l", "-c", "pwd"],
					{ terminalRunMode: "sandboxed" },
					{ platform: "darwin", pathExists: () => true },
				),
			/resolved sandbox policy/i,
		)
	})

	it("fails closed when sandbox-exec is unavailable", () => {
		assert.throws(
			() =>
				buildStandaloneTerminalSpawnPlan(
					"/bin/zsh",
					["-l", "-c", "pwd"],
					{ terminalRunMode: "sandboxed", cursorSandboxPolicy: makeSandboxPolicy() },
					{ platform: "darwin", pathExists: () => false },
				),
			/requires .*sandbox-exec/i,
		)
	})

	it("fails closed for host-specific network allow lists", () => {
		assert.throws(
			() =>
				buildMacOsSandboxProfile({
					cursorSandboxPolicy: makeSandboxPolicy({ networkPolicy: { default: "deny", allow: ["example.com"] } }),
				}),
			/host-specific network allow lists/i,
		)
	})
})

describe("StandaloneTerminalManager sandbox terminal lookup", () => {
	it("does not reuse a different-cwd terminal by running cd before sandboxed commands", async () => {
		const manager = new StandaloneTerminalManager()
		const first = await manager.getOrCreateTerminal("/workspace-a")
		const second = await manager.getOrCreateTerminal("/workspace-b", { terminalRunMode: "sandboxed" })

		assert.notEqual(second.id, first.id)
		assert.equal(first.lastCommand, "")
		assert.equal(second.lastCommand, "")

		manager.disposeAll()
	})
})
