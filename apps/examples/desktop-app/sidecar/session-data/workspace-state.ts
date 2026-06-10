import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
	WorkspaceChange,
	WorkspaceChangesResponse,
	WorkspaceDiffFile,
	WorkspaceDiffResponse,
	WorkspaceFileReadResponse,
} from "../types";
import type { SidecarContext } from "../types";

const DEFAULT_MAX_FILE_BYTES = 256 * 1024;
const DEFAULT_MAX_DIFF_BYTES = 512 * 1024;
const MAX_CHANGED_FILES = 500;

type GitStatusEntry = {
	indexStatus: string;
	worktreeStatus: string;
	path: string;
	originalPath?: string;
};

function toPosixPath(value: string): string {
	return value.split(sep).join("/");
}

function isInsideOrSame(parent: string, candidate: string): boolean {
	const rel = relative(parent, candidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertSafeRelativePath(path: string): string {
	const normalized = toPosixPath(path.trim());
	if (
		!normalized ||
		normalized.includes("\0") ||
		normalized.startsWith("/") ||
		normalized.split("/").includes("..")
	) {
		throw new Error(`unsafe workspace path: ${path}`);
	}
	return normalized;
}

function resolveWorkspaceRoot(
	ctx: Pick<SidecarContext, "workspaceRoot">,
	args?: Record<string, unknown>,
	command = "workspace state",
): string {
	const activeRoot = resolve(ctx.workspaceRoot);
	const requestedRoot =
		typeof args?.workspaceRoot === "string" && args.workspaceRoot.trim()
			? resolve(args.workspaceRoot.trim())
			: activeRoot;
	if (!isInsideOrSame(activeRoot, requestedRoot)) {
		throw new Error(
			`${command} workspaceRoot must be inside the active workspace`,
		);
	}
	return requestedRoot;
}

function resolveWorkspaceFilePath(root: string, requestedPath: string): string {
	const safePath = assertSafeRelativePath(requestedPath);
	const absolutePath = resolve(root, safePath);
	if (!isInsideOrSame(root, absolutePath)) {
		throw new Error("workspace file path must be inside the active workspace");
	}
	return absolutePath;
}

function runGit(
	root: string,
	args: string[],
	maxBuffer = DEFAULT_MAX_DIFF_BYTES * 4,
): string {
	return execFileSync("git", args, {
		cwd: root,
		encoding: "utf8",
		maxBuffer,
		stdio: ["ignore", "pipe", "pipe"],
	});
}

function parseGitStatusPorcelainZ(output: string): GitStatusEntry[] {
	const fields = output.split("\0").filter(Boolean);
	const entries: GitStatusEntry[] = [];

	for (let index = 0; index < fields.length; index += 1) {
		const field = fields[index] ?? "";
		const indexStatus = field[0] ?? " ";
		const worktreeStatus = field[1] ?? " ";
		const path = field.slice(3);
		const entry: GitStatusEntry = { indexStatus, worktreeStatus, path };

		if (
			(indexStatus === "R" ||
				indexStatus === "C" ||
				worktreeStatus === "R" ||
				worktreeStatus === "C") &&
			index + 1 < fields.length
		) {
			entry.originalPath = fields[++index];
		}

		entries.push(entry);
	}

	return entries;
}

function classifyChange(entry: GitStatusEntry): WorkspaceChange["kind"] {
	if (entry.indexStatus === "?" && entry.worktreeStatus === "?") {
		return "untracked";
	}
	if (entry.indexStatus === "D" || entry.worktreeStatus === "D") {
		return "deleted";
	}
	if (entry.indexStatus === "A" || entry.worktreeStatus === "A") {
		return "added";
	}
	if (entry.indexStatus === "R" || entry.worktreeStatus === "R") {
		return "renamed";
	}
	if (entry.indexStatus === "C" || entry.worktreeStatus === "C") {
		return "copied";
	}
	if (entry.indexStatus === "M" || entry.worktreeStatus === "M") {
		return "modified";
	}
	return "unknown";
}

function readStatus(root: string): WorkspaceChange[] {
	const output = runGit(root, ["status", "--porcelain=v1", "-z", "-uall"]);
	return parseGitStatusPorcelainZ(output)
		.slice(0, MAX_CHANGED_FILES)
		.map((entry) => ({
			path: toPosixPath(entry.path),
			...(entry.originalPath
				? { originalPath: toPosixPath(entry.originalPath) }
				: {}),
			kind: classifyChange(entry),
			indexStatus: entry.indexStatus,
			worktreeStatus: entry.worktreeStatus,
			staged: entry.indexStatus !== " " && entry.indexStatus !== "?",
			unstaged: entry.worktreeStatus !== " " && entry.worktreeStatus !== "?",
			untracked: entry.indexStatus === "?" && entry.worktreeStatus === "?",
		}));
}

function pushActiveHunk(
	file: WorkspaceDiffFile,
	activeHunk:
		| {
				oldStart: number;
				newStart: number;
				old: string[];
				new: string[];
		  }
		| undefined,
) {
	if (!activeHunk) {
		return;
	}
	if (activeHunk.old.length === 0 && activeHunk.new.length === 0) {
		return;
	}
	file.hunks.push({
		oldStart: activeHunk.oldStart,
		newStart: activeHunk.newStart,
		old: activeHunk.old.join("\n"),
		new: activeHunk.new.join("\n"),
	});
}

function parseUnifiedDiff(
	output: string,
	fallbackPath: string,
	truncated = false,
): WorkspaceDiffFile {
	const file: WorkspaceDiffFile = {
		path: fallbackPath,
		additions: 0,
		deletions: 0,
		hunks: [],
		truncated,
	};
	let activeHunk:
		| {
				oldStart: number;
				newStart: number;
				old: string[];
				new: string[];
		  }
		| undefined;

	for (const line of output.split("\n")) {
		if (line.startsWith("Binary files ")) {
			file.binary = true;
			continue;
		}
		if (line.startsWith("+++ b/")) {
			file.path = toPosixPath(line.slice("+++ b/".length));
			continue;
		}
		const hunkMatch = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
		if (hunkMatch) {
			pushActiveHunk(file, activeHunk);
			activeHunk = {
				oldStart: Number(hunkMatch[1]),
				newStart: Number(hunkMatch[2]),
				old: [],
				new: [],
			};
			continue;
		}
		if (!activeHunk) {
			continue;
		}
		if (line.startsWith("+") && !line.startsWith("+++")) {
			file.additions += 1;
			activeHunk.new.push(line.slice(1));
		} else if (line.startsWith("-") && !line.startsWith("---")) {
			file.deletions += 1;
			activeHunk.old.push(line.slice(1));
		}
	}
	pushActiveHunk(file, activeHunk);
	return file;
}

function readUntrackedFileDiff(
	root: string,
	change: WorkspaceChange,
	maxBytes: number,
): WorkspaceDiffFile {
	const absolutePath = resolveWorkspaceFilePath(root, change.path);
	if (!existsSync(absolutePath)) {
		return {
			path: change.path,
			additions: 0,
			deletions: 0,
			hunks: [],
			missing: true,
		};
	}
	const stats = statSync(absolutePath);
	if (!stats.isFile()) {
		return {
			path: change.path,
			additions: 0,
			deletions: 0,
			hunks: [],
			binary: false,
			truncated: false,
		};
	}
	const raw = readFileSync(absolutePath);
	const truncated = raw.byteLength > maxBytes;
	const slice = truncated ? raw.subarray(0, maxBytes) : raw;
	const binary = slice.includes(0);
	if (binary) {
		return {
			path: change.path,
			additions: 0,
			deletions: 0,
			hunks: [],
			binary: true,
			truncated,
		};
	}
	const content = slice.toString("utf8");
	const lines =
		content.length > 0 ? content.replace(/\n$/, "").split("\n") : [];
	return {
		path: change.path,
		additions: lines.length,
		deletions: 0,
		hunks:
			lines.length > 0
				? [
						{
							oldStart: 1,
							newStart: 1,
							old: "",
							new: lines.join("\n"),
						},
					]
				: [],
		truncated,
	};
}

function readTrackedFileDiff(
	root: string,
	change: WorkspaceChange,
	maxBytes: number,
): WorkspaceDiffFile {
	const output = runGit(root, [
		"diff",
		"--no-ext-diff",
		"HEAD",
		"--",
		change.path,
	]);
	const truncated = Buffer.byteLength(output, "utf8") > maxBytes;
	const diffText = truncated ? output.slice(0, maxBytes) : output;
	const parsed = parseUnifiedDiff(diffText, change.path, truncated);
	parsed.kind = change.kind;
	parsed.originalPath = change.originalPath;
	return parsed;
}

function summarize(files: WorkspaceDiffFile[]) {
	return files.reduce(
		(acc, file) => {
			acc.files += 1;
			acc.additions += file.additions;
			acc.deletions += file.deletions;
			return acc;
		},
		{ files: 0, additions: 0, deletions: 0 },
	);
}

function readMaxBytes(
	args: Record<string, unknown> | undefined,
	key: string,
	fallback: number,
): number {
	const value = args?.[key];
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(1024, Math.min(2 * 1024 * 1024, Math.trunc(value)))
		: fallback;
}

export function listWorkspaceChanges(
	ctx: Pick<SidecarContext, "workspaceRoot">,
	args?: Record<string, unknown>,
): WorkspaceChangesResponse {
	const workspaceRoot = resolveWorkspaceRoot(
		ctx,
		args,
		"list_workspace_changes",
	);
	const changes = readStatus(workspaceRoot);
	return {
		workspaceRoot,
		gitAvailable: true,
		changes,
		summary: {
			files: changes.length,
			additions: 0,
			deletions: 0,
		},
	};
}

export function readWorkspaceDiff(
	ctx: Pick<SidecarContext, "workspaceRoot">,
	args?: Record<string, unknown>,
): WorkspaceDiffResponse {
	const workspaceRoot = resolveWorkspaceRoot(ctx, args, "read_workspace_diff");
	const maxBytes = readMaxBytes(args, "maxBytes", DEFAULT_MAX_DIFF_BYTES);
	const requestedPath =
		typeof args?.path === "string" && args.path.trim()
			? assertSafeRelativePath(args.path)
			: undefined;
	const allChanges = readStatus(workspaceRoot);
	const changes = requestedPath
		? allChanges.filter((change) => change.path === requestedPath)
		: allChanges;
	const files = changes.map((change) =>
		change.untracked
			? readUntrackedFileDiff(workspaceRoot, change, maxBytes)
			: readTrackedFileDiff(workspaceRoot, change, maxBytes),
	);
	return {
		workspaceRoot,
		files,
		summary: summarize(files),
	};
}

export function readWorkspaceFile(
	ctx: Pick<SidecarContext, "workspaceRoot">,
	args?: Record<string, unknown>,
): WorkspaceFileReadResponse {
	const workspaceRoot = resolveWorkspaceRoot(ctx, args, "read_workspace_file");
	const requestedPath =
		typeof args?.path === "string" && args.path.trim() ? args.path : "";
	const safePath = assertSafeRelativePath(requestedPath);
	const absolutePath = resolveWorkspaceFilePath(workspaceRoot, safePath);
	const maxBytes = readMaxBytes(args, "maxBytes", DEFAULT_MAX_FILE_BYTES);
	const raw = readFileSync(absolutePath);
	const truncated = raw.byteLength > maxBytes;
	const slice = truncated ? raw.subarray(0, maxBytes) : raw;
	const binary = slice.includes(0);
	return {
		workspaceRoot,
		path: safePath,
		bytes: raw.byteLength,
		truncated,
		binary,
		content: binary ? "" : slice.toString("utf8"),
	};
}
