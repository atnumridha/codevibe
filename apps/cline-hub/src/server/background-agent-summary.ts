import type { BackgroundAgentTaskRecord } from "@cline/core";
import type { WebviewSessionSummary } from "../webview-protocol";
import type { TrackedSession } from "./types";

function recordString(
	record: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = record?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function recordBoolean(
	record: Record<string, unknown> | undefined,
	key: string,
): boolean | undefined {
	const value = record?.[key];
	return typeof value === "boolean" ? value : undefined;
}

function stringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => (typeof entry === "string" ? entry.trim() : ""))
		.filter(Boolean);
}

function metadataRecord(session: TrackedSession): Record<string, unknown> {
	return session.metadata && typeof session.metadata === "object"
		? session.metadata
		: {};
}

function nestedRecord(
	record: Record<string, unknown>,
	key: string,
): Record<string, unknown> | undefined {
	const value = record[key];
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function isBackgroundAgentSession(session: TrackedSession): boolean {
	const metadata = metadataRecord(session);
	const cursor = nestedRecord(metadata, "cursor") ?? {};
	return (
		recordBoolean(metadata, "backgroundAgent") === true ||
		recordBoolean(cursor, "background") === true ||
		recordString(cursor, "route") === "background-agent" ||
		recordString(cursor, "path") === "/background-agent"
	);
}

export function backgroundAgentDetailsFor(
	session: TrackedSession,
): Record<string, unknown> {
	const metadata = metadataRecord(session);
	const cursor = nestedRecord(metadata, "cursor") ?? {};
	const details = nestedRecord(metadata, "backgroundAgentDetails") ?? {};
	const configKeys = stringArray(details.configKeys);
	return {
		route:
			recordString(details, "route") ??
			recordString(cursor, "route") ??
			"background-agent",
		path:
			recordString(details, "path") ??
			recordString(cursor, "path") ??
			"/background-agent",
		...(recordString(details, "id") ? { id: recordString(details, "id") } : {}),
		...(recordString(details, "status")
			? { status: recordString(details, "status") }
			: {}),
		...(recordString(details, "launchMode")
			? { launchMode: recordString(details, "launchMode") }
			: {}),
		...(recordString(details, "repository")
			? { repository: recordString(details, "repository") }
			: {}),
		...(recordString(details, "requestedBranch")
			? { requestedBranch: recordString(details, "requestedBranch") }
			: {}),
		...(recordString(details, "requestedBaseBranch")
			? { requestedBaseBranch: recordString(details, "requestedBaseBranch") }
			: {}),
		...(recordString(details, "workspaceRoot")
			? { workspaceRoot: recordString(details, "workspaceRoot") }
			: {}),
		...(recordString(details, "worktreePath")
			? { worktreePath: recordString(details, "worktreePath") }
			: {}),
		...(recordString(details, "worktreeBranch")
			? { worktreeBranch: recordString(details, "worktreeBranch") }
			: {}),
		...(recordString(details, "worktreeBaseRef")
			? { worktreeBaseRef: recordString(details, "worktreeBaseRef") }
			: {}),
		...(recordString(details, "fallbackReason")
			? { fallbackReason: recordString(details, "fallbackReason") }
			: {}),
		...(recordString(details, "warning")
			? { warning: recordString(details, "warning") }
			: {}),
		...(recordString(details, "taskId")
			? { taskId: recordString(details, "taskId") }
			: {}),
		...(recordString(details, "errorMessage")
			? { errorMessage: recordString(details, "errorMessage") }
			: {}),
		...(configKeys.length > 0 ? { configKeys } : {}),
		agentMode: recordString(details, "agentMode") ?? "plan",
		confirmationRequired:
			recordBoolean(details, "confirmationRequired") ?? true,
		autoApprovalProfile:
			recordString(details, "autoApprovalProfile") ??
			"read-only-plan-confirmation-required",
		worktreePolicy:
			recordString(details, "worktreePolicy") ?? "confirm-before-create",
	};
}

function backgroundAgentLifecycleDetails(
	record: BackgroundAgentTaskRecord,
): Record<string, unknown> {
	return {
		route: "background-agent",
		path: "/background-agent",
		id: record.id,
		status: record.status,
		...(record.launchMode ? { launchMode: record.launchMode } : {}),
		agentMode: record.agentMode,
		confirmationRequired: record.confirmationRequired,
		autoApprovalProfile: record.autoApprovalProfile,
		worktreePolicy: record.worktreePolicy,
		...(record.repository ? { repository: record.repository } : {}),
		...(record.requestedBranch
			? { requestedBranch: record.requestedBranch }
			: {}),
		...(record.requestedBaseBranch
			? { requestedBaseBranch: record.requestedBaseBranch }
			: {}),
		...(record.workspaceRoot ? { workspaceRoot: record.workspaceRoot } : {}),
		...(record.worktreePath ? { worktreePath: record.worktreePath } : {}),
		...(record.worktreeBranch
			? { worktreeBranch: record.worktreeBranch }
			: {}),
		...(record.worktreeBaseRef
			? { worktreeBaseRef: record.worktreeBaseRef }
			: {}),
		...(record.fallbackReason
			? { fallbackReason: record.fallbackReason }
			: {}),
		...(record.warning ? { warning: record.warning } : {}),
		...(record.taskId ? { taskId: record.taskId } : {}),
		...(record.errorMessage ? { errorMessage: record.errorMessage } : {}),
	};
}

export function toBackgroundAgentLifecycleSessionSummary(
	record: BackgroundAgentTaskRecord,
): WebviewSessionSummary {
	const sessionId = record.taskId ?? record.id;
	const title =
		record.prompt.length > 34
			? `${record.prompt.slice(0, 31)}...`
			: record.prompt;
	return {
		sessionId,
		title,
		status: record.status,
		source: record.source,
		workspaceRoot: record.worktreePath ?? record.workspaceRoot,
		updatedAt: record.updatedAt,
		backgroundAgent: true,
		backgroundAgentDetails: backgroundAgentLifecycleDetails(record),
	};
}
