import { getPlanStorageService } from "@core/plan/PlanStorageService"
import type { LocalPlanBuildMetadata } from "@shared/plan-build"

export async function writeLocalPlanArtifact({
	taskId,
	response,
	taskProgress,
	workspacePath,
}: {
	taskId: string
	response: string
	taskProgress?: string
	workspacePath?: string
}): Promise<LocalPlanBuildMetadata> {
	const plan = await getPlanStorageService().createOrUpdatePlanForComposer({
		composerId: taskId,
		response,
		taskProgress,
		workspacePath,
	})

	return {
		planId: plan.planId,
		planPath: plan.planPath,
		todoCount: plan.todoCount,
		status: plan.buildStatus,
	}
}
