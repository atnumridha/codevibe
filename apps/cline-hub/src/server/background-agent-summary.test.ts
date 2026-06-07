import assert from "node:assert/strict";
import test from "node:test";
import type { BackgroundAgentTaskRecord } from "@cline/core";
import type { TrackedSession } from "./types";

const {
	isBackgroundAgentSession,
	toBackgroundAgentLifecycleSessionSummary,
	backgroundAgentDetailsFor,
} = (await import(
	new URL("./background-agent-summary.ts", import.meta.url).href
)) as typeof import("./background-agent-summary");

test("background-agent live details preserve lifecycle metadata", () => {
	const session: TrackedSession = {
		sessionId: "task-1",
		status: "running",
		title: "Fix queue",
		workspaceRoot: "/workspace/repo",
		cwd: "/workspace/repo",
		provider: "openai-codex",
		model: "gpt-5.5",
		source: "cursor-deeplink",
		createdAt: 1000,
		updatedAt: 2000,
		agentCount: 1,
		participantCount: 1,
		metadata: {
			backgroundAgent: true,
			cursor: {
				route: "background-agent",
				path: "/background-agent",
			},
			backgroundAgentDetails: {
				id: "bg-1",
				status: "running",
				launchMode: "controller-record",
				repository: "owner/repo",
				requestedBranch: "feature/safe",
				workspaceRoot: "/workspace/repo",
				fallbackReason: "Worktrees are disabled",
				taskId: "task-1",
				agentMode: "plan",
				confirmationRequired: true,
				autoApprovalProfile: "read-only-plan-confirmation-required",
				worktreePolicy: "confirm-before-create",
			},
		},
	};

	assert.equal(isBackgroundAgentSession(session), true);
	const details = backgroundAgentDetailsFor(session);
	assert.equal(details.id, "bg-1");
	assert.equal(details.status, "running");
	assert.equal(details.launchMode, "controller-record");
	assert.equal(details.fallbackReason, "Worktrees are disabled");
	assert.equal(details.taskId, "task-1");
});

test("background-agent lifecycle record summaries expose persisted launch state", () => {
	const record: BackgroundAgentTaskRecord = {
		id: "bg-2",
		source: "cursor-deeplink",
		status: "running",
		agentMode: "plan",
		autoApprovalProfile: "read-only-plan-confirmation-required",
		worktreePolicy: "confirm-before-create",
		launchMode: "worktree",
		createdAt: 1000,
		updatedAt: 3000,
		prompt: "Investigate flaky queue retries in the background",
		routePrompt: "Original prompt",
		repository: "owner/repo",
		requestedBranch: "feature/safe",
		requestedBaseBranch: "main",
		workspaceRoot: "/workspace/repo",
		worktreePath: "/workspace/repo-background-agent-bg-2",
		worktreeBranch: "background-agent/investigate-bg-2",
		worktreeBaseRef: "main",
		confirmationRequired: true,
		taskId: "task-2",
	};

	const summary = toBackgroundAgentLifecycleSessionSummary(record);
	const details = summary.backgroundAgentDetails ?? {};
	assert.equal(summary.sessionId, "task-2");
	assert.equal(summary.status, "running");
	assert.equal(summary.source, "cursor-deeplink");
	assert.equal(summary.workspaceRoot, "/workspace/repo-background-agent-bg-2");
	assert.equal(summary.backgroundAgent, true);
	assert.equal(details.id, "bg-2");
	assert.equal(details.launchMode, "worktree");
	assert.equal(details.repository, "owner/repo");
	assert.equal(details.requestedBaseBranch, "main");
	assert.equal(details.worktreeBranch, "background-agent/investigate-bg-2");
	assert.equal(details.taskId, "task-2");
});
