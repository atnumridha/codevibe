import assert from "node:assert/strict"
import { describe, it } from "mocha"
import { buildCodeVibeTerminalPolicyEnv } from "../StandaloneTerminalProcess"

describe("StandaloneTerminalProcess terminal policy env", () => {
	it("defaults to the regular terminal trust boundary", () => {
		assert.deepEqual(buildCodeVibeTerminalPolicyEnv(), {
			CODEVIBE_TERMINAL_RUN_MODE: "default",
			CODEVIBE_TERMINAL_SANDBOX: "0",
			CODEVIBE_TERMINAL_ELEVATED: "0",
			CODEVIBE_TERMINAL_BACKGROUND: "0",
		})
	})

	it("marks sandboxed commands as background sandbox runs", () => {
		assert.deepEqual(buildCodeVibeTerminalPolicyEnv({ terminalRunMode: "sandboxed" }), {
			CODEVIBE_TERMINAL_RUN_MODE: "sandboxed",
			CODEVIBE_TERMINAL_SANDBOX: "1",
			CODEVIBE_TERMINAL_ELEVATED: "0",
			CODEVIBE_TERMINAL_BACKGROUND: "1",
		})
	})

	it("marks elevated commands as trusted foreground runs", () => {
		assert.deepEqual(buildCodeVibeTerminalPolicyEnv({ terminalRunMode: "elevated" }), {
			CODEVIBE_TERMINAL_RUN_MODE: "elevated",
			CODEVIBE_TERMINAL_SANDBOX: "0",
			CODEVIBE_TERMINAL_ELEVATED: "1",
			CODEVIBE_TERMINAL_BACKGROUND: "0",
		})
	})

	it("preserves explicit background execution for default mode", () => {
		assert.equal(buildCodeVibeTerminalPolicyEnv({ useBackgroundExecution: true }).CODEVIBE_TERMINAL_BACKGROUND, "1")
	})
})
