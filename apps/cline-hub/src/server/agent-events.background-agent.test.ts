import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	type BackgroundAgentTaskRecord,
	readBackgroundAgentTaskRecordsFile,
	resolveBackgroundAgentRecordsPath,
	writeBackgroundAgentTaskRecordsFile,
} from "@cline/core";
import { handleSessionEvent } from "./agent-events";
import { HubContext } from "./state";

function withTempDataDir(t: test.TestContext): string {
	const dir = mkdtempSync(join(tmpdir(), "cline-hub-background-agent-events-"));
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

test("ended session events mark persisted background-agent records completed", (t) => {
	const dataDir = withTempDataDir(t);
	const recordsPath = resolveBackgroundAgentRecordsPath(dataDir);
	writeBackgroundAgentTaskRecordsFile(recordsPath, [backgroundRecord()]);
	const ctx = new HubContext();

	handleSessionEvent(ctx, {
		type: "ended",
		payload: { sessionId: "task-1", reason: "completed" },
	} as Parameters<typeof handleSessionEvent>[1]);

	const [record] = readBackgroundAgentTaskRecordsFile(recordsPath);
	assert.equal(record?.status, "completed");
	assert.equal(record?.taskId, "task-1");
	assert.ok((record?.updatedAt ?? 0) > 2000);
});

test("ended cancellation events mark persisted background-agent records cancelled", (t) => {
	const dataDir = withTempDataDir(t);
	const recordsPath = resolveBackgroundAgentRecordsPath(dataDir);
	writeBackgroundAgentTaskRecordsFile(recordsPath, [backgroundRecord()]);
	const ctx = new HubContext();

	handleSessionEvent(ctx, {
		type: "ended",
		payload: { sessionId: "task-1", reason: "user cancelled" },
	} as Parameters<typeof handleSessionEvent>[1]);

	const [record] = readBackgroundAgentTaskRecordsFile(recordsPath);
	assert.equal(record?.status, "cancelled");
});
