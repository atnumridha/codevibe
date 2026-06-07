import { expect } from "chai"
import { describe, it } from "mocha"
import { getBackgroundAgentSessions } from "../getBackgroundAgentSessions"

describe("getBackgroundAgentSessions", () => {
	it("returns background-agent lifecycle records for standalone clients", async () => {
		const response = await getBackgroundAgentSessions({
			getBackgroundAgentTaskRecords: () => [
				{
					id: "bg-1",
					source: "cursor-deeplink",
					status: "running",
					agentMode: "plan",
					autoApprovalProfile: "read-only-plan-confirmation-required",
					worktreePolicy: "confirm-before-create",
					launchMode: "worktree",
					createdAt: 1000,
					updatedAt: 1500,
					prompt: "Fix flaky tests",
					routePrompt: "Original route prompt",
					repository: "owner/repo",
					requestedBranch: "main",
					requestedBaseBranch: "develop",
					workspaceRoot: "/workspace/repo",
					worktreePath: "/workspace/repo-background-agent-bg-1",
					worktreeBranch: "background-agent/fix-flaky-tests-bg-1",
					worktreeBaseRef: "develop",
					confirmationRequired: true,
					taskId: "task-1",
				},
				{
					id: "bg-2",
					source: "cursor-deeplink",
					status: "failed",
					agentMode: "plan",
					autoApprovalProfile: "read-only-plan-confirmation-required",
					worktreePolicy: "confirm-before-create",
					createdAt: 2000,
					updatedAt: 2500,
					prompt: "Investigate failure",
					confirmationRequired: true,
					fallbackReason: "Worktrees are disabled",
					errorMessage: "Task failed",
				},
			],
		} as any)

		expect(response.totalCount).to.equal(2)
		expect(response.sessions[0]).to.deep.include({
			id: "bg-1",
			status: "running",
			agentMode: "plan",
			autoApprovalProfile: "read-only-plan-confirmation-required",
			worktreePolicy: "confirm-before-create",
			launchMode: "worktree",
			worktreePath: "/workspace/repo-background-agent-bg-1",
			taskId: "task-1",
			confirmationRequired: true,
		})
		expect(response.sessions[1]).to.deep.include({
			id: "bg-2",
			status: "failed",
			fallbackReason: "Worktrees are disabled",
			errorMessage: "Task failed",
		})
	})
})
