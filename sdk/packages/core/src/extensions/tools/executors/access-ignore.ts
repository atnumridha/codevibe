import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentToolContext } from "@cline/shared";
import type { StructuredCommandInput } from "../schemas";

const DIRECT_ACCESS_IGNORE_FILES = [
	".clineignore",
	".cursorignore",
	".cursorindexingignore",
] as const;

type IgnoreRule = {
	pattern: string;
	negated: boolean;
	directoryOnly: boolean;
	anchored: boolean;
	hasSlash: boolean;
};

function normalizeRelativePath(relativePath: string): string {
	return relativePath
		.replace(/\\/g, "/")
		.replace(/^\.\/+/, "")
		.replace(/\/+/g, "/")
		.replace(/\/$/, "");
}

function parentDirs(relativePath: string): string[] {
	const segments = normalizeRelativePath(relativePath).split("/");
	const dirs: string[] = [];
	for (let i = 1; i < segments.length; i++) {
		dirs.push(segments.slice(0, i).join("/"));
	}
	return dirs;
}

function globSegmentToRegExp(segment: string): RegExp {
	let source = "";
	for (let i = 0; i < segment.length; i++) {
		const char = segment[i];
		if (char === "*") {
			source += "[^/]*";
			continue;
		}
		if (char === "?") {
			source += "[^/]";
			continue;
		}
		source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
	}
	return new RegExp(`^${source}$`);
}

function globPathToRegExp(pattern: string, anchored: boolean): RegExp {
	let source = "";
	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i];
		if (char === "*" && pattern[i + 1] === "*") {
			if (pattern[i + 2] === "/") {
				source += "(?:.*/)?";
				i += 2;
			} else {
				source += ".*";
				i++;
			}
			continue;
		}
		if (char === "*") {
			source += "[^/]*";
			continue;
		}
		if (char === "?") {
			source += "[^/]";
			continue;
		}
		source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
	}
	const prefix = anchored ? "^" : "^(?:.*/)?";
	return new RegExp(`${prefix}${source}$`);
}

function parseIgnoreContent(content: string): IgnoreRule[] {
	const rules: IgnoreRule[] = [];
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!include ")) {
			continue;
		}

		let pattern = trimmed;
		let negated = false;
		if (pattern.startsWith("!")) {
			negated = true;
			pattern = pattern.slice(1).trim();
		}
		if (!pattern) {
			continue;
		}

		const directoryOnly = pattern.endsWith("/");
		const anchored = pattern.startsWith("/") || pattern.includes("/");
		pattern = pattern.replace(/^\/+/, "").replace(/\/+$/, "");
		if (!pattern) {
			continue;
		}

		rules.push({
			pattern,
			negated,
			directoryOnly,
			anchored,
			hasSlash: pattern.includes("/"),
		});
	}
	return rules;
}

async function expandClineIgnoreIncludes(cwd: string, content: string): Promise<string> {
	const lines: string[] = [];
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("!include ")) {
			lines.push(line);
			continue;
		}

		const includePath = trimmed.substring("!include ".length).trim();
		if (!includePath) {
			continue;
		}

		try {
			lines.push(await fs.readFile(path.join(cwd, includePath), "utf8"));
		} catch {
			continue;
		}
	}
	return lines.join("\n");
}

async function readDirectAccessIgnoreRules(cwd: string): Promise<IgnoreRule[]> {
	const ruleSets = await Promise.all(
		DIRECT_ACCESS_IGNORE_FILES.map(async (fileName) => {
			try {
				const content = await fs.readFile(path.join(cwd, fileName), "utf8");
				const expandedContent =
					fileName === ".clineignore"
						? await expandClineIgnoreIncludes(cwd, content)
						: content;
				return [
					...parseIgnoreContent(expandedContent),
					{
						pattern: fileName,
						negated: false,
						directoryOnly: false,
						anchored: false,
						hasSlash: false,
					},
				] satisfies IgnoreRule[];
			} catch {
				return [];
			}
		}),
	);
	return ruleSets.flat();
}

function ruleMatches(relativePath: string, isDirectory: boolean, rule: IgnoreRule): boolean {
	const normalized = normalizeRelativePath(relativePath);
	if (!normalized) {
		return false;
	}

	const candidates = rule.directoryOnly
		? isDirectory
			? [normalized, ...parentDirs(normalized)]
			: parentDirs(normalized)
		: [normalized, ...parentDirs(normalized)];

	if (!rule.hasSlash) {
		return candidates.some((candidate) =>
			candidate.split("/").some((segment) => globSegmentToRegExp(rule.pattern).test(segment)),
		);
	}

	const matcher = globPathToRegExp(rule.pattern, rule.anchored);
	return candidates.some((candidate) => matcher.test(candidate));
}

export function getToolCwd(context: AgentToolContext, fallback = process.cwd()): string {
	const cwd = context.metadata?.cwd;
	return typeof cwd === "string" && cwd.trim() ? cwd : fallback;
}

export async function isPathAllowedByDirectAccessIgnores(
	cwd: string,
	targetPath: string,
	options: { isDirectory?: boolean } = {},
): Promise<boolean> {
	const absolutePath = path.isAbsolute(targetPath)
		? path.normalize(targetPath)
		: path.resolve(cwd, targetPath);
	const relativePath = path.relative(cwd, absolutePath);
	if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
		return true;
	}

	const rules = await readDirectAccessIgnoreRules(cwd);
	if (rules.length === 0) {
		return true;
	}

	let ignored = false;
	for (const rule of rules) {
		if (ruleMatches(relativePath, options.isDirectory === true, rule)) {
			ignored = !rule.negated;
		}
	}
	return !ignored;
}

export async function assertPathAllowedByDirectAccessIgnores(
	cwd: string,
	targetPath: string,
	options: { isDirectory?: boolean } = {},
): Promise<void> {
	if (!(await isPathAllowedByDirectAccessIgnores(cwd, targetPath, options))) {
		throw new Error(
			`Access to ${targetPath} is blocked by direct-access ignore settings (.clineignore, .cursorignore, or .cursorindexingignore).`,
		);
	}
}

const FILE_READING_COMMANDS = new Set([
	"cat",
	"less",
	"more",
	"head",
	"tail",
	"grep",
	"awk",
	"sed",
	"get-content",
	"gc",
	"type",
	"select-string",
	"sls",
]);

export async function findIgnoredPathInCommand(
	command: string | StructuredCommandInput,
	cwd: string,
): Promise<string | undefined> {
	const parts =
		typeof command === "string" ? command.trim().split(/\s+/) : [command.command, ...(command.args ?? [])];
	const baseCommand = parts[0]?.toLowerCase();
	if (!baseCommand || !FILE_READING_COMMANDS.has(baseCommand)) {
		return undefined;
	}

	for (let i = 1; i < parts.length; i++) {
		const arg = parts[i];
		if (!arg || arg.startsWith("-")) {
			continue;
		}
		if (arg.includes(":")) {
			continue;
		}
		if (!(await isPathAllowedByDirectAccessIgnores(cwd, arg))) {
			return arg;
		}
	}
	return undefined;
}
