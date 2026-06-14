import { getPlanStorageService } from "@core/plan/PlanStorageService"
import { EmptyRequest } from "@shared/proto/cline/common"
import { PlanRegistry } from "@shared/proto/cline/plan"
import { getWorkspacePath } from "@utils/path"
import { Controller } from ".."
import { toProtoRegistry } from "./converters"

export async function listPlans(_controller: Controller, _request: EmptyRequest): Promise<PlanRegistry> {
	const workspacePath = await getWorkspacePath()
	const plans = await getPlanStorageService().listPlans(workspacePath)
	return toProtoRegistry(plans)
}
