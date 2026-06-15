import { getPlanStorageService } from "@core/plan/PlanStorageService"
import { buildLocalPlanExecutionMessage, getNonCompletedPlanTodoIds, type PlanBuildMode } from "@shared/plan-build"
import { BuildPlanRequest, BuildPlanResponse } from "@shared/proto/cline/plan"
import { getWorkspacePath } from "@utils/path"
import { Controller } from ".."
import { toProtoPlanFile } from "./converters"

interface AcceptLocalPlanBuildRequest {
	planId?: string
	planPath?: string
	body?: string
	composerId?: string
	requestedMode?: Exclude<PlanBuildMode, "project">
	todoIds?: string[]
	forceNewAgent?: boolean
	skipSubmission?: boolean
	workspacePath?: string
}

export async function acceptLocalPlanBuild(
	controller: Controller,
	request: AcceptLocalPlanBuildRequest,
) {
	const workspacePath = request.workspacePath ?? (await getWorkspacePath())
	const storage = getPlanStorageService()
	const hasExistingPlanReference = Boolean(request.planId || request.planPath)
	const initialPlan = hasExistingPlanReference
		? await storage.readPlan({
				planId: request.planId,
				planPath: request.planPath,
				workspacePath,
			})
		: await storage.createOrUpdatePlanForComposer({
				composerId: request.composerId || controller.task?.taskId || `local-plan-build-${Date.now()}`,
				response: request.body ?? "",
				workspacePath,
			})
	const requestedMode: PlanBuildMode = request.requestedMode === "multitask" ? "multitask" : "agent"
	const executionMode: PlanBuildMode =
		requestedMode === "multitask" ? "multitask" : initialPlan.metadata.isProject ? "project" : "agent"
	const selectedTodoIds = request.todoIds?.length ? request.todoIds : getNonCompletedPlanTodoIds(initialPlan.metadata)
	const canUseActiveComposer = Boolean(controller.task?.taskState.isAwaitingPlanResponse && !request.forceNewAgent)
	let started = false
	let planForResponse = initialPlan
	let builderId = controller.task?.taskId || `local-plan-build-${Date.now()}`

	if (canUseActiveComposer && controller.task) {
		builderId = controller.task.taskId
		const registration = await storage.registerBuild({
			planId: initialPlan.planId,
			planPath: initialPlan.planPath,
			mode: executionMode,
			builderId,
			todoIds: selectedTodoIds,
			workspacePath,
		})
		planForResponse = registration.plan
		const taskProgress = storage.planToTaskProgress(registration.plan, registration.todoIds)
		const message = buildLocalPlanExecutionMessage({
			planText: registration.plan.serialized,
			planId: registration.plan.planId,
			planPath: registration.plan.planPath,
			taskProgress,
			mode: executionMode,
			selectedTodoIds: registration.todoIds,
			skipSubmission: request.skipSubmission,
			forceNewAgent: request.forceNewAgent,
		})
		await controller.task.updateTaskProgressFromPlan(taskProgress)
		started = await controller.togglePlanActMode("act", {
			message,
			images: [],
			files: [registration.plan.planPath],
		})
		if (!started) {
			await storage.rollbackBuild({
				planId: registration.plan.planId,
				planPath: registration.plan.planPath,
				builderId,
				workspacePath,
			})
		}
	} else {
		const provisionalBuilderId = request.forceNewAgent
			? `new-agent-plan-build-${Date.now()}`
			: `local-plan-build-${Date.now()}`
		const registration = await storage.registerBuild({
			planId: initialPlan.planId,
			planPath: initialPlan.planPath,
			mode: executionMode,
			builderId: provisionalBuilderId,
			todoIds: selectedTodoIds,
			workspacePath,
		})
		planForResponse = registration.plan
		const taskProgress = storage.planToTaskProgress(registration.plan, registration.todoIds)
		const message = buildLocalPlanExecutionMessage({
			planText: registration.plan.serialized,
			planId: registration.plan.planId,
			planPath: registration.plan.planPath,
			taskProgress,
			mode: executionMode,
			selectedTodoIds: registration.todoIds,
			skipSubmission: request.skipSubmission,
			forceNewAgent: request.forceNewAgent,
		})
		const taskId = await controller.initTask(message, [], [registration.plan.planPath], undefined, { mode: "act" } as any)
		started = Boolean(taskId)
		if (started) {
			builderId = taskId
			await storage.rollbackBuild({
				planId: registration.plan.planId,
				planPath: registration.plan.planPath,
				builderId: provisionalBuilderId,
				workspacePath,
			})
			const finalRegistration = await storage.registerBuild({
				planId: registration.plan.planId,
				planPath: registration.plan.planPath,
				mode: executionMode,
				builderId,
				todoIds: registration.todoIds,
				workspacePath,
			})
			planForResponse = finalRegistration.plan
		} else {
			await storage.rollbackBuild({
				planId: registration.plan.planId,
				planPath: registration.plan.planPath,
				builderId: provisionalBuilderId,
				workspacePath,
			})
		}
	}

	if (started) {
		await storage.openPlan({
			planId: planForResponse.planId,
			planPath: planForResponse.planPath,
			workspacePath,
		})
	}

	return {
		started,
		mode: executionMode,
		message: started ? "Plan build started locally." : "Plan build could not start because no plan approval was waiting.",
		plan: planForResponse,
		taskId: started ? builderId : undefined,
		todoIds: selectedTodoIds,
		isPlanExecution: true as const,
	}
}

export async function buildPlan(controller: Controller, request: BuildPlanRequest): Promise<BuildPlanResponse> {
	const accepted = await acceptLocalPlanBuild(controller, {
		planId: request.planId,
		planPath: request.planPath,
		body: request.body,
		composerId: request.composerId,
		requestedMode: request.mode === "multitask" ? "multitask" : "agent",
		todoIds: request.todoIds,
		forceNewAgent: request.mode === "new_agent" || request.mode === "agent_new",
		skipSubmission: request.mode === "multitask",
	})

	return BuildPlanResponse.create({
		started: accepted.started,
		mode: accepted.mode,
		message: accepted.message,
		plan: toProtoPlanFile(accepted.plan),
	})
}
