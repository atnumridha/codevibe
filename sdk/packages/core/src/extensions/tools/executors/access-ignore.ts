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

type CursorSandboxMetadataPolicy = {
	source?: unknown;
	readablePaths?: unknown;
	writablePaths?: unknown;
	networkPolicy?: unknown;
};

export type CursorSandboxAccessKind = "read" | "write";

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

function getCursorSandboxPolicy(
	context: AgentToolContext,
): CursorSandboxMetadataPolicy | undefined {
	const policy = context.metadata?.cursorSandboxPolicy;
	if (
		typeof policy !== "object" ||
		policy === null ||
		(policy as CursorSandboxMetadataPolicy).source !== "cursor-sandbox"
	) {
		return undefined;
	}
	return policy as CursorSandboxMetadataPolicy;
}

function getCursorSandboxAllowedPaths(
	policy: CursorSandboxMetadataPolicy,
	accessKind: CursorSandboxAccessKind,
): string[] {
	const rawPaths =
		accessKind === "write" ? policy.writablePaths : policy.readablePaths;
	if (!Array.isArray(rawPaths)) {
		return [];
	}
	return rawPaths.filter(
		(entry): entry is string =>
			typeof entry === "string" && entry.trim().length > 0,
	);
}

function isSamePathOrDescendant(parentPath: string, filePath: string): boolean {
	const parent = path.resolve(parentPath);
	const child = path.resolve(filePath);
	const relativePath = path.relative(parent, child);
	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
	);
}

function isPathAllowedByCursorSandboxPaths(
	filePath: string,
	allowedPaths: ReadonlyArray<string>,
): boolean {
	return allowedPaths.some((allowedPath) =>
		isSamePathOrDescendant(allowedPath, filePath),
	);
}

export function isPathAllowedByCursorSandboxPolicy(
	context: AgentToolContext,
	cwd: string,
	targetPath: string,
	accessKind: CursorSandboxAccessKind,
): boolean {
	const policy = getCursorSandboxPolicy(context);
	if (!policy) {
		return true;
	}

	const allowedPaths = getCursorSandboxAllowedPaths(policy, accessKind);
	if (allowedPaths.length === 0) {
		return false;
	}

	const absolutePath = path.isAbsolute(targetPath)
		? path.normalize(targetPath)
		: path.resolve(cwd, targetPath);
	return isPathAllowedByCursorSandboxPaths(absolutePath, allowedPaths);
}

export function assertPathAllowedByCursorSandboxPolicy(
	context: AgentToolContext,
	cwd: string,
	targetPath: string,
	accessKind: CursorSandboxAccessKind,
): void {
	if (
		!isPathAllowedByCursorSandboxPolicy(context, cwd, targetPath, accessKind)
	) {
		throw new Error(
			`Access to ${targetPath} is outside Cursor sandbox ${accessKind} paths from .cursor/sandbox.json.`,
		);
	}
}

export function isUrlAllowedByCursorSandboxPolicy(
	context: AgentToolContext,
	url: URL,
): boolean {
	const policy = getCursorSandboxPolicy(context);
	if (!policy) {
		return true;
	}
	const networkPolicy = policy.networkPolicy;
	if (
		typeof networkPolicy !== "object" ||
		networkPolicy === null ||
		(networkPolicy as { default?: unknown }).default !== "deny"
	) {
		return true;
	}

	const allow = (networkPolicy as { allow?: unknown }).allow;
	if (!Array.isArray(allow)) {
		return false;
	}
	return allow.some((entry) =>
		typeof entry === "string" && doesNetworkAllowEntryMatch(entry, url),
	);
}

export function assertUrlAllowedByCursorSandboxPolicy(
	context: AgentToolContext,
	url: URL,
): void {
	if (!isUrlAllowedByCursorSandboxPolicy(context, url)) {
		throw new Error(
			`Network access to ${url.hostname} is blocked by .cursor/sandbox.json networkPolicy.`,
		);
	}
}

function doesNetworkAllowEntryMatch(entry: string, url: URL): boolean {
	const trimmed = entry.trim().toLowerCase();
	if (!trimmed) {
		return false;
	}
	if (trimmed === "*") {
		return true;
	}

	let hostPattern = trimmed;
	let protocolPattern: string | undefined;
	try {
		const parsedEntry = new URL(trimmed);
		hostPattern = parsedEntry.hostname.toLowerCase();
		protocolPattern = parsedEntry.protocol.toLowerCase();
	} catch {
		const protocolMatch = /^([a-z][a-z0-9+.-]*:)?\/\/(.+)$/i.exec(trimmed);
		if (protocolMatch) {
			protocolPattern = protocolMatch[1]?.toLowerCase();
			hostPattern = protocolMatch[2] ?? trimmed;
		}
	}

	if (protocolPattern && protocolPattern !== url.protocol.toLowerCase()) {
		return false;
	}
	if (hostPattern.startsWith("*.")) {
		const suffix = hostPattern.slice(1);
		return url.hostname.toLowerCase().endsWith(suffix);
	}
	return url.hostname.toLowerCase() === hostPattern;
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

export function findCursorSandboxViolationInCommand(
	command: string | StructuredCommandInput,
	cwd: string,
	context: AgentToolContext,
): string | undefined {
	const parts =
		typeof command === "string"
			? command.trim().split(/\s+/)
			: [command.command, ...(command.args ?? [])];
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
		if (!isPathAllowedByCursorSandboxPolicy(context, cwd, arg, "read")) {
			return arg;
		}
	}
	return undefined;
}
