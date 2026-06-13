import assert from "node:assert/strict"
import {
	appendTerminalRequestMarker,
	appendTerminalRunModeMarker,
	decodeTerminalApprovalPayload,
	decodeTerminalRequestPayload,
	decodeTerminalRunMode,
	encodeTerminalApprovalPayload,
	encodeTerminalRequestPayload,
	encodeTerminalRunMode,
	extractTerminalRunModeMarker,
} from "@shared/terminalPolicy"
import { ClineDefaultTool } from "@shared/tools"
import { describe, it } from "mocha"
import sinon from "sinon"
import {
	ExecuteCommandToolHandler,
	getDefaultTerminalRunMode,
	isLikelyLongRunningCommand,
	resolveCommandTimeoutSeconds,
	resolveInlineTerminalRequest,
} from "../ExecuteCommandToolHandler"

function expectInlineTerminalRequest(
	result: ReturnType<typeof resolveInlineTerminalRequest>,
	expected: {
		requestedTerminalRunMode?: "sandboxed" | "elevated" | "default"
		prefixRule?: string[]
		requiresManualApproval: boolean
	},
): void {
	if (!result.ok) {
		assert.fail(result.error)
	}
	assert.deepEqual(result.request, expected)
}

function expectInlineTerminalRequestError(result: ReturnType<typeof resolveInlineTerminalRequest>, errorPattern: RegExp): void {
	if (result.ok) {
		assert.fail(`Expected inline terminal request error, got ${JSON.stringify(result.request)}`)
	}
	assert.match(result.error, errorPattern)
}

function createSubagentExecuteConfig() {
	const executeCommandTool = sinon.stub().resolves([false, "ok"])
	return {
		config: {
			taskState: { consecutiveMistakeCount: 0 },
			cwd: "/workspace",
			isSubagentExecution: true,
			cursorSandboxPolicy: { status: "loaded" },
			yoloModeToggled: true,
			vscodeTerminalExecutionMode: "backgroundExec",
			api: {
				getModel: () => ({ id: "test-model", info: {} }),
			},
			autoApprovalSettings: { enableNotifications: false },
			services: {
				stateManager: {
					getApiConfiguration: () => ({
						planModeApiProvider: "openai",
						actModeApiProvider: "openai",
					}),
					getGlobalSettingsKey: () => "act",
				},
			},
			callbacks: {
				executeCommandTool,
				say: sinon.stub().resolves(undefined),
				sayAndCreateMissingParamError: sinon.stub().resolves("missing"),
			},
		} as any,
		executeCommandTool,
	}
}

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

	it("round-trips explicit terminal approval payloads and accepts legacy markers", () => {
		assert.equal(decodeTerminalApprovalPayload(encodeTerminalApprovalPayload("sandboxed")), "sandboxed")
		assert.equal(decodeTerminalApprovalPayload(encodeTerminalApprovalPayload("default")), "default")
		assert.equal(decodeTerminalApprovalPayload(encodeTerminalRunMode("elevated")), "elevated")
		assert.equal(
			decodeTerminalApprovalPayload('{"kind":"codevibe.terminalApproval","version":1,"terminalRunMode":"root"}'),
			undefined,
		)
		assert.equal(decodeTerminalApprovalPayload("normal user feedback"), undefined)
	})

	it("round-trips inline terminal request payloads", () => {
		const request = {
			requestedTerminalRunMode: "sandboxed" as const,
			prefixRule: ["npm", "run", "dev"],
		}

		assert.deepEqual(decodeTerminalRequestPayload(encodeTerminalRequestPayload(request)), request)
		assert.equal(decodeTerminalRequestPayload("normal user feedback"), undefined)
	})

	it("extracts persisted run-mode markers from command text", () => {
		const marked = appendTerminalRunModeMarker("npm test  ", "sandboxed")
		const parsed = extractTerminalRunModeMarker(marked)

		assert.equal(parsed.command, "npm test")
		assert.equal(parsed.terminalRunMode, "sandboxed")
	})

	it("extracts inline terminal request markers from command text", () => {
		const marked = appendTerminalRunModeMarker(
			appendTerminalRequestMarker("npm run dev  ", {
				requestedTerminalRunMode: "sandboxed",
				prefixRule: ["npm", "run", "dev"],
			}),
			"sandboxed",
		)
		const parsed = extractTerminalRunModeMarker(marked)

		assert.equal(parsed.command, "npm run dev")
		assert.equal(parsed.terminalRunMode, "sandboxed")
		assert.equal(parsed.requestedTerminalRunMode, "sandboxed")
		assert.deepEqual(parsed.prefixRule, ["npm", "run", "dev"])
	})

	it("maps inline sandbox permission requests to terminal run modes", () => {
		const cases: Array<{
			name: string
			options: Parameters<typeof resolveInlineTerminalRequest>[1]
			expected: Parameters<typeof expectInlineTerminalRequest>[1]
		}> = [
			{
				name: "sandboxed",
				options: { sandboxPermissionsRaw: "sandboxed" },
				expected: { requestedTerminalRunMode: "sandboxed", requiresManualApproval: false },
			},
			{
				name: "unelevated",
				options: { sandboxPermissionsRaw: "unelevated" },
				expected: { requestedTerminalRunMode: "default", requiresManualApproval: false },
			},
			{
				name: "default",
				options: { sandboxPermissionsRaw: "default" },
				expected: { requiresManualApproval: false },
			},
			{
				name: "use_default",
				options: { sandboxPermissionsRaw: "use_default" },
				expected: { requiresManualApproval: false },
			},
			{
				name: "require_escalated",
				options: { sandboxPermissionsRaw: "require_escalated" },
				expected: { requestedTerminalRunMode: "elevated", requiresManualApproval: true },
			},
			{
				name: "boolean require_escalated",
				options: { requireEscalatedRaw: "true" },
				expected: { requestedTerminalRunMode: "elevated", requiresManualApproval: true },
			},
		]

		for (const testCase of cases) {
			expectInlineTerminalRequest(resolveInlineTerminalRequest("npm run dev", testCase.options), testCase.expected)
		}
	})

	it("keeps matching inline prefix rules in the terminal request", () => {
		expectInlineTerminalRequest(
			resolveInlineTerminalRequest("npm run dev -- --host", {
				sandboxPermissionsRaw: "sandboxed",
				prefixRuleRaw: '["npm","run","dev"]',
			}),
			{
				requestedTerminalRunMode: "sandboxed",
				prefixRule: ["npm", "run", "dev"],
				requiresManualApproval: false,
			},
		)
	})

	it("rejects invalid inline sandbox permission values", () => {
		expectInlineTerminalRequestError(
			resolveInlineTerminalRequest("npm test", { sandboxPermissionsRaw: "root" }),
			/sandbox_permissions/,
		)
	})

	it("rejects invalid inline prefix rule JSON", () => {
		expectInlineTerminalRequestError(resolveInlineTerminalRequest("npm test", { prefixRuleRaw: '["npm",' }), /prefix_rule/)
	})

	it("rejects inline prefix rules that do not match the command", () => {
		expectInlineTerminalRequestError(
			resolveInlineTerminalRequest("npm test", { prefixRuleRaw: '["pnpm","test"]' }),
			/does not match/,
		)
	})

	it("rejects subagent unelevated terminal requests when sandbox policy is active", async () => {
		const { config, executeCommandTool } = createSubagentExecuteConfig()
		const handler = new ExecuteCommandToolHandler({} as any)
		const result = await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.BASH,
			params: {
				command: "npm test",
				requires_approval: "false",
				sandbox_permissions: "unelevated",
			},
			partial: false,
		})

		assert.match(String(result), /subagents must run sandboxed/i)
		assert.match(String(result), /unelevated terminal mode/i)
		assert.equal(executeCommandTool.called, false)
	})
})
