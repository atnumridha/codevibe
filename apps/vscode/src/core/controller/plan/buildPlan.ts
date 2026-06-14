import { getPlanStorageService } from "@core/plan/PlanStorageService"
import { buildLocalPlanExecutionMessage, type PlanBuildMode } from "@shared/plan-build"
import { BuildPlanRequest, BuildPlanResponse } from "@shared/proto/cline/plan"
import { getWorkspacePath } from "@utils/path"
import { Controller } from ".."
import { toProtoPlanFile } from "./converters"

export async function buildPlan(controller: Controller, request: BuildPlanRequest): Promise<BuildPlanResponse> {
	const workspacePath = await getWorkspacePath()
	const storage = getPlanStorageService()
	const initialPlan = await storage.readPlan({
		planId: request.planId,
		planPath: request.planPath,
		workspacePath,
	})
	const requestedMode: PlanBuildMode = request.mode === "multitask" ? "multitask" : "agent"
	const executionMode: PlanBuildMode =
		requestedMode === "multitask" ? "multitask" : initialPlan.metadata.isProject ? "project" : "agent"
	const builderId = controller.task?.taskId || "local-builder"
	const registration = await storage.registerBuild({
		planId: initialPlan.planId,
		planPath: initialPlan.planPath,
		mode: executionMode,
		builderId,
		todoIds: request.todoIds,
		workspacePath,
	})

	const taskProgress = storage.planToTaskProgress(registration.plan, registration.todoIds)
	const message = buildLocalPlanExecutionMessage({
		planText: registration.plan.serialized,
		planPath: registration.plan.planPath,
		taskProgress,
		mode: executionMode,
		selectedTodoIds: registration.todoIds,
	})

	await controller.task?.updateTaskProgressFromPlan(taskProgress)
	const started = await controller.togglePlanActMode("act", {
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

	return BuildPlanResponse.create({
		started,
		mode: executionMode,
		message: started ? "Plan build started locally." : "Plan build could not start because no plan approval was waiting.",
		plan: toProtoPlanFile(registration.plan),
	})
}
