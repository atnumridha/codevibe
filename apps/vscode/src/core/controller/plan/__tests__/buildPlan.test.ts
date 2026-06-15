import { strict as assert } from "node:assert"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { disposePlanStorageServiceForTests, registerPlanOpenHandler } from "@core/plan/PlanStorageService"
import { BuildPlanRequest } from "@shared/proto/cline/plan"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import { buildPlan } from "../buildPlan"

function createHostBridgeClient(workspacePath: string) {
	return {
		workspaceClient: {
			getWorkspacePaths: sinon.stub().resolves({ paths: [workspacePath] }),
		},
		windowClient: {
			getActiveEditor: sinon.stub().resolves({ filePath: "" }),
		},
		envClient: {},
		diffClient: {},
	} as any
}

describe("controller plan build", () => {
	afterEach(async () => {
		delete process.env.CODEVIBE_PLAN_HOME
		HostProvider.reset()
		await disposePlanStorageServiceForTests()
		sinon.restore()
	})

	it("materializes a .plan.md file before building an unpersisted plan card", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codevibe-build-plan-"))
		process.env.CODEVIBE_PLAN_HOME = tempDir
		setVscodeHostProviderMock({
			globalStorageFsPath: tempDir,
			hostBridgeClient: createHostBridgeClient(tempDir),
		})

		try {
			const togglePlanActMode = sinon.stub().resolves(true)
			const updateTaskProgressFromPlan = sinon.stub().resolves(undefined)
			const openedPlans: string[] = []
			registerPlanOpenHandler(async ({ planPath }) => {
				openedPlans.push(planPath)
			})
			const controller = {
				task: {
					taskId: "task-build-plan",
					taskState: { isAwaitingPlanResponse: true },
					updateTaskProgressFromPlan,
				},
				togglePlanActMode,
				initTask: sinon.stub().resolves(undefined),
			} as any

			const response = await buildPlan(
				controller,
				BuildPlanRequest.create({
					body: "## Build From Card\n\nUse this accepted plan.\n\n- [ ] Inspect\n- [ ] Implement",
					composerId: "chat-1700000000000",
					mode: "agent",
				}),
			)

			assert.equal(response.started, true)
			assert.match(response.plan?.planPath || "", /\.plan\.md$/)
			assert.equal(response.plan?.todoCount, 2)

			const planPath = response.plan?.planPath || ""
			const serialized = await fs.readFile(planPath, "utf8")
			assert.match(serialized, /^---\nname: Build From Card/m)
			assert.match(serialized, /content: Inspect/)
			assert.match(serialized, /content: Implement/)

			sinon.assert.calledOnce(updateTaskProgressFromPlan)
			sinon.assert.calledOnce(togglePlanActMode)
			const [, handoff] = togglePlanActMode.firstCall.args
			assert.equal(handoff.files[0], planPath)
			assert.match(handoff.message, /Plan file reference:/)
			assert.match(handoff.message, /"type": "ExecutePlanAction"/)
			assert.match(handoff.message, /"isPlanExecution": true/)
			assert.match(handoff.message, /"unifiedMode": "agent"/)
			assert.match(handoff.message, /Build From Card/)
			assert.deepEqual(openedPlans, [planPath])
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	})

	it("starts a new local act task when no plan approval is waiting", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codevibe-build-plan-fallback-"))
		process.env.CODEVIBE_PLAN_HOME = tempDir
		setVscodeHostProviderMock({
			globalStorageFsPath: tempDir,
			hostBridgeClient: createHostBridgeClient(tempDir),
		})

		try {
			const initTask = sinon.stub().resolves("task-from-build")
			const openedPlans: string[] = []
			registerPlanOpenHandler(async ({ planPath }) => {
				openedPlans.push(planPath)
			})
			const controller = {
				initTask,
				togglePlanActMode: sinon.stub().resolves(false),
			} as any

			const response = await buildPlan(
				controller,
				BuildPlanRequest.create({
					body: "## Build Later\n\n- [ ] Execute later",
					composerId: "chat-1700000000001",
					mode: "agent",
				}),
			)

			const planPath = response.plan?.planPath || ""
			assert.equal(response.started, true)
			assert.match(planPath, /\.plan\.md$/)
			assert.match(await fs.readFile(planPath, "utf8"), /Build Later/)
			sinon.assert.calledOnce(initTask)
			assert.equal(initTask.firstCall.args[2][0], planPath)
			assert.match(initTask.firstCall.args[0], /Plan file reference:/)
			assert.match(initTask.firstCall.args[0], /"type": "ExecutePlanAction"/)
			assert.match(initTask.firstCall.args[0], /"unifiedMode": "agent"/)
			assert.deepEqual(openedPlans, [planPath])
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	})

	it("marks parallel builds as multitask plan execution with skip submission metadata", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codevibe-build-plan-parallel-"))
		process.env.CODEVIBE_PLAN_HOME = tempDir
		setVscodeHostProviderMock({
			globalStorageFsPath: tempDir,
			hostBridgeClient: createHostBridgeClient(tempDir),
		})

		try {
			const togglePlanActMode = sinon.stub().resolves(true)
			const updateTaskProgressFromPlan = sinon.stub().resolves(undefined)
			registerPlanOpenHandler(async () => undefined)
			const controller = {
				task: {
					taskId: "task-build-parallel",
					taskState: { isAwaitingPlanResponse: true },
					updateTaskProgressFromPlan,
				},
				togglePlanActMode,
				initTask: sinon.stub().resolves(undefined),
			} as any

			const response = await buildPlan(
				controller,
				BuildPlanRequest.create({
					body: "## Parallel Plan\n\n- [ ] A\n- [ ] B",
					composerId: "chat-1700000000002",
					mode: "multitask",
				}),
			)

			assert.equal(response.started, true)
			assert.equal(response.mode, "multitask")
			const [, handoff] = togglePlanActMode.firstCall.args
			assert.match(handoff.message, /"unifiedMode": "multitask"/)
			assert.match(handoff.message, /"skipSubmission": true/)
			assert.match(handoff.message, /local parallel build/)
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	})

	it("starts selected todos in a new local agent instead of consuming the waiting plan composer", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codevibe-build-plan-new-agent-"))
		process.env.CODEVIBE_PLAN_HOME = tempDir
		setVscodeHostProviderMock({
			globalStorageFsPath: tempDir,
			hostBridgeClient: createHostBridgeClient(tempDir),
		})

		try {
			const initTask = sinon.stub().resolves("task-selected-new-agent")
			const togglePlanActMode = sinon.stub().resolves(true)
			const updateTaskProgressFromPlan = sinon.stub().resolves(undefined)
			registerPlanOpenHandler(async () => undefined)
			const controller = {
				task: {
					taskId: "task-waiting-plan",
					taskState: { isAwaitingPlanResponse: true },
					updateTaskProgressFromPlan,
				},
				togglePlanActMode,
				initTask,
			} as any

			const created = await buildPlan(
				controller,
				BuildPlanRequest.create({
					body: "## Selected Plan\n\n- [ ] A\n- [ ] B",
					composerId: "chat-1700000000003",
					mode: "agent",
				}),
			)
			const firstTodoId = created.plan?.metadata?.todos?.[0]?.id || ""

			const response = await buildPlan(
				controller,
				BuildPlanRequest.create({
					planId: created.plan?.planId,
					planPath: created.plan?.planPath,
					mode: "new_agent",
					todoIds: [firstTodoId],
				}),
			)

			assert.equal(response.started, true)
			sinon.assert.calledOnce(initTask)
			sinon.assert.calledOnce(togglePlanActMode)
			const message = initTask.firstCall.args[0]
			assert.match(message, /new Act-mode agent/)
			assert.match(message, /"entrypoint": "plan_tab_build_new_agent"/)
			assert.match(message, new RegExp(firstTodoId))
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true })
		}
	})
})
