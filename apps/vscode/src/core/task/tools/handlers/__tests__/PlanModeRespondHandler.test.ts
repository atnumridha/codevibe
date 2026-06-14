import { strict as assert } from "node:assert"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { resetPlanStorageServiceForTests } from "@core/plan/PlanStorageService"
import { ClineDefaultTool } from "@shared/tools"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import { telemetryService } from "@/services/telemetry"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import { TaskState } from "../../../TaskState"
import type { TaskConfig } from "../../types/TaskConfig"
import { PlanModeRespondHandler } from "../PlanModeRespondHandler"

function createConfig(options?: { focusChainEnabled?: boolean }) {
	const taskState = new TaskState()
	const callbacks = {
		say: sinon.stub().resolves(undefined),
		ask: sinon.stub().resolves({ response: "messageResponse", text: "approved" }),
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
		taskId: "task-1",
		ulid: "ulid-1",
		cwd: "/tmp",
		mode: "plan",
		strictPlanModeEnabled: false,
		yoloModeToggled: false,
		doubleCheckCompletionEnabled: false,
		vscodeTerminalExecutionMode: "backgroundExec",
		enableParallelToolCalling: true,
		isSubagentExecution: false,
		taskState,
		messageState: {},
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
			enabled: options?.focusChainEnabled ?? true,
			remindClineInterval: 6,
		},
		services: {
			stateManager: {
				getGlobalSettingsKey: (key: string) => (key === "mode" ? "plan" : undefined),
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

	return { config, callbacks }
}

describe("PlanModeRespondHandler", () => {
	afterEach(() => {
		delete process.env.CODEVIBE_PLAN_HOME
		resetPlanStorageServiceForTests()
		sinon.restore()
	})

	it("publishes task_progress before waiting for plan approval", async () => {
		sinon.stub(telemetryService, "captureTaskCompleted")
		const { config, callbacks } = createConfig()
		const handler = new PlanModeRespondHandler()
		const taskProgress = "- [ ] Inspect\n- [ ] Implement"

		const result = await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.PLAN_MODE,
			params: {
				response: "Here is the plan.",
				task_progress: taskProgress,
			},
			partial: false,
		})

		assert.match(String(result), /approved/)
		sinon.assert.calledOnceWithExactly(callbacks.updateFCListFromToolResponse, taskProgress)
		sinon.assert.calledOnce(callbacks.ask)
		sinon.assert.callOrder(callbacks.updateFCListFromToolResponse, callbacks.ask)
	})

	it("persists local plan metadata before waiting for plan approval", async () => {
		sinon.stub(telemetryService, "captureTaskCompleted")
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codevibe-plan-build-"))
		process.env.CODEVIBE_PLAN_HOME = tempDir
		setVscodeHostProviderMock({ globalStorageFsPath: tempDir })

		try {
			const { config, callbacks } = createConfig()
			const handler = new PlanModeRespondHandler()

			await handler.execute(config, {
				type: "tool_use",
				name: ClineDefaultTool.PLAN_MODE,
				params: {
					response: "Here is the plan.",
					task_progress: "- [x] Inspect\n- [ ] Implement",
				},
				partial: false,
			})

			const askPayload = JSON.parse(callbacks.ask.firstCall.args[1])
			assert.equal(askPayload.localPlanBuild.status, "none")
			assert.equal(askPayload.localPlanBuild.todoCount, 2)
			assert.match(askPayload.localPlanBuild.planPath, /local-plan-task-1\.plan\.md$/)

			const planFile = await fs.readFile(askPayload.localPlanBuild.planPath, "utf8")
			assert.match(planFile, /name: Plan/)
			assert.match(planFile, /Here is the plan\./)
			assert.match(planFile, /content: Inspect/)
			assert.match(planFile, /content: Implement/)
			assert.match(planFile, /status: pending/)
		} finally {
			HostProvider.reset()
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	})

	it("does not publish task_progress when focus chain is disabled", async () => {
		sinon.stub(telemetryService, "captureTaskCompleted")
		const { config, callbacks } = createConfig({ focusChainEnabled: false })
		const handler = new PlanModeRespondHandler()

		await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.PLAN_MODE,
			params: {
				response: "Here is the plan.",
				task_progress: "- [ ] Inspect",
			},
			partial: false,
		})

		sinon.assert.notCalled(callbacks.updateFCListFromToolResponse)
		sinon.assert.calledOnce(callbacks.ask)
	})
})
