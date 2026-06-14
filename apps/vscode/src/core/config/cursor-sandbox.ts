import fs from "fs/promises"
import path from "path"
import { z } from "zod"
import type { CommandPermissionConfig } from "@core/permissions"

export const CODIE_SANDBOX_RELATIVE_PATH = path.join(".codie", "sandbox.json")
export const CURSOR_SANDBOX_RELATIVE_PATH = path.join(".cursor", "sandbox.json")
export type CursorSandboxConfigSource = "codie" | "cursorCompatibility"

export const CURSOR_SANDBOX_POLICY_SETTINGS = ["prompt", "workspace", "readOnly", "disabled"] as const
export type CursorSandboxPolicySetting = (typeof CURSOR_SANDBOX_POLICY_SETTINGS)[number]

export const CURSOR_SANDBOX_TYPES = ["workspace_readwrite", "workspace_readonly"] as const
export type CursorSandboxType = (typeof CURSOR_SANDBOX_TYPES)[number]

export type CursorSandboxEffectiveAccess = "prompt" | "workspace" | "readOnly"

export interface CursorSandboxNetworkPolicy {
	default: "allow" | "deny"
	allow: string[]
	deny?: string[]
}

export interface CursorSandboxConfig {
	type: CursorSandboxType
	additionalReadwritePaths: string[]
	additionalReadonlyPaths: string[]
	disableTmpWrite: boolean
	enableSharedBuildCache: boolean
	blockGitWrites: boolean
	networkPolicy: CursorSandboxNetworkPolicy
	networkPolicyStrict: boolean
}

export type CursorSandboxRuntimeStatus = "loaded" | "invalid"

export interface CursorSandboxRuntimePolicy {
	source: "cursor-sandbox"
	configSource?: CursorSandboxConfigSource
	status: CursorSandboxRuntimeStatus
	configPath: string
	workspaceRoot: string
	effectiveAccess: CursorSandboxEffectiveAccess
	config?: CursorSandboxConfig
	error?: string
	readablePaths: string[]
	writablePaths: string[]
	networkPolicy: CursorSandboxNetworkPolicy
	disableTmpWrite: boolean
	enableSharedBuildCache: boolean
	blockGitWrites: boolean
	allowReadAutoApprove: boolean
	allowWriteAutoApprove: boolean
	allowTerminalAutoApprove: boolean
	allowNetworkAutoApprove: boolean
	networkPolicyStrict?: boolean
	commandPermissions?: CommandPermissionConfig
}

export interface ResolveCursorSandboxPolicyOptions {
	workspaceRoot: string
	enabled?: boolean
	policySetting?: CursorSandboxPolicySetting | string
	configPath?: string
	logger?: Pick<typeof console, "warn">
}

export class CursorSandboxConfigError extends Error {
	readonly issues: string[]

	constructor(message: string, issues: string[] = []) {
		super(message)
		this.name = "CursorSandboxConfigError"
		this.issues = issues
	}
}

const pathListSchema = z.array(z.string().trim().min(1))

const networkPolicySchema = z
	.object({
		default: z.enum(["allow", "deny"]).optional(),
		defaultAction: z.enum(["allow", "deny", "unspecified"]).optional(),
		default_action: z.enum(["allow", "deny", "unspecified"]).optional(),
		allow: z.array(z.string().trim().min(1)).default([]),
		deny: z.array(z.string().trim().min(1)).optional(),
	})
	.passthrough()
	.superRefine((value, ctx) => {
		addAliasConflictIssue(value, ctx, "defaultAction", "default_action")
		const explicitDefault = value.default
		const cursorDefault = normalizeNetworkDefaultAction(value.defaultAction ?? value.default_action)
		if (explicitDefault && cursorDefault && explicitDefault !== cursorDefault) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["defaultAction"],
				message: "defaultAction conflicts with default",
			})
		}
	})

const rawCursorSandboxConfigSchema = z
	.object({
		type: z.enum(CURSOR_SANDBOX_TYPES).default("workspace_readwrite"),
		cwd: z.string().trim().min(1).optional(),
		additionalReadwritePaths: pathListSchema.optional(),
		additional_readwrite_paths: pathListSchema.optional(),
		additionalReadonlyPaths: pathListSchema.optional(),
		additional_readonly_paths: pathListSchema.optional(),
		disableTmpWrite: z.boolean().optional(),
		disable_tmp_write: z.boolean().optional(),
		enableSharedBuildCache: z.boolean().optional(),
		enable_shared_build_cache: z.boolean().optional(),
		networkPolicy: networkPolicySchema.optional(),
		network_policy: networkPolicySchema.optional(),
		networkAccess: z.boolean().optional(),
		network_access: z.boolean().optional(),
		networkPolicyStrict: z.boolean().optional(),
		network_policy_strict: z.boolean().optional(),
		blockGitWrites: z.boolean().optional(),
		block_git_writes: z.boolean().optional(),
		folders: pathListSchema.optional(),
	})
	.passthrough()
	.superRefine((value, ctx) => {
		addAliasConflictIssue(value, ctx, "additionalReadwritePaths", "additional_readwrite_paths")
		addAliasConflictIssue(value, ctx, "additionalReadonlyPaths", "additional_readonly_paths")
		addAliasConflictIssue(value, ctx, "disableTmpWrite", "disable_tmp_write")
		addAliasConflictIssue(value, ctx, "enableSharedBuildCache", "enable_shared_build_cache")
		addAliasConflictIssue(value, ctx, "networkPolicy", "network_policy")
		addAliasConflictIssue(value, ctx, "networkAccess", "network_access")
		addAliasConflictIssue(value, ctx, "networkPolicyStrict", "network_policy_strict")
		addAliasConflictIssue(value, ctx, "blockGitWrites", "block_git_writes")

		const networkPolicy = value.networkPolicy ?? value.network_policy
		const networkAccess = value.networkAccess ?? value.network_access
		const networkDefault = networkPolicy ? getNetworkPolicyDefault(networkPolicy, networkAccess) : undefined
		if (networkDefault && networkAccess !== undefined && (networkDefault === "allow") !== networkAccess) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["networkAccess"],
				message: "networkAccess conflicts with networkPolicy.default",
			})
		}
	})
	.transform((value): CursorSandboxConfig => {
		const networkAccess = value.networkAccess ?? value.network_access
		const networkPolicy = normalizeCursorSandboxNetworkPolicy(
			value.networkPolicy ?? value.network_policy,
			networkAccess,
		)

		return {
			type: value.type,
			additionalReadwritePaths: value.additionalReadwritePaths ?? value.additional_readwrite_paths ?? value.folders ?? [],
			additionalReadonlyPaths: value.additionalReadonlyPaths ?? value.additional_readonly_paths ?? [],
			disableTmpWrite: value.disableTmpWrite ?? value.disable_tmp_write ?? false,
			enableSharedBuildCache: value.enableSharedBuildCache ?? value.enable_shared_build_cache ?? false,
			blockGitWrites: value.blockGitWrites ?? value.block_git_writes ?? false,
			networkPolicyStrict: value.networkPolicyStrict ?? value.network_policy_strict ?? false,
			networkPolicy,
		}
	})

export const CursorSandboxConfigSchema = rawCursorSandboxConfigSchema

const READ_ONLY_COMMAND_ALLOW_PATTERNS = [
	"pwd",
	"ls",
	"ls *",
	"cat *",
	"head *",
	"tail *",
	"wc *",
	"rg *",
	"grep *",
	"git status",
	"git status *",
	"git diff",
	"git diff *",
	"git log",
	"git log *",
	"git show",
	"git show *",
] as const

const GIT_WRITE_COMMAND_DENY_PATTERNS = [
	"git add",
	"git add *",
	"git am",
	"git am *",
	"git apply",
	"git apply *",
	"git branch -d *",
	"git branch -D *",
	"git branch --delete *",
	"git branch -m *",
	"git branch -M *",
	"git branch --move *",
	"git branch -c *",
	"git branch -C *",
	"git branch --copy *",
	"git checkout",
	"git checkout *",
	"git cherry-pick",
	"git cherry-pick *",
	"git clean",
	"git clean *",
	"git clone",
	"git clone *",
	"git commit",
	"git commit *",
	"git merge",
	"git merge *",
	"git mv",
	"git mv *",
	"git pull",
	"git pull *",
	"git push",
	"git push *",
	"git rebase",
	"git rebase *",
	"git reset",
	"git reset *",
	"git restore",
	"git restore *",
	"git revert",
	"git revert *",
	"git rm",
	"git rm *",
	"git stash",
	"git stash *",
	"git submodule add *",
	"git submodule deinit *",
	"git submodule set-branch *",
	"git submodule set-url *",
	"git submodule sync *",
	"git submodule update *",
	"git switch",
	"git switch *",
	"git tag *",
	"git worktree add *",
	"git worktree move *",
	"git worktree remove *",
	"git worktree repair *",
] as const

export function normalizeCursorSandboxPolicySetting(value: unknown): CursorSandboxPolicySetting {
	return typeof value === "string" && CURSOR_SANDBOX_POLICY_SETTINGS.includes(value as CursorSandboxPolicySetting)
		? (value as CursorSandboxPolicySetting)
		: "prompt"
}

export function resolveCursorSandboxConfigPath(workspaceRoot: string): string {
	return resolveCodieSandboxConfigPath(workspaceRoot)
}

export function resolveCodieSandboxConfigPath(workspaceRoot: string): string {
	const root = workspaceRoot.trim()
	if (!root) {
		throw new Error("Workspace root is required to resolve .codie/sandbox.json.")
	}
	return path.join(root, CODIE_SANDBOX_RELATIVE_PATH)
}

export function resolveLegacyCursorSandboxConfigPath(workspaceRoot: string): string {
	const root = workspaceRoot.trim()
	if (!root) {
		throw new Error("Workspace root is required to resolve .cursor/sandbox.json.")
	}
	return path.join(root, CURSOR_SANDBOX_RELATIVE_PATH)
}

export function parseCursorSandboxConfig(value: unknown): CursorSandboxConfig {
	const result = CursorSandboxConfigSchema.safeParse(value)
	if (!result.success) {
		const issues = formatZodIssues(result.error)
		throw new CursorSandboxConfigError(`Invalid sandbox config: ${issues.join("; ")}`, issues)
	}
	return result.data
}

export async function loadCursorSandboxConfigFile(filePath: string): Promise<CursorSandboxConfig> {
	let parsed: unknown
	try {
		parsed = JSON.parse(await fs.readFile(filePath, "utf8"))
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new CursorSandboxConfigError(`Invalid JSON in sandbox config: ${error.message}`)
		}
		throw error
	}
	return parseCursorSandboxConfig(parsed)
}

export async function resolveCursorSandboxPolicy(
	options: ResolveCursorSandboxPolicyOptions,
): Promise<CursorSandboxRuntimePolicy | undefined> {
	if (options.enabled === false) {
		return undefined
	}

	const policySetting = normalizeCursorSandboxPolicySetting(options.policySetting)
	if (policySetting === "disabled") {
		return undefined
	}

	const configCandidate = await resolveSandboxConfigCandidate(options)
	if (!configCandidate) {
		return undefined
	}
	const { configPath, configSource } = configCandidate
	let config: CursorSandboxConfig
	try {
		config = await loadCursorSandboxConfigFile(configPath)
	} catch (error) {
		if (isMissingFileError(error)) {
			return undefined
		}

		const message = error instanceof Error ? error.message : String(error)
		options.logger?.warn(`[Codie Sandbox] ${message}`)
		return createRuntimePolicy({
			configPath,
			configSource,
			workspaceRoot: options.workspaceRoot,
			status: "invalid",
			error: message,
			config: {
				type: "workspace_readonly",
				additionalReadwritePaths: [],
				additionalReadonlyPaths: [],
				disableTmpWrite: true,
				enableSharedBuildCache: false,
				blockGitWrites: true,
				networkPolicy: { default: "deny", allow: [] },
				networkPolicyStrict: true,
			},
			policySetting: "readOnly",
		})
	}

	return createRuntimePolicy({
		configPath,
		configSource,
		workspaceRoot: options.workspaceRoot,
		status: "loaded",
		config,
		policySetting,
	})
}

export function isPathAllowedByCursorSandbox(
	filePath: string,
	allowedPaths: ReadonlyArray<string>,
): boolean {
	return allowedPaths.some((allowedPath) => isSamePathOrDescendant(allowedPath, filePath))
}

export function isCursorSandboxNetworkUrlAllowed(
	url: URL,
	networkPolicy: CursorSandboxNetworkPolicy,
): boolean {
	if ((networkPolicy.deny ?? []).some((entry) => doesCursorSandboxNetworkEntryMatch(entry, url))) {
		return false
	}
	if (networkPolicy.default === "allow") {
		return true
	}
	return networkPolicy.allow.some((entry) => doesCursorSandboxNetworkEntryMatch(entry, url))
}

export function doesCursorSandboxNetworkEntryMatch(entry: string, url: URL): boolean {
	const trimmed = entry.trim().toLowerCase()
	if (!trimmed) {
		return false
	}
	if (trimmed === "*") {
		return true
	}

	let hostPattern = trimmed
	let protocolPattern: string | undefined
	try {
		const parsedEntry = new URL(trimmed)
		hostPattern = parsedEntry.hostname.toLowerCase()
		protocolPattern = parsedEntry.protocol.toLowerCase()
	} catch {
		const protocolMatch = /^([a-z][a-z0-9+.-]*:)?\/\/(.+)$/i.exec(trimmed)
		if (protocolMatch) {
			protocolPattern = protocolMatch[1]?.toLowerCase()
			hostPattern = protocolMatch[2] ?? trimmed
		}
	}

	if (protocolPattern && protocolPattern !== url.protocol.toLowerCase()) {
		return false
	}
	if (hostPattern.startsWith("*.")) {
		return url.hostname.toLowerCase().endsWith(hostPattern.slice(1))
	}
	return url.hostname.toLowerCase() === hostPattern
}

function createRuntimePolicy(options: {
	configPath: string
	configSource: CursorSandboxConfigSource
	workspaceRoot: string
	status: CursorSandboxRuntimeStatus
	config: CursorSandboxConfig
	policySetting: CursorSandboxPolicySetting
	error?: string
}): CursorSandboxRuntimePolicy {
	const workspaceRoot = path.resolve(options.workspaceRoot)
	const effectiveAccess =
		options.policySetting === "readOnly" || options.config.type === "workspace_readonly"
			? "readOnly"
			: options.policySetting === "workspace"
				? "workspace"
				: "prompt"

	const additionalReadonlyPaths = normalizeSandboxPaths(workspaceRoot, options.config.additionalReadonlyPaths)
	const additionalReadwritePaths = normalizeSandboxPaths(workspaceRoot, options.config.additionalReadwritePaths)
	const readablePaths = dedupePaths([workspaceRoot, ...additionalReadonlyPaths, ...additionalReadwritePaths])
	const writablePaths =
		effectiveAccess === "workspace" && options.config.type === "workspace_readwrite"
			? dedupePaths([workspaceRoot, ...additionalReadwritePaths])
			: []
	const allowNetworkAutoApprove =
		options.config.networkPolicy.default === "allow" &&
		!options.config.networkPolicyStrict &&
		(options.config.networkPolicy.deny ?? []).length === 0
	const allowWriteAutoApprove = writablePaths.length > 0 && effectiveAccess === "workspace"
	const allowTerminalAutoApprove =
		effectiveAccess === "workspace" &&
		options.config.type === "workspace_readwrite" &&
		!options.config.disableTmpWrite &&
		allowNetworkAutoApprove

	return {
		source: "cursor-sandbox",
		configSource: options.configSource,
		status: options.status,
		configPath: options.configPath,
		workspaceRoot,
		effectiveAccess,
		config: options.config,
		error: options.error,
		readablePaths,
		writablePaths,
		networkPolicy: options.config.networkPolicy,
		networkPolicyStrict: options.config.networkPolicyStrict,
		disableTmpWrite: options.config.disableTmpWrite,
		enableSharedBuildCache: options.config.enableSharedBuildCache,
		blockGitWrites: options.config.blockGitWrites,
		allowReadAutoApprove: true,
		allowWriteAutoApprove,
		allowTerminalAutoApprove,
		allowNetworkAutoApprove,
		commandPermissions: createCommandPermissions(effectiveAccess, options.config.blockGitWrites),
	}
}

async function resolveSandboxConfigCandidate(options: ResolveCursorSandboxPolicyOptions): Promise<
	| {
			configPath: string
			configSource: CursorSandboxConfigSource
	  }
	| undefined
> {
	if (options.configPath) {
		return {
			configPath: options.configPath,
			configSource: isLegacyCursorSandboxConfigPath(options.configPath) ? "cursorCompatibility" : "codie",
		}
	}

	const codiePath = resolveCodieSandboxConfigPath(options.workspaceRoot)
	if (await pathExists(codiePath)) {
		return { configPath: codiePath, configSource: "codie" }
	}

	const cursorPath = resolveLegacyCursorSandboxConfigPath(options.workspaceRoot)
	if (await pathExists(cursorPath)) {
		return { configPath: cursorPath, configSource: "cursorCompatibility" }
	}

	return undefined
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch (error) {
		if (isMissingFileError(error)) {
			return false
		}
		throw error
	}
}

function isLegacyCursorSandboxConfigPath(filePath: string): boolean {
	const normalized = filePath.split(/[\\/]+/).join("/")
	return normalized.endsWith("/.cursor/sandbox.json") || normalized === ".cursor/sandbox.json"
}

function createCommandPermissions(
	effectiveAccess: CursorSandboxEffectiveAccess,
	blockGitWrites: boolean,
): CommandPermissionConfig | undefined {
	if (effectiveAccess === "readOnly") {
		return {
			allow: [...READ_ONLY_COMMAND_ALLOW_PATTERNS],
			deny: blockGitWrites ? [...GIT_WRITE_COMMAND_DENY_PATTERNS] : undefined,
			allowRedirects: false,
		}
	}

	if (blockGitWrites) {
		return {
			deny: [...GIT_WRITE_COMMAND_DENY_PATTERNS],
			allowRedirects: true,
		}
	}

	return undefined
}

function normalizeSandboxPaths(workspaceRoot: string, paths: ReadonlyArray<string>): string[] {
	return dedupePaths(paths.map((candidate) => path.resolve(workspaceRoot, candidate)))
}

function normalizeCursorSandboxNetworkPolicy(
	value: z.infer<typeof networkPolicySchema> | undefined,
	networkAccess: boolean | undefined,
): CursorSandboxNetworkPolicy {
	if (!value) {
		return { default: networkAccess === true ? "allow" : "deny", allow: [] }
	}

	const networkDefault = getNetworkPolicyDefault(value, networkAccess)
	const normalized: CursorSandboxNetworkPolicy = {
		default: networkDefault ?? "deny",
		allow: value.allow ?? [],
	}
	if (value.deny && value.deny.length > 0) {
		normalized.deny = value.deny
	}
	return normalized
}

function getNetworkPolicyDefault(
	value: z.infer<typeof networkPolicySchema>,
	networkAccess: boolean | undefined,
): CursorSandboxNetworkPolicy["default"] | undefined {
	return (
		value.default ??
		normalizeNetworkDefaultAction(value.defaultAction ?? value.default_action) ??
		(networkAccess === undefined ? undefined : networkAccess ? "allow" : "deny")
	)
}

function normalizeNetworkDefaultAction(value: "allow" | "deny" | "unspecified" | undefined) {
	return value === "unspecified" ? undefined : value
}

function dedupePaths(paths: ReadonlyArray<string>): string[] {
	const seen = new Set<string>()
	const deduped: string[] = []
	for (const candidate of paths) {
		const normalized = normalizeForComparison(candidate)
		if (seen.has(normalized)) {
			continue
		}
		seen.add(normalized)
		deduped.push(path.resolve(candidate))
	}
	return deduped
}

function isSamePathOrDescendant(basePath: string, candidatePath: string): boolean {
	const base = path.resolve(basePath)
	const candidate = path.resolve(candidatePath)
	const relative = path.relative(base, candidate)
	return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
}

function normalizeForComparison(candidate: string): string {
	const normalized = path.resolve(candidate)
	return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function isMissingFileError(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

function addAliasConflictIssue(
	value: Record<string, unknown>,
	ctx: z.RefinementCtx,
	preferredKey: string,
	aliasKey: string,
): void {
	if (value[preferredKey] === undefined || value[aliasKey] === undefined) {
		return
	}
	if (JSON.stringify(value[preferredKey]) === JSON.stringify(value[aliasKey])) {
		return
	}
	ctx.addIssue({
		code: z.ZodIssueCode.custom,
		path: [aliasKey],
		message: `${aliasKey} conflicts with ${preferredKey}`,
	})
}

function formatZodIssues(error: z.ZodError): string[] {
	return error.issues.map((issue) => {
		const location = issue.path.length > 0 ? issue.path.join(".") : "root"
		return `${location}: ${issue.message}`
	})
}
