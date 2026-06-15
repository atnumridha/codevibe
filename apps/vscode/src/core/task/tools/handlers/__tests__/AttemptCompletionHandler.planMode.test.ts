import { strict as assert } from "node:assert"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { disposePlanStorageServiceForTests, registerPlanOpenHandler } from "@core/plan/PlanStorageService"
import * as NotificationHook from "@core/hooks/notification-hook"
import { telemetryService } from "@services/telemetry"
import { ClineDefaultTool } from "@shared/tools"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { TaskState } from "../../../TaskState"
import type { TaskConfig } from "../../types/TaskConfig"
import { AttemptCompletionHandler } from "../AttemptCompletionHandler"

function createPlanModeConfig(cwd: string) {
	const taskState = new TaskState()
	const messages: any[] = []
	let nextTs = 1
	const callbacks = {
		say: sinon.stub().callsFake(async (say: string, text?: string, images?: string[], files?: string[], partial?: boolean) => {
			const ts = nextTs++
			messages.push({ ts, type: "say", say, text, images, files, partial })
			return ts
		}),
		ask: sinon.stub().resolves({ response: "yesButtonClicked", text: "", images: [], files: [] }),
		saveCheckpoint: sinon.stub().resolves(),
		sayAndCreateMissingParamError: sinon.stub().resolves("missing"),
		removeLastPartialMessageIfExistsWithType: sinon.stub().resolves(),
		executeCommandTool: sinon.stub().resolves([false, "ok"]),
		cancelRunningCommandTool: sinon.stub().resolves(false),
		doesLatestTaskCompletionHaveNewChanges: sinon.stub().resolves(false),
		updateFCListFromToolResponse: sinon.stub().resolves(),
		shouldAutoApproveTool: sinon.stub().returns([false, false]),
		shouldAutoApproveToolWithPath: sinon.stub().resolves(false),
		postStateToWebview: sinon.stub().resolves(),
		reinitExistingTaskFromId: sinon.stub().resolves(),
		cancelTask: sinon.stub().resolves(),
		updateTaskHistory: sinon.stub().resolves([]),
		applyLatestBrowserSettings: sinon.stub().resolves(undefined),
		switchToActMode: sinon.stub().resolves(false),
		setActiveHookExecution: sinon.stub().resolves(),
		clearActiveHookExecution: sinon.stub().resolves(),
		getActiveHookExecution: sinon.stub().resolves(undefined),
		runUserPromptSubmitHook: sinon.stub().resolves({}),
	}

	const config = {
		taskId: "task-plan-complete",
		ulid: "ulid-plan-complete",
		cwd,
		mode: "plan",
		strictPlanModeEnabled: false,
		yoloModeToggled: false,
		doubleCheckCompletionEnabled: false,
		vscodeTerminalExecutionMode: "backgroundExec",
		enableParallelToolCalling: true,
		isSubagentExecution: false,
		taskState,
		messageState: {
			getClineMessages: () => messages,
			setClineMessages: (nextMessages: any[]) => {
				messages.splice(0, messages.length, ...nextMessages)
			},
			saveClineMessagesAndUpdateHistory: sinon.stub().resolves(),
			updateClineMessage: sinon.stub().callsFake(async (index: number, update: any) => {
				messages[index] = { ...messages[index], ...update }
			}),
		},
		api: {
			getModel: () => ({ id: "gpt-5.5", info: {} }),
		},
		autoApprovalSettings: {
			enableNotifications: false,
			actions: { executeSafeCommands: false, executeAllCommands: false },
		},
		autoApprover: {
			shouldAutoApproveTool: sinon.stub().returns([false, false]),
		},
		browserSettings: {},
		focusChainSettings: {
			enabled: true,
			remindClineInterval: 6,
		},
		services: {
			stateManager: {
				getGlobalSettingsKey: (key: string) => (key === "mode" ? "plan" : false),
				getApiConfiguration: () => ({
					planModeApiProvider: "openai-codex",
					actModeApiProvider: "openai-codex",
				}),
			},
			mcpHub: {},
			browserSession: {},
			urlContentFetcher: {},
			diffViewProvider: {},
			fileContextTracker: {},
			clineIgnoreController: {},
			commandPermissionController: {},
			contextManager: {},
		},
		callbacks,
		coordinator: { getHandler: sinon.stub() },
	} as unknown as TaskConfig

	return { config, callbacks, messages }
}

describe("AttemptCompletionHandler plan mode", () => {
	let tempDir: string | undefined
	let openerDisposable: { dispose: () => void } | undefined

	afterEach(async () => {
		openerDisposable?.dispose()
		openerDisposable = undefined
		delete process.env.CODEVIBE_PLAN_HOME
		await disposePlanStorageServiceForTests()
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true })
			tempDir = undefined
		}
		sinon.restore()
	})

	it("persists a local .plan.md payload when a plan task completes through attempt_completion", async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codevibe-plan-completion-"))
		process.env.CODEVIBE_PLAN_HOME = tempDir
		sinon.stub(telemetryService, "captureTaskCompleted")
		sinon.stub(NotificationHook, "emitTaskCompleteNotification").resolves()
		const opened: string[] = []
		openerDisposable = registerPlanOpenHandler(async ({ planPath }) => {
			opened.push(planPath)
		})
		const { config, callbacks } = createPlanModeConfig(tempDir)
		const handler = new AttemptCompletionHandler()

		const result = await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.ATTEMPT,
			params: {
				result: "## Plan Completion\n\nBuild this locally.\n\n```mermaid\nflowchart TD\n  A[\"Plan\"] --> B[\"Act\"]\n```",
				task_progress: "- [x] Inspect\n- [ ] Implement",
			},
			partial: false,
		})

		assert.equal(result, "[attempt_completion] Result: Done")
		const completionCall = callbacks.say.getCalls().find((call) => call.args[0] === "completion_result")
		assert.ok(completionCall)
		const payload = JSON.parse(completionCall?.args[1] || "{}")
		assert.equal(payload.response.includes("Plan Completion"), true)
		assert.match(payload.localPlanBuild.planPath, /\.plan\.md$/)
		assert.equal(payload.localPlanBuild.todoCount, 2)
		assert.deepEqual(opened, [payload.localPlanBuild.planPath])

			const planText = await fs.readFile(payload.localPlanBuild.planPath, "utf8")
			assert.match(planText, /^---\nname: Plan Completion/m)
			assert.match(planText, /status: completed/)
			assert.match(planText, /status: pending/)
			assert.match(planText, /```mermaid/)
		})
	})
