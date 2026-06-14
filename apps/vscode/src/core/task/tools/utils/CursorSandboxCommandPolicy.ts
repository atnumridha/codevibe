import os from "os"
import path from "path"
import { parse, type ParseEntry } from "shell-quote"
import {
	isCursorSandboxNetworkUrlAllowed,
	isPathAllowedByCursorSandbox,
	type CursorSandboxRuntimePolicy,
} from "@core/config/cursor-sandbox"
import type { CodeVibeTerminalRunMode } from "@shared/terminalPolicy"

export type CursorSandboxCommandPreflightResult = { ok: true } | { ok: false; error: string }

export interface CursorSandboxCommandPreflightInput {
	command: string
	executionDir: string
	policy?: CursorSandboxRuntimePolicy
	terminalRunMode: CodeVibeTerminalRunMode
}

type SandboxAccessKind = "read" | "write"

interface SegmentToken {
	value: string
	redirectAccess?: SandboxAccessKind
}

interface PathCandidate {
	displayPath: string
	absolutePath: string
	accessKind: SandboxAccessKind
}

const COMMAND_SEPARATOR_OPERATORS = new Set(["&&", "||", "|", "|&", ";", "&", "(", ")"])
const READ_REDIRECT_OPERATORS = new Set(["<", "<&"])
const WRITE_REDIRECT_OPERATORS = new Set([">", ">>", ">&"])

const PRIVILEGED_WRAPPER_COMMANDS = new Set(["sudo", "su", "doas", "pkexec"])
const OPAQUE_SHELL_EVALUATORS = new Map<string, Set<string>>([
	["bash", new Set(["-c"])],
	["cmd", new Set(["/c"])],
	["fish", new Set(["-c"])],
	["sh", new Set(["-c"])],
	["zsh", new Set(["-c"])],
	["powershell", new Set(["-command", "-c"])],
	["pwsh", new Set(["-command", "-c"])],
])
const OPAQUE_INLINE_EVALUATORS = new Map<string, Set<string>>([
	["node", new Set(["-e", "--eval", "-p", "--print"])],
	["perl", new Set(["-e"])],
	["php", new Set(["-r"])],
	["python", new Set(["-c"])],
	["python3", new Set(["-c"])],
	["ruby", new Set(["-e"])],
])
const COMMAND_WRAPPERS = new Set(["command", "builtin", "nohup", "time"])
const READ_ONLY_COMMANDS = new Set(["cat", "find", "git", "grep", "head", "less", "ls", "more", "pwd", "rg", "stat", "tail", "wc"])
const GIT_READ_ONLY_SUBCOMMANDS = new Set(["diff", "log", "show", "status"])
const ALL_PATH_ARGS_ARE_WRITES = new Set(["chmod", "chown", "mkdir", "rm", "rmdir", "tee", "touch", "unlink"])
const LAST_PATH_ARG_IS_WRITE = new Set(["cp", "install", "mv", "rsync"])

export function validateCursorSandboxTerminalPreflight(
	input: CursorSandboxCommandPreflightInput,
): CursorSandboxCommandPreflightResult {
	const { command, executionDir, policy, terminalRunMode } = input
	if (terminalRunMode === "elevated") {
		return { ok: true }
	}

	if (!policy) {
		if (terminalRunMode === "sandboxed") {
			return {
				ok: false,
				error:
					`Codie sandbox blocked terminal command "${truncateCommand(command)}" because no enforceable sandbox policy is active. ` +
					"Choose unelevated terminal mode to use current terminal permissions, or elevated terminal mode to run it intentionally.",
			}
		}

		return { ok: true }
	}

	const executionDirAccess: SandboxAccessKind = policy.writablePaths.length > 0 ? "write" : "read"
	if (!isAllowedByPolicy(executionDir, executionDirAccess, policy)) {
		return {
			ok: false,
			error: formatSandboxPathError({
				command,
				displayPath: executionDir,
				accessKind: executionDirAccess,
				reason: "execution directory",
			}),
		}
	}

	const parseResult = parseCommandSegments(command)
	if (!parseResult.ok) {
		return {
			ok: false,
			error: `Codie sandbox blocked terminal command "${truncateCommand(command)}" because the shell command could not be parsed safely.`,
		}
	}

	for (const segment of parseResult.segments) {
		const commandIndex = findExecutableTokenIndex(segment)
		if (commandIndex === undefined) {
			continue
		}

		const commandName = normalizeCommandName(segment[commandIndex].value)
		if (PRIVILEGED_WRAPPER_COMMANDS.has(commandName)) {
			return {
				ok: false,
				error:
					`Codie sandbox blocked terminal command "${truncateCommand(command)}" because "${commandName}" ` +
					"requires elevated terminal mode.",
			}
		}

		if (isOpaqueInlineEvaluator(commandName, segment, commandIndex)) {
			return {
				ok: false,
				error:
					`Codie sandbox blocked terminal command "${truncateCommand(command)}" because "${commandName}" ` +
					"can hide filesystem or network access inside inline code. Choose elevated terminal mode to run it intentionally.",
			}
		}

		if (policy.writablePaths.length === 0 && !isReadOnlySegment(commandName, segment, commandIndex)) {
			return {
				ok: false,
				error:
					`Codie sandbox blocked terminal command "${truncateCommand(command)}" because read-only sandbox mode ` +
					`does not allow "${commandName}". Choose elevated terminal mode to run it intentionally.`,
			}
		}

		const networkError = validateSegmentNetworkAccess(command, segment, policy)
		if (networkError) {
			return { ok: false, error: networkError }
		}

		for (const candidate of collectPathCandidates(segment, commandIndex, executionDir)) {
			if (!isAllowedByPolicy(candidate.absolutePath, candidate.accessKind, policy)) {
				return {
					ok: false,
					error: formatSandboxPathError({
						command,
						displayPath: candidate.displayPath,
						accessKind: candidate.accessKind,
						reason: "path argument",
					}),
				}
			}
		}
	}

	return { ok: true }
}

function parseCommandSegments(command: string): { ok: true; segments: SegmentToken[][] } | { ok: false } {
	let entries: ParseEntry[]
	try {
		entries = parse(command)
	} catch {
		return { ok: false }
	}

	const segments: SegmentToken[][] = []
	let currentSegment: SegmentToken[] = []
	let nextRedirectAccess: SandboxAccessKind | undefined

	const flushSegment = () => {
		if (currentSegment.length > 0) {
			segments.push(currentSegment)
			currentSegment = []
		}
	}

	for (const entry of entries) {
		const operator = getOperator(entry)
		if (operator) {
			if (READ_REDIRECT_OPERATORS.has(operator)) {
				nextRedirectAccess = "read"
				continue
			}
			if (WRITE_REDIRECT_OPERATORS.has(operator)) {
				nextRedirectAccess = "write"
				continue
			}
			if (COMMAND_SEPARATOR_OPERATORS.has(operator)) {
				flushSegment()
				nextRedirectAccess = undefined
				continue
			}
		}

		const value = getEntryText(entry)
		if (!value) {
			continue
		}

		currentSegment.push({ value, redirectAccess: nextRedirectAccess })
		nextRedirectAccess = undefined
	}

	flushSegment()
	return { ok: true, segments }
}

function findExecutableTokenIndex(segment: readonly SegmentToken[]): number | undefined {
	for (let index = 0; index < segment.length; index++) {
		const value = segment[index].value
		const commandName = normalizeCommandName(value)
		if (isEnvironmentAssignment(value)) {
			continue
		}
		if (commandName === "env") {
			index = skipEnvPrefix(segment, index)
			continue
		}
		if (COMMAND_WRAPPERS.has(commandName)) {
			continue
		}
		return index
	}
	return undefined
}

function skipEnvPrefix(segment: readonly SegmentToken[], envIndex: number): number {
	let index = envIndex
	while (index + 1 < segment.length) {
		const nextValue = segment[index + 1].value
		if (isEnvironmentAssignment(nextValue) || nextValue.startsWith("-")) {
			index++
			continue
		}
		break
	}
	return index
}

function collectPathCandidates(
	segment: readonly SegmentToken[],
	commandIndex: number,
	executionDir: string,
): PathCandidate[] {
	const candidates: PathCandidate[] = []
	const commandName = normalizeCommandName(segment[commandIndex].value)
	const pathArgs: Array<{ token: SegmentToken; value: string; accessKind?: SandboxAccessKind }> = []

	const commandToken = segment[commandIndex]
	if (isPathLike(commandToken.value) && !isKnownSystemExecutablePath(commandToken.value)) {
		pathArgs.push({ token: commandToken, value: commandToken.value, accessKind: "read" })
	}

	for (let index = commandIndex + 1; index < segment.length; index++) {
		const token = segment[index]
		const flagPathValue = getFlagPathValue(token.value)
		if (flagPathValue) {
			pathArgs.push({ token, value: flagPathValue, accessKind: token.redirectAccess })
			continue
		}
		if (token.value.startsWith("-") && !token.redirectAccess) {
			continue
		}
		if (!isPathLike(token.value) && !doesCommandTreatBareArgAsPath(commandName)) {
			continue
		}
		pathArgs.push({ token, value: token.value, accessKind: token.redirectAccess })
	}

	for (let index = 0; index < pathArgs.length; index++) {
		const pathArg = pathArgs[index]
		const accessKind =
			pathArg.accessKind ?? inferPathAccessKind(commandName, index, pathArgs.length, segment.map((token) => token.value))
		candidates.push({
			displayPath: pathArg.value,
			absolutePath: resolveShellPath(executionDir, pathArg.value),
			accessKind,
		})
	}

	return candidates
}

function inferPathAccessKind(
	commandName: string,
	pathArgIndex: number,
	pathArgCount: number,
	segmentValues: readonly string[],
): SandboxAccessKind {
	if (ALL_PATH_ARGS_ARE_WRITES.has(commandName)) {
		return "write"
	}
	if (LAST_PATH_ARG_IS_WRITE.has(commandName) && pathArgIndex === pathArgCount - 1) {
		return "write"
	}
	if (commandName === "sed" && segmentValues.some((value) => value === "-i" || value.startsWith("-i"))) {
		return "write"
	}
	return "read"
}

function doesCommandTreatBareArgAsPath(commandName: string): boolean {
	return (
		ALL_PATH_ARGS_ARE_WRITES.has(commandName) ||
		LAST_PATH_ARG_IS_WRITE.has(commandName) ||
		["cat", "head", "less", "ls", "more", "stat", "tail", "wc"].includes(commandName)
	)
}

function isReadOnlySegment(
	commandName: string,
	segment: readonly SegmentToken[],
	commandIndex: number,
): boolean {
	if (commandName === "git") {
		const subcommand = segment
			.slice(commandIndex + 1)
			.map((token) => token.value)
			.find((value) => value && !value.startsWith("-"))
		return Boolean(subcommand && GIT_READ_ONLY_SUBCOMMANDS.has(subcommand))
	}
	return READ_ONLY_COMMANDS.has(commandName)
}

function isOpaqueInlineEvaluator(
	commandName: string,
	segment: readonly SegmentToken[],
	commandIndex: number,
): boolean {
	const flags = OPAQUE_SHELL_EVALUATORS.get(commandName) ?? OPAQUE_INLINE_EVALUATORS.get(commandName)
	if (!flags) {
		return false
	}
	return segment
		.slice(commandIndex + 1)
		.some((token) => isOpaqueEvaluatorFlag(token.value, flags))
}

function isOpaqueEvaluatorFlag(value: string, flags: ReadonlySet<string>): boolean {
	const lowerValue = value.toLowerCase()
	if (flags.has(lowerValue) || [...flags].some((flag) => lowerValue.startsWith(`${flag}=`))) {
		return true
	}
	if (!lowerValue.startsWith("-") || lowerValue.startsWith("--")) {
		return false
	}
	return [...flags].some((flag) => flag.length === 2 && lowerValue.includes(flag[1]))
}

function validateSegmentNetworkAccess(
	command: string,
	segment: readonly SegmentToken[],
	policy: CursorSandboxRuntimePolicy,
): string | undefined {
	if (policy.networkPolicy.default !== "deny") {
		return undefined
	}
	for (const token of segment) {
		const url = parseHttpUrl(token.value)
		if (!url) {
			continue
		}
		if (isCursorSandboxNetworkUrlAllowed(url, policy.networkPolicy)) {
			continue
		}
		return (
			`Codie sandbox blocked terminal command "${truncateCommand(command)}" because network access to ` +
			`${url.hostname} is not allowed by the active sandbox networkPolicy.`
		)
	}
	return undefined
}

function isAllowedByPolicy(
	absolutePath: string,
	accessKind: SandboxAccessKind,
	policy: CursorSandboxRuntimePolicy,
): boolean {
	const allowedPaths = accessKind === "write" ? policy.writablePaths : policy.readablePaths
	return allowedPaths.length > 0 && isPathAllowedByCursorSandbox(absolutePath, allowedPaths)
}

function isPathLike(value: string): boolean {
	const trimmed = value.trim()
	if (!trimmed || parseHttpUrl(trimmed)) {
		return false
	}
	if (trimmed === "." || trimmed === "..") {
		return true
	}
	if (path.isAbsolute(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
		return true
	}
	if (trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed.startsWith("~/")) {
		return true
	}
	return trimmed.includes("/") || trimmed.includes("\\")
}

function resolveShellPath(executionDir: string, value: string): string {
	if (value === "~") {
		return os.homedir()
	}
	if (value.startsWith("~/")) {
		return path.join(os.homedir(), value.slice(2))
	}
	return path.isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value)
		? path.resolve(value)
		: path.resolve(executionDir, value)
}

function getFlagPathValue(value: string): string | undefined {
	if (!value.startsWith("-")) {
		return undefined
	}
	const equalsIndex = value.indexOf("=")
	if (equalsIndex === -1) {
		return undefined
	}
	const candidate = value.slice(equalsIndex + 1)
	return isPathLike(candidate) ? candidate : undefined
}

function isEnvironmentAssignment(value: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*=.+/.test(value)
}

function normalizeCommandName(value: string): string {
	return path.basename(value).toLowerCase()
}

function isKnownSystemExecutablePath(value: string): boolean {
	const absolutePath = resolveShellPath("/", value)
	return (
		absolutePath.startsWith("/bin/") ||
		absolutePath.startsWith("/sbin/") ||
		absolutePath.startsWith("/usr/bin/") ||
		absolutePath.startsWith("/usr/sbin/") ||
		absolutePath.startsWith("/usr/local/bin/") ||
		absolutePath.startsWith("/opt/homebrew/bin/")
	)
}

function parseHttpUrl(value: string): URL | undefined {
	try {
		const url = new URL(value)
		return ["http:", "https:", "ws:", "wss:"].includes(url.protocol) ? url : undefined
	} catch {
		return undefined
	}
}

function getOperator(entry: ParseEntry): string | undefined {
	return typeof entry === "object" && "op" in entry && entry.op !== "glob" ? entry.op : undefined
}

function getEntryText(entry: ParseEntry): string | undefined {
	if (typeof entry === "string") {
		return entry
	}
	if (typeof entry === "object" && "pattern" in entry) {
		return entry.pattern
	}
	return undefined
}

function formatSandboxPathError(input: {
	command: string
	displayPath: string
	accessKind: SandboxAccessKind
	reason: string
}): string {
	return (
		`Codie sandbox blocked terminal command "${truncateCommand(input.command)}": ${input.reason} ` +
		`"${input.displayPath}" is outside sandbox ${input.accessKind} paths from the active sandbox config. ` +
		"Choose elevated terminal mode to run it intentionally."
	)
}

function truncateCommand(command: string): string {
	const normalized = command.replace(/\s+/g, " ").trim()
	return normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized
}
