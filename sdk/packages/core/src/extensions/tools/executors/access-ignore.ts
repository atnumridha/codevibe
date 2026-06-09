import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentToolContext } from "@cline/shared";
import { CURSOR_SANDBOX_READ_ONLY_COMMAND_ALLOW_PATTERNS } from "../../../runtime/config/cursor-sandbox";
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
	blockGitWrites?: unknown;
	effectiveAccess?: unknown;
};

export type CursorSandboxAccessKind = "read" | "write";

const GIT_WRITE_SUBCOMMANDS = new Set([
	"add",
	"am",
	"apply",
	"checkout",
	"cherry-pick",
	"clean",
	"clone",
	"commit",
	"merge",
	"mv",
	"pull",
	"push",
	"rebase",
	"reset",
	"restore",
	"revert",
	"rm",
	"stash",
	"switch",
]);

const GIT_BRANCH_WRITE_FLAGS = new Set([
	"-d",
	"-D",
	"-m",
	"-M",
	"-c",
	"-C",
	"--delete",
	"--move",
	"--copy",
	"--edit-description",
	"--set-upstream-to",
	"--unset-upstream",
]);

const GIT_SUBMODULE_WRITE_SUBCOMMANDS = new Set([
	"add",
	"absorbgitdirs",
	"deinit",
	"set-branch",
	"set-url",
	"sync",
	"update",
]);

const GIT_WORKTREE_WRITE_SUBCOMMANDS = new Set([
	"add",
	"move",
	"prune",
	"remove",
	"repair",
]);

const GIT_GLOBAL_OPTIONS_WITH_VALUE = new Set([
	"-c",
	"--config-env",
	"--exec-path",
	"--git-dir",
	"--namespace",
	"--super-prefix",
	"--work-tree",
]);

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
			const resolvedIncludePath = await resolveClineIgnoreIncludePath(cwd, includePath);
			if (!resolvedIncludePath) {
				continue;
			}
			lines.push(await fs.readFile(resolvedIncludePath, "utf8"));
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

function doesCursorSandboxBlockGitWrites(context: AgentToolContext): boolean {
	return getCursorSandboxPolicy(context)?.blockGitWrites === true;
}

function doesCursorSandboxRequireReadOnlyCommands(
	context: AgentToolContext,
): boolean {
	return getCursorSandboxPolicy(context)?.effectiveAccess === "readOnly";
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

async function resolveClineIgnoreIncludePath(
	cwd: string,
	includePath: string,
): Promise<string | undefined> {
	if (
		!includePath ||
		path.isAbsolute(includePath) ||
		path.win32.isAbsolute(includePath) ||
		/^[a-zA-Z]:/.test(includePath)
	) {
		return undefined;
	}

	const resolvedPath = path.resolve(cwd, includePath);
	if (!isSamePathOrDescendant(cwd, resolvedPath)) {
		return undefined;
	}

	try {
		const [workspaceRoot, realIncludePath] = await Promise.all([
			fs.realpath(cwd),
			fs.realpath(resolvedPath),
		]);
		if (!isSamePathOrDescendant(workspaceRoot, realIncludePath)) {
			return undefined;
		}

		const stat = await fs.stat(realIncludePath);
		return stat.isFile() ? realIncludePath : undefined;
	} catch {
		return resolvedPath;
	}
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

export function findCursorSandboxBlockedGitWriteInCommand(
	command: string | StructuredCommandInput,
	context: AgentToolContext,
): string | undefined {
	if (!doesCursorSandboxBlockGitWrites(context)) {
		return undefined;
	}

	for (const parts of getCommandSegmentsForGitPolicy(command)) {
		if (isGitWriteCommand(parts)) {
			return parts.join(" ");
		}
	}
	return undefined;
}

export function findCursorSandboxBlockedReadOnlyCommand(
	command: string | StructuredCommandInput,
	context: AgentToolContext,
): string | undefined {
	if (!doesCursorSandboxRequireReadOnlyCommands(context)) {
		return undefined;
	}

	if (typeof command === "string" && findUnsafeReadOnlyShellToken(command)) {
		return command.trim() || command;
	}

	for (const parts of getCommandSegmentsForGitPolicy(command)) {
		const segment = parts.join(" ").trim();
		if (!segment) {
			continue;
		}
		if (!matchesReadOnlyCommandPattern(segment)) {
			return segment;
		}
	}
	return undefined;
}

function findUnsafeReadOnlyShellToken(command: string): string | undefined {
	let inSingleQuote = false;
	let inDoubleQuote = false;
	let isEscaped = false;

	for (let index = 0; index < command.length; index++) {
		const char = command[index];

		if (isEscaped) {
			isEscaped = false;
			continue;
		}
		if (char === "\\" && !inSingleQuote) {
			isEscaped = true;
			continue;
		}
		if (char === "'" && !inDoubleQuote) {
			inSingleQuote = !inSingleQuote;
			continue;
		}
		if (char === '"' && !inSingleQuote) {
			inDoubleQuote = !inDoubleQuote;
			continue;
		}

		const inAnyQuote = inSingleQuote || inDoubleQuote;
		if (!inAnyQuote && /[\n\r\u2028\u2029\u0085]/.test(char)) {
			return "\\n";
		}
		if (!inAnyQuote && (char === ">" || char === "<")) {
			return char;
		}
		if (!inSingleQuote && char === "`") {
			return "`";
		}
		if (!inSingleQuote && char === "$" && command[index + 1] === "(") {
			return "$(";
		}
	}

	return undefined;
}

function matchesReadOnlyCommandPattern(command: string): boolean {
	return CURSOR_SANDBOX_READ_ONLY_COMMAND_ALLOW_PATTERNS.some((pattern) =>
		matchesCommandPattern(command, pattern),
	);
}

function matchesCommandPattern(command: string, pattern: string): boolean {
	const regex = new RegExp(
		`^${pattern
			.replace(/[.+^${}()|[\]\\]/g, "\\$&")
			.replace(/\*/g, ".*")
			.replace(/\?/g, ".")}$`,
		"s",
	);
	return regex.test(command);
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

function getCommandSegmentsForGitPolicy(
	command: string | StructuredCommandInput,
): string[][] {
	if (typeof command !== "string") {
		return [[command.command, ...(command.args ?? [])].filter(Boolean)];
	}

	return command
		.split(/\s*(?:&&|\|\||[;|])\s*/g)
		.map((segment) => segment.trim().split(/\s+/).filter(Boolean))
		.filter((parts) => parts.length > 0);
}

function isGitWriteCommand(parts: string[]): boolean {
	const gitIndex = parts.findIndex((part) => getExecutableName(part) === "git");
	if (gitIndex < 0) {
		return false;
	}

	const subcommandIndex = findGitSubcommandIndex(parts, gitIndex + 1);
	if (subcommandIndex < 0) {
		return false;
	}

	const subcommand = normalizeCommandToken(parts[subcommandIndex]);
	const args = parts.slice(subcommandIndex + 1).map(normalizeCommandToken);
	if (GIT_WRITE_SUBCOMMANDS.has(subcommand)) {
		return true;
	}
	if (subcommand === "branch") {
		return isGitBranchWrite(args);
	}
	if (subcommand === "submodule") {
		return GIT_SUBMODULE_WRITE_SUBCOMMANDS.has(args[0] ?? "");
	}
	if (subcommand === "tag") {
		return args.length > 0;
	}
	if (subcommand === "worktree") {
		return GIT_WORKTREE_WRITE_SUBCOMMANDS.has(args[0] ?? "");
	}
	return false;
}

function findGitSubcommandIndex(parts: string[], startIndex: number): number {
	for (let index = startIndex; index < parts.length; index++) {
		const token = normalizeCommandToken(parts[index]);
		if (!token) {
			continue;
		}
		if (token === "--") {
			continue;
		}
		if (GIT_GLOBAL_OPTIONS_WITH_VALUE.has(token)) {
			index++;
			continue;
		}
		if ([...GIT_GLOBAL_OPTIONS_WITH_VALUE].some((option) => token.startsWith(`${option}=`))) {
			continue;
		}
		if (token.startsWith("-")) {
			continue;
		}
		return index;
	}
	return -1;
}

function isGitBranchWrite(args: string[]): boolean {
	if (args.length === 0) {
		return false;
	}
	if (args.some((arg) => GIT_BRANCH_WRITE_FLAGS.has(arg))) {
		return true;
	}
	if (args.some((arg) => [...GIT_BRANCH_WRITE_FLAGS].some((flag) => arg.startsWith(`${flag}=`)))) {
		return true;
	}
	return args.some((arg) => !arg.startsWith("-"));
}

function getExecutableName(command: string): string {
	return normalizeCommandToken(path.basename(command));
}

function normalizeCommandToken(value: string | undefined): string {
	return (value ?? "").replace(/^['"]|['"]$/g, "").toLowerCase();
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
			`Access to ${targetPath} is blocked by direct-access ignore settings (.codevibeignore, legacy .clineignore, .cursorignore, or .cursorindexingignore).`,
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
