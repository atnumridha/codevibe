import { getPlanStorageService } from "@core/plan/PlanStorageService"
import { Empty } from "@shared/proto/cline/common"
import { PlanRequest } from "@shared/proto/cline/plan"
import { getWorkspacePath } from "@utils/path"
import { Controller } from ".."

export async function openPlan(_controller: Controller, request: PlanRequest): Promise<Empty> {
	const workspacePath = await getWorkspacePath()
	await getPlanStorageService().openPlan({
		planId: request.planId,
		planPath: request.planPath,
		workspacePath,
	})
	return Empty.create()
}
