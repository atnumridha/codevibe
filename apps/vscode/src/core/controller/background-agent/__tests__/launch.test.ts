import { expect } from "chai"
import { describe, it } from "mocha"
import type { Settings } from "@shared/storage/state-keys"
import {
	type BackgroundAgentTaskRecord,
	type CursorBackgroundAgentLaunchRequest,
	launchCursorBackgroundAgent,
} from "../launch"

const baseRequest: CursorBackgroundAgentLaunchRequest = {
	prompt: "Fix flaky tests",
	routePrompt:
		"A Cursor-compatible background agent deeplink was opened. Validate the request and ask for confirmation.",
	repository: "owner/repo",
	requestedBranch: "main",
}

describe("launchCursorBackgroundAgent", () => {
	it("creates a safe worktree record and starts a confirmation-safe task", async () => {
		const records: BackgroundAgentTaskRecord[] = []
		const createWorktreeCalls: Array<{
			cwd: string
			worktreePath: string
			options: { branch?: string; baseBranch?: string; createNewBranch?: boolean }
		}> = []
		const startedTasks: Array<{
			prompt: string
			taskSettings: Partial<Settings>
			record: BackgroundAgentTaskRecord
		}> = []

		const result = await launchCursorBackgroundAgent(baseRequest, {
			getWorkspaceRoot: async () => "/tmp/repo",
			areWorktreesEnabled: () => true,
			createId: () => "bg-test-123456",
			now: () => 1000,
			createWorktree: async (cwd, worktreePath, options) => {
				createWorktreeCalls.push({ cwd, worktreePath, options })
				return {
					success: true,
					message: "created",
					worktree: {
						path: worktreePath,
						branch: options.branch || "",
						commitHash: "abc123",
						isCurrent: false,
						isBare: false,
						isDetached: false,
						isLocked: false,
					},
				}
			},
			startTask: async (prompt, taskSettings, record) => {
				record.errorMessage = "mutated by adapter"
				startedTasks.push({ prompt, taskSettings, record })
				return "task-1"
			},
			onRecordChange: (record) => records.push(record),
		})

		expect(createWorktreeCalls).to.have.length(1)
		expect(createWorktreeCalls[0].cwd).to.equal("/tmp/repo")
		expect(createWorktreeCalls[0].worktreePath).to.equal("/tmp/repo-background-agent-bg-test-123456")
		expect(createWorktreeCalls[0].options).to.deep.equal({
			branch: "background-agent/fix-flaky-tests-bg-test-123456",
			baseBranch: "main",
			createNewBranch: true,
		})

		expect(startedTasks).to.have.length(1)
		expect(startedTasks[0].prompt).to.contain("Prepared isolated worktree")
		expect(startedTasks[0].prompt).to.contain("/tmp/repo-background-agent-bg-test-123456")
		expect(startedTasks[0].prompt).to.contain("Original route prompt")
		expect(startedTasks[0].taskSettings.mode).to.equal("plan")
		expect(startedTasks[0].taskSettings.autoApprovalSettings?.actions.editFiles).to.equal(false)
		expect(startedTasks[0].taskSettings.autoApprovalSettings?.actions.executeSafeCommands).to.equal(false)
		expect(startedTasks[0].taskSettings.autoApprovalSettings?.actions.useMcp).to.equal(false)
		expect(startedTasks[0].record).to.deep.include({
			id: "bg-test-123456",
			status: "starting",
			launchMode: "worktree",
			worktreePath: "/tmp/repo-background-agent-bg-test-123456",
		})

		expect(result.status).to.equal("running")
		expect(result.agentMode).to.equal("plan")
		expect(result.autoApprovalProfile).to.equal("read-only-plan-confirmation-required")
		expect(result.worktreePolicy).to.equal("confirm-before-create")
		expect(result.launchMode).to.equal("worktree")
		expect(result.taskId).to.equal("task-1")
		expect(result.errorMessage).to.equal(undefined)
		expect(records.map((record) => record.status)).to.include.members([
			"queued",
			"preparing",
			"worktree_ready",
			"starting",
			"running",
		])
	})

	it("falls back to a controller record when worktrees are disabled", async () => {
		const startedTasks: Array<{ prompt: string; taskSettings: Partial<Settings> }> = []

		const result = await launchCursorBackgroundAgent(baseRequest, {
			getWorkspaceRoot: async () => "/tmp/repo",
			areWorktreesEnabled: () => false,
			createId: () => "bg-disabled",
			now: () => 1000,
			createWorktree: async () => {
				throw new Error("createWorktree should not be called")
			},
			startTask: async (prompt, taskSettings) => {
				startedTasks.push({ prompt, taskSettings })
				return "task-2"
			},
		})

		expect(result.status).to.equal("running")
		expect(result.launchMode).to.equal("controller-record")
		expect(result.fallbackReason).to.equal("Worktrees are disabled")
		expect(startedTasks[0].prompt).to.contain("No isolated worktree was created")
		expect(startedTasks[0].prompt).to.contain("Worktrees are disabled")
		expect(startedTasks[0].taskSettings.mode).to.equal("plan")
	})

	it("does not create a worktree when the repository hint targets another workspace", async () => {
		let createWorktreeCalled = false

		const result = await launchCursorBackgroundAgent(
			{
				...baseRequest,
				repository: "owner/other-repo",
			},
			{
				getWorkspaceRoot: async () => "/tmp/repo",
				areWorktreesEnabled: () => true,
				createId: () => "bg-mismatch",
				now: () => 1000,
				createWorktree: async () => {
					createWorktreeCalled = true
					return { success: false, message: "unexpected" }
				},
				startTask: async () => "task-3",
			},
		)

		expect(createWorktreeCalled).to.equal(false)
		expect(result.status).to.equal("running")
		expect(result.launchMode).to.equal("controller-record")
		expect(result.fallbackReason).to.equal("Repository hint does not match the active workspace")
	})

	it("ignores invalid requested base refs instead of passing them to git", async () => {
		const createWorktreeCalls: Array<{ options: { baseBranch?: string } }> = []

		const result = await launchCursorBackgroundAgent(
			{
				...baseRequest,
				requestedBranch: "--bad branch",
			},
			{
				getWorkspaceRoot: async () => "/tmp/repo",
				areWorktreesEnabled: () => true,
				createId: () => "bg-bad-ref",
				now: () => 1000,
				createWorktree: async (_cwd, worktreePath, options) => {
					createWorktreeCalls.push({ options })
					return {
						success: true,
						message: "created",
						worktree: {
							path: worktreePath,
							branch: options.branch || "",
							commitHash: "abc123",
							isCurrent: false,
							isBare: false,
							isDetached: false,
							isLocked: false,
						},
					}
				},
				startTask: async () => "task-4",
			},
		)

		expect(createWorktreeCalls).to.have.length(1)
		expect(createWorktreeCalls[0].options.baseBranch).to.equal(undefined)
		expect(result.warning).to.contain("Requested base ref was ignored")
		expect(result.launchMode).to.equal("worktree")
	})
})
