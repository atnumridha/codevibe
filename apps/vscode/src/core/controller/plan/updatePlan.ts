import { getPlanStorageService } from "@core/plan/PlanStorageService"
import { PlanFile, PlanUpdateRequest } from "@shared/proto/cline/plan"
import { getWorkspacePath } from "@utils/path"
import { Controller } from ".."
import { fromProtoMetadata, toProtoPlanFile } from "./converters"

export async function updatePlan(_controller: Controller, request: PlanUpdateRequest): Promise<PlanFile> {
	const workspacePath = await getWorkspacePath()
	const plan = await getPlanStorageService().updatePlan({
		planId: request.planId,
		planPath: request.planPath,
		metadata: fromProtoMetadata(request.planMetadata),
		body: request.body,
		workspacePath,
	})
	return toProtoPlanFile(plan)
}
