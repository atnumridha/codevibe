import { getPlanStorageService } from "@core/plan/PlanStorageService"
import { normalizePlanTodoStatus } from "@shared/plan-build"
import { PlanFile, PlanTodoStatusRequest } from "@shared/proto/cline/plan"
import { getWorkspacePath } from "@utils/path"
import { Controller } from ".."
import { toProtoPlanFile } from "./converters"

export async function updatePlanTodoStatus(_controller: Controller, request: PlanTodoStatusRequest): Promise<PlanFile> {
	const workspacePath = await getWorkspacePath()
	const plan = await getPlanStorageService().updateTodoStatus({
		planId: request.planId,
		planPath: request.planPath,
		todoIds: request.todoIds,
		status: normalizePlanTodoStatus(request.status),
		workspacePath,
	})
	return toProtoPlanFile(plan)
}
