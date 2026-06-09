import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, resolve, sep } from "node:path";
import { buildCursorRuleRouteRequest } from "@cline/core";
import { workspaceRoot } from "./deps";
import type { JsonRecord } from "./types";
import { asTrimmedString, openExternalUrl } from "./utils";

function titleFromCursorRuleFilename(filename: string): string {
	const base =
		filename === ".cursorrules"
			? "project rules"
			: basename(filename, extname(filename));
	return base
		.replace(/[-_]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildCursorRuleStarterContent(filename: string): string {
	const title = titleFromCursorRuleFilename(filename) || "Project Rules";
	if (filename.endsWith(".mdc")) {
		return [
			"---",
			`description: ${title}`,
			"alwaysApply: false",
			"---",
			"",
			`# ${title}`,
			"",
			"Add agent guidance for this rule here.",
			"",
		].join("\n");
	}
	return [`# ${title}`, "", "Add project-wide agent guidance here.", ""].join(
		"\n",
	);
}

function resolveWorkspaceFilePath(rootPath: string, relativePath: string): string {
	const root = resolve(rootPath);
	const filePath = resolve(root, relativePath);
	if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
		throw new Error("Rule target escaped the workspace root");
	}
	return filePath;
}

export function openCursorRule(args?: JsonRecord): JsonRecord {
	const uri = asTrimmedString(args?.uri);
	if (!uri) {
		throw new Error("cursor_rule_open requires a non-empty uri");
	}
	const requestedWorkspaceRoot =
		asTrimmedString(args?.workspaceRoot) ?? workspaceRoot;
	const request = buildCursorRuleRouteRequest(uri);
	const confirmed = args?.confirmed === true;
	if (request.kind === "review") {
		return {
			handled: true,
			route: "rule",
			kind: "review",
			confirmed,
			actionable: false,
			created: false,
			opened: false,
			workspaceRoot: requestedWorkspaceRoot,
			reason: request.reason,
			...(request.name ? { name: request.name } : {}),
			...(request.path ? { path: request.path } : {}),
		};
	}

	const filePath = resolveWorkspaceFilePath(
		requestedWorkspaceRoot,
		request.relativePath,
	);
	const existed = existsSync(filePath);
	if (!confirmed) {
		return {
			handled: true,
			route: "rule",
			kind: "file",
			confirmed: false,
			actionable: true,
			created: false,
			opened: false,
			workspaceRoot: requestedWorkspaceRoot,
			filename: request.filename,
			relativePath: request.relativePath,
			filePath,
		};
	}

	if (!existed) {
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, buildCursorRuleStarterContent(request.filename));
	}
	if (args?.open !== false) {
		openExternalUrl(filePath);
	}
	return {
		handled: true,
		route: "rule",
		kind: "file",
		confirmed: true,
		actionable: true,
		created: !existed,
		opened: args?.open !== false,
		workspaceRoot: requestedWorkspaceRoot,
		filename: request.filename,
		relativePath: request.relativePath,
		filePath,
	};
}
