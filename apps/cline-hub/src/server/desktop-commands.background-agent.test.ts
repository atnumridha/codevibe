import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	type BackgroundAgentTaskRecord,
	readBackgroundAgentTaskRecordsFile,
	resolveBackgroundAgentRecordsPath,
	writeBackgroundAgentTaskRecordsFile,
} from "@cline/core";
import { handleDesktopCommand } from "./desktop-commands";
import { HubContext } from "./state";

function withTempDataDir(t: test.TestContext): string {
	const dir = mkdtempSync(join(tmpdir(), "cline-hub-background-agent-"));
	const previous = process.env.CLINE_DATA_DIR;
	process.env.CLINE_DATA_DIR = dir;
	t.after(() => {
		if (previous === undefined) {
			delete process.env.CLINE_DATA_DIR;
		} else {
			process.env.CLINE_DATA_DIR = previous;
		}
		rmSync(dir, { recursive: true, force: true });
	});
	return dir;
}

function backgroundRecord(
	overrides: Partial<BackgroundAgentTaskRecord> = {},
): BackgroundAgentTaskRecord {
	return {
		id: "bg-1",
		source: "cursor-deeplink",
		status: "running",
		agentMode: "plan",
		autoApprovalProfile: "read-only-plan-confirmation-required",
		worktreePolicy: "confirm-before-create",
		launchMode: "worktree",
		createdAt: 1000,
		updatedAt: 2000,
		prompt: "Fix queue",
		workspaceRoot: "/workspace/repo",
		worktreePath: "/workspace/repo-background-agent-bg-1",
		worktreeBranch: "background-agent/fix-queue-bg-1",
		confirmationRequired: true,
		taskId: "task-1",
		...overrides,
	};
}

test("delete_background_agent_record removes a persisted lifecycle record", async (t) => {
	const dataDir = withTempDataDir(t);
	const recordsPath = resolveBackgroundAgentRecordsPath(dataDir);
	writeBackgroundAgentTaskRecordsFile(recordsPath, [
		backgroundRecord(),
		backgroundRecord({
			id: "bg-2",
			taskId: "task-2",
			prompt: "Investigate retries",
			updatedAt: 3000,
		}),
	]);
	const ctx = new HubContext();

	const response = (await handleDesktopCommand(
		ctx,
		"delete_background_agent_record",
		{ id: "bg-1" },
	)) as Array<Record<string, unknown>>;
	const remainingRecords = readBackgroundAgentTaskRecordsFile(recordsPath);

	assert.deepEqual(
		remainingRecords.map((record) => record.id),
		["bg-2"],
	);
	assert.deepEqual(
		response.map((session) => session.sessionId),
		["task-2"],
	);
	assert.equal(ctx.events[0]?.title, "Background agent dismissed");
	assert.equal(ctx.events[0]?.body, "bg-1");
});

test("dismiss_background_agent_session accepts a background-agent task id", async (t) => {
	const dataDir = withTempDataDir(t);
	const recordsPath = resolveBackgroundAgentRecordsPath(dataDir);
	writeBackgroundAgentTaskRecordsFile(recordsPath, [backgroundRecord()]);
	const ctx = new HubContext();

	const response = (await handleDesktopCommand(
		ctx,
		"dismiss_background_agent_session",
		{ sessionId: "task-1" },
	)) as Array<Record<string, unknown>>;

	assert.deepEqual(readBackgroundAgentTaskRecordsFile(recordsPath), []);
	assert.deepEqual(response, []);
	assert.equal(ctx.events[0]?.body, "task-1");
});

test("delete_background_agent_record rejects unknown lifecycle records", async (t) => {
	const dataDir = withTempDataDir(t);
	writeBackgroundAgentTaskRecordsFile(
		resolveBackgroundAgentRecordsPath(dataDir),
		[backgroundRecord()],
	);
	const ctx = new HubContext();

	await assert.rejects(
		() =>
			handleDesktopCommand(ctx, "delete_background_agent_record", {
				id: "missing",
			}),
		/unknown background agent record: missing/,
	);
});

test("open_background_agent_worktree resolves a persisted worktree by record id", async (t) => {
	const dataDir = withTempDataDir(t);
	const worktreePath = join(dataDir, "repo-background-agent-bg-1");
	mkdirSync(worktreePath);
	writeBackgroundAgentTaskRecordsFile(
		resolveBackgroundAgentRecordsPath(dataDir),
		[backgroundRecord({ worktreePath })],
	);
	const ctx = new HubContext();

	const response = (await handleDesktopCommand(
		ctx,
		"open_background_agent_worktree",
		{ id: "bg-1", dryRun: true },
	)) as Record<string, unknown>;

	assert.deepEqual(response, {
		recordId: "bg-1",
		sessionId: "task-1",
		worktreePath,
		opened: false,
	});
	assert.deepEqual(ctx.events, []);
});

test("reveal_background_agent_worktree accepts a background-agent task id", async (t) => {
	const dataDir = withTempDataDir(t);
	const worktreePath = join(dataDir, "repo-background-agent-bg-1");
	mkdirSync(worktreePath);
	writeBackgroundAgentTaskRecordsFile(
		resolveBackgroundAgentRecordsPath(dataDir),
		[backgroundRecord({ worktreePath })],
	);
	const ctx = new HubContext();

	const response = (await handleDesktopCommand(
		ctx,
		"reveal_background_agent_worktree",
		{ sessionId: "task-1", dryRun: true },
	)) as Record<string, unknown>;

	assert.equal(response.recordId, "bg-1");
	assert.equal(response.sessionId, "task-1");
	assert.equal(response.worktreePath, worktreePath);
	assert.equal(response.opened, false);
});

test("open_background_agent_worktree rejects records without a worktree", async (t) => {
	const dataDir = withTempDataDir(t);
	writeBackgroundAgentTaskRecordsFile(
		resolveBackgroundAgentRecordsPath(dataDir),
		[backgroundRecord({ launchMode: "controller-record", worktreePath: undefined })],
	);
	const ctx = new HubContext();

	await assert.rejects(
		() =>
			handleDesktopCommand(ctx, "open_background_agent_worktree", {
				id: "bg-1",
				dryRun: true,
			}),
		/background agent record does not have a worktree path: bg-1/,
	);
});

test("open_background_agent_worktree rejects non-directory worktree paths", async (t) => {
	const dataDir = withTempDataDir(t);
	const worktreePath = join(dataDir, "not-a-directory");
	writeFileSync(worktreePath, "not a directory");
	writeBackgroundAgentTaskRecordsFile(
		resolveBackgroundAgentRecordsPath(dataDir),
		[backgroundRecord({ worktreePath })],
	);
	const ctx = new HubContext();

	await assert.rejects(
		() =>
			handleDesktopCommand(ctx, "open_background_agent_worktree", {
				id: "bg-1",
				dryRun: true,
			}),
		/background agent worktree path is not a directory:/,
	);
});
