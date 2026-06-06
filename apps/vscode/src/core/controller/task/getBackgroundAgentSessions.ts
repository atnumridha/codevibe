import { BackgroundAgentSessions } from "@shared/proto/cline/task"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."

export async function getBackgroundAgentSessions(controller: Controller): Promise<BackgroundAgentSessions> {
	try {
		const sessions = controller.getBackgroundAgentTaskRecords().map((record) => ({
			id: record.id,
			source: record.source,
			status: record.status,
			launchMode: record.launchMode,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
			prompt: record.prompt,
			routePrompt: record.routePrompt,
			repository: record.repository,
			requestedBranch: record.requestedBranch,
			requestedBaseBranch: record.requestedBaseBranch,
			workspaceRoot: record.workspaceRoot,
			worktreePath: record.worktreePath,
			worktreeBranch: record.worktreeBranch,
			worktreeBaseRef: record.worktreeBaseRef,
			confirmationRequired: record.confirmationRequired,
			fallbackReason: record.fallbackReason,
			warning: record.warning,
			taskId: record.taskId,
			errorMessage: record.errorMessage,
		}))

		return BackgroundAgentSessions.create({
			sessions,
			totalCount: sessions.length,
		})
	} catch (error) {
		Logger.error("Error in getBackgroundAgentSessions:", error)
		throw error
	}
}
