import { execFileSync } from "node:child_process";
import { buildCursorAgentTaskRouteRequest } from "@cline/core";
import { workspaceRoot } from "./deps";
import type { JsonRecord } from "./types";
import { asTrimmedString } from "./utils";
import { resolveWorkspaceSubpath } from "./workspace-boundary";

type GitStatusEntry = {
	status: string;
	path: string;
	originalPath?: string;
};

function getCursorRouteString(
	params: Record<string, string | Record<string, unknown>>,
	key: string,
): string | undefined {
	const value = params[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getCursorRouteBoolean(
	params: Record<string, string | Record<string, unknown>>,
	key: string,
): boolean {
	const value = getCursorRouteString(params, key)?.toLowerCase();
	return value === "true" || value === "1" || value === "yes";
}

function splitCursorGitFiles(value: string | undefined): string[] {
	if (!value) {
		return [];
	}
	return value
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function assertSafeGitPathspecs(files: string[]): void {
	for (const file of files) {
		if (
			file.includes("\0") ||
			file.startsWith("/") ||
			file.split(/[\\/]+/).includes("..")
		) {
			throw new Error(`unsafe git pathspec: ${file}`);
		}
	}
}

function parseGitStatusPorcelainZ(output: string): GitStatusEntry[] {
	const fields = output.split("\0").filter(Boolean);
	const entries: GitStatusEntry[] = [];

	for (let index = 0; index < fields.length; index++) {
		const field = fields[index];
		const status = field.slice(0, 2);
		const path = field.startsWith(`${status} `)
			? field.slice(3)
			: field.slice(2).trimStart();
		const entry: GitStatusEntry = { status, path };

		if (
			(status[0] === "R" ||
				status[0] === "C" ||
				status[1] === "R" ||
				status[1] === "C") &&
			index + 1 < fields.length
		) {
			entry.originalPath = fields[++index];
		}

		entries.push(entry);
	}

	return entries;
}

function readGitStatusPorcelain(cwd: string): GitStatusEntry[] {
	try {
		const output = execFileSync("git", ["status", "--porcelain", "-z"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return parseGitStatusPorcelainZ(output);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`failed to read git status: ${message}`);
	}
}

function hasStagedGitChanges(cwd: string): boolean {
	const staged = execFileSync("git", ["diff", "--cached", "--name-only"], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
	return staged.length > 0;
}

function readGitCurrentBranch(cwd: string): string | undefined {
	try {
		const branch = execFileSync("git", ["branch", "--show-current"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
		return branch || undefined;
	} catch {
		return undefined;
	}
}

function getGitCommandOutput(args: string[], cwd: string): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

export function runCursorGitAction(args?: JsonRecord): JsonRecord {
	const uri = asTrimmedString(args?.uri);
	if (!uri) {
		throw new Error("cursor_git_action requires a non-empty uri");
	}
	const requestedWorkspaceRoot =
		resolveWorkspaceSubpath(
			workspaceRoot,
			asTrimmedString(args?.workspaceRoot),
			"cursor_git_action",
		);
	const request = buildCursorAgentTaskRouteRequest(uri);
	const confirmed = args?.confirmed === true;
	if (
		request.kind !== "git-checkout" &&
		request.kind !== "git-branch" &&
		request.kind !== "git-commit"
	) {
		throw new Error(`cursor_git_action does not support ${request.kind}`);
	}

	const status = readGitStatusPorcelain(requestedWorkspaceRoot);
	const dirty = status.length > 0;
	const baseResponse = {
		handled: true,
		route: "git",
		kind: request.kind,
		confirmed,
		workspaceRoot: requestedWorkspaceRoot,
		paramKeys: Object.keys(request.params).sort(),
		currentBranch: readGitCurrentBranch(requestedWorkspaceRoot),
		dirty,
		statusEntryCount: status.length,
	};

	if (request.kind === "git-checkout") {
		const target =
			getCursorRouteString(request.params, "branch") ??
			getCursorRouteString(request.params, "ref") ??
			getCursorRouteString(request.params, "target") ??
			"";
		const command = ["git", "checkout", target];
		if (dirty) {
			return {
				...baseResponse,
				actionable: false,
				executed: false,
				target,
				command,
				reason:
					"Working tree has uncommitted changes; checkout needs manual review.",
			};
		}
		if (!confirmed) {
			return {
				...baseResponse,
				actionable: true,
				executed: false,
				target,
				command,
			};
		}
		getGitCommandOutput(["checkout", target], requestedWorkspaceRoot);
		return {
			...baseResponse,
			actionable: true,
			executed: true,
			target,
			command,
			currentBranch: readGitCurrentBranch(requestedWorkspaceRoot),
		};
	}

	if (request.kind === "git-branch") {
		const branch =
			getCursorRouteString(request.params, "name") ??
			getCursorRouteString(request.params, "branch") ??
			"";
		const base =
			getCursorRouteString(request.params, "baseBranch") ??
			getCursorRouteString(request.params, "base");
		const checkout = getCursorRouteBoolean(request.params, "checkout");
		const command = checkout
			? ["git", "checkout", "-b", branch, ...(base ? [base] : [])]
			: ["git", "branch", branch, ...(base ? [base] : [])];
		if (checkout && dirty) {
			return {
				...baseResponse,
				actionable: false,
				executed: false,
				branch,
				...(base ? { base } : {}),
				checkout,
				command,
				reason:
					"Working tree has uncommitted changes; branch checkout needs manual review.",
			};
		}
		if (!confirmed) {
			return {
				...baseResponse,
				actionable: true,
				executed: false,
				branch,
				...(base ? { base } : {}),
				checkout,
				command,
			};
		}
		getGitCommandOutput(command.slice(1), requestedWorkspaceRoot);
		return {
			...baseResponse,
			actionable: true,
			executed: true,
			branch,
			...(base ? { base } : {}),
			checkout,
			command,
			currentBranch: readGitCurrentBranch(requestedWorkspaceRoot),
		};
	}

	const message =
		getCursorRouteString(request.params, "message") ??
		getCursorRouteString(request.params, "summary");
	const files = splitCursorGitFiles(getCursorRouteString(request.params, "files"));
	const all = getCursorRouteBoolean(request.params, "all");
	const amend = getCursorRouteBoolean(request.params, "amend");
	const push = getCursorRouteBoolean(request.params, "push");
	const command = [
		"git",
		"commit",
		...(amend ? ["--amend"] : []),
		...(message ? ["-m", message] : []),
	];
	if (push) {
		return {
			...baseResponse,
			actionable: false,
			executed: false,
			...(message ? { message } : {}),
			command,
			reason:
				"Direct push from Cursor git commit deeplinks requires separate manual confirmation.",
		};
	}
	if (!message) {
		return {
			...baseResponse,
			actionable: false,
			executed: false,
			command,
			reason:
				"Git commit deeplink requires a message or summary before committing.",
		};
	}
	assertSafeGitPathspecs(files);
	if (!confirmed) {
		return {
			...baseResponse,
			actionable: true,
			executed: false,
			message,
			command,
		};
	}
	if (all) {
		getGitCommandOutput(["add", "-A"], requestedWorkspaceRoot);
	} else if (files.length > 0) {
		getGitCommandOutput(["add", "--", ...files], requestedWorkspaceRoot);
	}
	if (!hasStagedGitChanges(requestedWorkspaceRoot)) {
		return {
			...baseResponse,
			actionable: false,
			executed: false,
			message,
			command,
			reason: "No staged changes are available to commit.",
		};
	}
	getGitCommandOutput(command.slice(1), requestedWorkspaceRoot);
	const commitHash = getGitCommandOutput(
		["rev-parse", "--short", "HEAD"],
		requestedWorkspaceRoot,
	);
	return {
		...baseResponse,
		actionable: true,
		executed: true,
		message,
		command,
		commitHash,
		currentBranch: readGitCurrentBranch(requestedWorkspaceRoot),
	};
}
