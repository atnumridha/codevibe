export type SessionHistoryStatus =
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "idle";

export type SessionMetadata = {
	title?: string;
	[key: string]: unknown;
};

export interface SessionHistoryItem {
	sessionId: string;
	status: SessionHistoryStatus;
	provider: string;
	model: string;
	cwd: string;
	workspaceRoot: string;
	parentSessionId?: string;
	isSubagent?: boolean;
	prompt?: string;
	startedAt: string;
	endedAt?: string;
	metadata?: SessionMetadata;
	backgroundAgent?: boolean;
}

export function getSessionMetadataTitle(metadata?: SessionMetadata): string {
	if (!metadata) {
		return "";
	}
	return typeof metadata.title === "string" ? metadata.title.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isBackgroundAgentSession(
	metadata?: SessionMetadata,
): boolean {
	if (!metadata) {
		return false;
	}
	if (metadata.backgroundAgent === true) {
		return true;
	}
	const cursor = metadata.cursor;
	if (!isRecord(cursor)) {
		return false;
	}
	return (
		cursor.background === true ||
		cursor.backgroundAgent === true ||
		cursor.route === "background-agent" ||
		cursor.path === "/background-agent"
	);
}
