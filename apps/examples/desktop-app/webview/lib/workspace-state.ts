import type {
	SessionDiffHunk,
	SessionDiffSummary,
	SessionFileDiff,
} from "@/lib/session-diff";

export type WorkspaceDiffHunk = SessionDiffHunk;

export type WorkspaceDiffFile = {
	path: string;
	originalPath?: string;
	kind?: string;
	additions: number;
	deletions: number;
	hunks: WorkspaceDiffHunk[];
	binary?: boolean;
	missing?: boolean;
	truncated?: boolean;
};

export type WorkspaceDiffSummary = {
	files: number;
	additions: number;
	deletions: number;
};

export type WorkspaceDiffResponse = {
	workspaceRoot: string;
	files: WorkspaceDiffFile[];
	summary: WorkspaceDiffSummary;
};

export type WorkspaceFileReadResponse = {
	workspaceRoot: string;
	path: string;
	bytes: number;
	truncated: boolean;
	binary: boolean;
	content: string;
};

export function normalizeWorkspaceDiffResponse(
	response: WorkspaceDiffResponse,
): {
	fileDiffs: SessionFileDiff[];
	summary: SessionDiffSummary;
} {
	const fileDiffs = response.files.map((file) => ({
		path: file.originalPath
			? `${file.originalPath} -> ${file.path}`
			: file.path,
		additions: file.additions,
		deletions: file.deletions,
		hunks: file.hunks,
	}));
	const summary = fileDiffs.reduce(
		(acc, file) => {
			acc.additions += file.additions;
			acc.deletions += file.deletions;
			return acc;
		},
		{ additions: 0, deletions: 0 },
	);
	return { fileDiffs, summary };
}
