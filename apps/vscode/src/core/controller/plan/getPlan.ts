import { getPlanStorageService } from "@core/plan/PlanStorageService"
import { PlanFile, PlanRequest } from "@shared/proto/cline/plan"
import { getWorkspacePath } from "@utils/path"
import { Controller } from ".."
import { toProtoPlanFile } from "./converters"

export async function getPlan(_controller: Controller, request: PlanRequest): Promise<PlanFile> {
	const workspacePath = await getWorkspacePath()
	const plan = await getPlanStorageService().readPlan({
		planId: request.planId,
		planPath: request.planPath,
		workspacePath,
	})
	return toProtoPlanFile(plan)
}
