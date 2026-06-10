import assert from "node:assert/strict"
import { describe, it } from "mocha"
import {
	appendTerminalRunModeMarker,
	decodeTerminalRunMode,
	encodeTerminalRunMode,
	extractTerminalRunModeMarker,
} from "@shared/terminalPolicy"
import {
	getDefaultTerminalRunMode,
	isLikelyLongRunningCommand,
	resolveCommandTimeoutSeconds,
} from "../ExecuteCommandToolHandler"

describe("ExecuteCommandToolHandler timeout policy", () => {
	it("returns undefined when managed timeout is disabled", () => {
		const timeout = resolveCommandTimeoutSeconds("npm test", undefined, false)
		assert.equal(timeout, undefined)
	})

	it("uses explicit timeout when provided", () => {
		const timeout = resolveCommandTimeoutSeconds("npm test", "45", true)
		assert.equal(timeout, 45)
	})

	it("falls back to default timeout for short commands", () => {
		const timeout = resolveCommandTimeoutSeconds("ls -la", undefined, true)
		assert.equal(timeout, 30)
	})

	it("uses extended timeout for known long-running commands", () => {
		const timeout = resolveCommandTimeoutSeconds("npm run build", undefined, true)
		assert.equal(timeout, 300)
	})

	it("detects common long-running command families", () => {
		assert.equal(isLikelyLongRunningCommand("cargo build --release"), true)
		assert.equal(isLikelyLongRunningCommand("docker build ."), true)
		assert.equal(isLikelyLongRunningCommand("pytest -q"), true)
	})

	it("defaults manual command approvals to sandboxed when a sandbox policy exists", () => {
		assert.equal(getDefaultTerminalRunMode(true), "sandboxed")
		assert.equal(getDefaultTerminalRunMode(false), "default")
	})

	it("round-trips hidden terminal run mode markers", () => {
		assert.equal(decodeTerminalRunMode(encodeTerminalRunMode("sandboxed")), "sandboxed")
		assert.equal(decodeTerminalRunMode(encodeTerminalRunMode("elevated")), "elevated")
		assert.equal(decodeTerminalRunMode("__codevibe_terminal_policy__:unknown"), undefined)
		assert.equal(decodeTerminalRunMode("normal user feedback"), undefined)
	})

	it("extracts persisted run-mode markers from command text", () => {
		const marked = appendTerminalRunModeMarker("npm test  ", "sandboxed")
		const parsed = extractTerminalRunModeMarker(marked)

		assert.equal(parsed.command, "npm test")
		assert.equal(parsed.terminalRunMode, "sandboxed")
	})
})
