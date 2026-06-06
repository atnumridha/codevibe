import { CheckoutBranchRequest, WorktreeResult } from "@shared/proto/cline/worktree"
import { normalizeGitBranchName } from "@utils/git-helper"
import { getWorkspacePath } from "@utils/path"
import simpleGit from "simple-git"
import { Controller } from ".."

/**
 * Checks out a branch in the current worktree (git checkout)
 * @param controller The controller instance
 * @param request The checkout branch request containing the branch name
 * @returns WorktreeResult indicating success or failure
 */
export async function checkoutBranch(_controller: Controller, request: CheckoutBranchRequest): Promise<WorktreeResult> {
	const cwd = await getWorkspacePath()
	if (!cwd) {
		return WorktreeResult.create({
			success: false,
			message: "No workspace folder found",
		})
	}

	const { branch } = request

	if (!branch) {
		return WorktreeResult.create({
			success: false,
			message: "Branch name is required",
		})
	}

	const normalizedBranch = normalizeGitBranchName(branch)
	if (!normalizedBranch.ok) {
		return WorktreeResult.create({
			success: false,
			message: normalizedBranch.error,
		})
	}

	try {
		const git = simpleGit(cwd)
		await git.checkout(normalizedBranch.value)

		return WorktreeResult.create({
			success: true,
			message: `Switched to branch '${normalizedBranch.value}'`,
		})
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		return WorktreeResult.create({
			success: false,
			message: `Failed to checkout branch: ${errorMessage}`,
		})
	}
}
