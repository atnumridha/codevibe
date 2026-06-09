import { strict as assert } from "node:assert"
import { ClineDefaultTool } from "@shared/tools"
import { describe, it } from "mocha"
import type { ToolUse } from "../../assistant-message"
import { canonicalizeAttemptCompletionParams, shouldCloseBrowserBeforeTool } from "../ToolExecutor"

describe("ToolExecutor canonicalization", () => {
	it("canonicalizes attempt_completion response into result", () => {
		const block: ToolUse = {
			type: "tool_use",
			name: ClineDefaultTool.ATTEMPT,
			params: {
				response: "final answer from response field",
				task_progress: "- [x] done",
			},
			partial: false,
		}

		const didCanonicalize = canonicalizeAttemptCompletionParams(block)

		assert.equal(didCanonicalize, true)
		assert.equal(block.params.result, "final answer from response field")
		assert.equal(block.params.response, "final answer from response field")
	})

	it("does not canonicalize when attempt_completion already has result", () => {
		const block: ToolUse = {
			type: "tool_use",
			name: ClineDefaultTool.ATTEMPT,
			params: {
				result: "already canonical",
				response: "extra text",
			},
			partial: false,
		}

		const didCanonicalize = canonicalizeAttemptCompletionParams(block)

		assert.equal(didCanonicalize, false)
		assert.equal(block.params.result, "already canonical")
	})

	it("does not canonicalize non-attempt tools", () => {
		const block: ToolUse = {
			type: "tool_use",
			name: ClineDefaultTool.ACT_MODE,
			params: {
				response: "act mode response",
			},
			partial: false,
		}

		const didCanonicalize = canonicalizeAttemptCompletionParams(block)

		assert.equal(didCanonicalize, false)
		assert.equal(block.params.result, undefined)
	})
})

describe("ToolExecutor browser lifecycle", () => {
	it("keeps the browser open for browser session tools", () => {
		for (const toolName of [
			ClineDefaultTool.BROWSER,
			ClineDefaultTool.BROWSER_SNAPSHOT,
			ClineDefaultTool.BROWSER_SCREENSHOT,
		]) {
			assert.equal(shouldCloseBrowserBeforeTool(toolName), false, toolName)
		}
	})

	it("closes the browser before non-browser tools", () => {
		assert.equal(shouldCloseBrowserBeforeTool(ClineDefaultTool.BASH), true)
		assert.equal(shouldCloseBrowserBeforeTool(ClineDefaultTool.FILE_READ), true)
		assert.equal(shouldCloseBrowserBeforeTool(undefined), true)
	})
})
