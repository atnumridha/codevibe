import { describe, expect, it } from "vitest";
import {
	type BackgroundAgentTaskRecord,
	type CursorBackgroundAgentLaunchRequest,
	launchCursorBackgroundAgent,
	normalizeBackgroundAgentTaskRecords,
	upsertBackgroundAgentTaskRecord,
} from "./index";

const baseRequest: CursorBackgroundAgentLaunchRequest = {
	prompt: "Fix flaky tests",
	routePrompt:
		"A Cursor-compatible background agent deeplink was opened. Validate the request and ask for confirmation.",
	repository: "owner/repo",
	requestedBranch: "main",
};

function record(
	overrides: Partial<BackgroundAgentTaskRecord> = {},
): BackgroundAgentTaskRecord {
	return {
		id: "bg-1",
		source: "cursor-deeplink",
		status: "running",
		agentMode: "plan",
		autoApprovalProfile: "read-only-plan-confirmation-required",
		worktreePolicy: "confirm-before-create",
		createdAt: 1000,
		updatedAt: 1000,
		prompt: "Fix flaky tests",
		confirmationRequired: true,
		...overrides,
	};
}

function actionsFromSettings(settings: Record<string, unknown>) {
	const autoApprovalSettings = settings.autoApprovalSettings as
		| { actions?: Record<string, unknown> }
		| undefined;
	return autoApprovalSettings?.actions ?? {};
}

describe("background-agent launch", () => {
	it("creates a safe worktree record and starts a confirmation-safe task", async () => {
		const records: BackgroundAgentTaskRecord[] = [];
		const createWorktreeCalls: Array<{
			cwd: string;
			worktreePath: string;
			options: {
				branch?: string;
				baseBranch?: string;
				createNewBranch?: boolean;
			};
		}> = [];
		const startedTasks: Array<{
			prompt: string;
			taskSettings: Record<string, unknown>;
			record: BackgroundAgentTaskRecord;
		}> = [];

		const result = await launchCursorBackgroundAgent(baseRequest, {
			getWorkspaceRoot: async () => "/tmp/repo",
			areWorktreesEnabled: () => true,
			createId: () => "bg-test-123456",
			now: () => 1000,
			createWorktree: async (cwd, worktreePath, options) => {
				createWorktreeCalls.push({ cwd, worktreePath, options });
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
				};
			},
			startTask: async (prompt, taskSettings, launchRecord) => {
				launchRecord.errorMessage = "mutated by adapter";
				startedTasks.push({ prompt, taskSettings, record: launchRecord });
				return "task-1";
			},
			onRecordChange: (launchRecord) => records.push(launchRecord),
		});

		expect(createWorktreeCalls).toHaveLength(1);
		expect(createWorktreeCalls[0]?.cwd).toBe("/tmp/repo");
		expect(createWorktreeCalls[0]?.worktreePath).toBe(
			"/tmp/repo-background-agent-bg-test-123456",
		);
		expect(createWorktreeCalls[0]?.options).toEqual({
			branch: "background-agent/fix-flaky-tests-bg-test-123456",
			baseBranch: "main",
			createNewBranch: true,
		});

		expect(startedTasks).toHaveLength(1);
		expect(startedTasks[0]?.prompt).toContain("Prepared isolated worktree");
		expect(startedTasks[0]?.prompt).toContain(
			"/tmp/repo-background-agent-bg-test-123456",
		);
		expect(startedTasks[0]?.prompt).toContain("Original route prompt");
		expect(startedTasks[0]?.taskSettings.mode).toBe("plan");
		const actions = actionsFromSettings(startedTasks[0]?.taskSettings ?? {});
		expect(actions.editFiles).toBe(false);
		expect(actions.executeSafeCommands).toBe(false);
		expect(actions.useMcp).toBe(false);
		expect(startedTasks[0]?.record).toMatchObject({
			id: "bg-test-123456",
			status: "starting",
			launchMode: "worktree",
			worktreePath: "/tmp/repo-background-agent-bg-test-123456",
		});

		expect(result.status).toBe("running");
		expect(result.agentMode).toBe("plan");
		expect(result.autoApprovalProfile).toBe(
			"read-only-plan-confirmation-required",
		);
		expect(result.worktreePolicy).toBe("confirm-before-create");
		expect(result.launchMode).toBe("worktree");
		expect(result.taskId).toBe("task-1");
		expect(result.errorMessage).toBeUndefined();
		expect(records.map((item) => item.status)).toEqual(
			expect.arrayContaining([
				"queued",
				"preparing",
				"worktree_ready",
				"starting",
				"running",
			]),
		);
	});

	it("falls back to a controller record when worktrees are disabled", async () => {
		const startedTasks: Array<{
			prompt: string;
			taskSettings: Record<string, unknown>;
		}> = [];

		const result = await launchCursorBackgroundAgent(baseRequest, {
			getWorkspaceRoot: async () => "/tmp/repo",
			areWorktreesEnabled: () => false,
			createId: () => "bg-disabled",
			now: () => 1000,
			createWorktree: async () => {
				throw new Error("createWorktree should not be called");
			},
			startTask: async (prompt, taskSettings) => {
				startedTasks.push({ prompt, taskSettings });
				return "task-2";
			},
		});

		expect(result.status).toBe("running");
		expect(result.launchMode).toBe("controller-record");
		expect(result.fallbackReason).toBe("Worktrees are disabled");
		expect(startedTasks[0]?.prompt).toContain(
			"No isolated worktree was created",
		);
		expect(startedTasks[0]?.prompt).toContain("Worktrees are disabled");
		expect(startedTasks[0]?.taskSettings.mode).toBe("plan");
	});

	it("does not create a worktree when the repository hint targets another workspace", async () => {
		let createWorktreeCalled = false;

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
					createWorktreeCalled = true;
					return { success: false, message: "unexpected" };
				},
				startTask: async () => "task-3",
			},
		);

		expect(createWorktreeCalled).toBe(false);
		expect(result.status).toBe("running");
		expect(result.launchMode).toBe("controller-record");
		expect(result.fallbackReason).toBe(
			"Repository hint does not match the active workspace",
		);
	});

	it("ignores invalid requested base refs instead of passing them to git", async () => {
		const createWorktreeCalls: Array<{ options: { baseBranch?: string } }> = [];

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
					createWorktreeCalls.push({ options });
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
					};
				},
				startTask: async () => "task-4",
			},
		);

		expect(createWorktreeCalls).toHaveLength(1);
		expect(createWorktreeCalls[0]?.options.baseBranch).toBeUndefined();
		expect(result.warning).toContain("Requested base ref was ignored");
		expect(result.launchMode).toBe("worktree");
	});
});

describe("background-agent persistence", () => {
	it("filters invalid records, deduplicates by id, and keeps the newest update", () => {
		const records = normalizeBackgroundAgentTaskRecords([
			record({ id: "bg-1", status: "queued", updatedAt: 1000 }),
			{ ...record({ id: "invalid" }), confirmationRequired: false },
			record({ id: "bg-2", createdAt: 900, updatedAt: 900 }),
			record({
				id: "bg-1",
				status: "running",
				updatedAt: 1500,
				taskId: "task-1",
			}),
		]);

		expect(records.map((item) => item.id)).toEqual(["bg-2", "bg-1"]);
		expect(records[1]).toMatchObject({
			id: "bg-1",
			status: "running",
			taskId: "task-1",
		});
	});

	it("keeps a bounded set of the most recent records", () => {
		const records = normalizeBackgroundAgentTaskRecords(
			Array.from({ length: 105 }, (_, index) =>
				record({
					id: `bg-${index}`,
					createdAt: index,
					updatedAt: index,
				}),
			),
		);

		expect(records).toHaveLength(100);
		expect(records[0]?.id).toBe("bg-5");
		expect(records.at(-1)?.id).toBe("bg-104");
	});

	it("upserts records into a normalized persisted list", () => {
		const records = upsertBackgroundAgentTaskRecord(
			[record({ id: "bg-1", status: "queued", updatedAt: 1000 })],
			record({
				id: "bg-1",
				status: "failed",
				updatedAt: 2000,
				errorMessage: "boom",
			}),
		);

		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			id: "bg-1",
			status: "failed",
			errorMessage: "boom",
		});
	});
});
