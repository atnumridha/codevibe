import fs from "fs/promises"
import path from "path"
import { z } from "zod"
import type { CommandPermissionConfig } from "@core/permissions"

export const CURSOR_SANDBOX_RELATIVE_PATH = path.join(".cursor", "sandbox.json")

export const CURSOR_SANDBOX_POLICY_SETTINGS = ["prompt", "workspace", "readOnly", "disabled"] as const
export type CursorSandboxPolicySetting = (typeof CURSOR_SANDBOX_POLICY_SETTINGS)[number]

export const CURSOR_SANDBOX_TYPES = ["workspace_readwrite", "workspace_readonly"] as const
export type CursorSandboxType = (typeof CURSOR_SANDBOX_TYPES)[number]

export type CursorSandboxEffectiveAccess = "prompt" | "workspace" | "readOnly"

export interface CursorSandboxNetworkPolicy {
	default: "allow" | "deny"
	allow: string[]
}

export interface CursorSandboxConfig {
	type: CursorSandboxType
	additionalReadwritePaths: string[]
	additionalReadonlyPaths: string[]
	disableTmpWrite: boolean
	enableSharedBuildCache: boolean
	networkPolicy: CursorSandboxNetworkPolicy
}

export type CursorSandboxRuntimeStatus = "loaded" | "invalid"

export interface CursorSandboxRuntimePolicy {
	source: "cursor-sandbox"
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
	allowReadAutoApprove: boolean
	allowWriteAutoApprove: boolean
	allowTerminalAutoApprove: boolean
	allowNetworkAutoApprove: boolean
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
		default: z.enum(["allow", "deny"]).default("deny"),
		allow: z.array(z.string().trim().min(1)).default([]),
	})
	.passthrough()

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
		addAliasConflictIssue(value, ctx, "blockGitWrites", "block_git_writes")

		const networkPolicy = value.networkPolicy ?? value.network_policy
		const networkAccess = value.networkAccess ?? value.network_access
		if (networkPolicy && networkAccess !== undefined && (networkPolicy.default === "allow") !== networkAccess) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["networkAccess"],
				message: "networkAccess conflicts with networkPolicy.default",
			})
		}
	})
	.transform((value): CursorSandboxConfig => {
		const networkAccess = value.networkAccess ?? value.network_access
		const networkPolicy =
			value.networkPolicy ??
			value.network_policy ??
			({
				default: networkAccess === true ? "allow" : "deny",
				allow: [],
			} as CursorSandboxNetworkPolicy)

		return {
			type: value.type,
			additionalReadwritePaths: value.additionalReadwritePaths ?? value.additional_readwrite_paths ?? value.folders ?? [],
			additionalReadonlyPaths: value.additionalReadonlyPaths ?? value.additional_readonly_paths ?? [],
			disableTmpWrite: value.disableTmpWrite ?? value.disable_tmp_write ?? false,
			enableSharedBuildCache: value.enableSharedBuildCache ?? value.enable_shared_build_cache ?? false,
			networkPolicy: {
				default: networkPolicy.default,
				allow: networkPolicy.allow ?? [],
			},
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

export function normalizeCursorSandboxPolicySetting(value: unknown): CursorSandboxPolicySetting {
	return typeof value === "string" && CURSOR_SANDBOX_POLICY_SETTINGS.includes(value as CursorSandboxPolicySetting)
		? (value as CursorSandboxPolicySetting)
		: "prompt"
}

export function resolveCursorSandboxConfigPath(workspaceRoot: string): string {
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
		throw new CursorSandboxConfigError(`Invalid .cursor/sandbox.json: ${issues.join("; ")}`, issues)
	}
	return result.data
}

export async function loadCursorSandboxConfigFile(filePath: string): Promise<CursorSandboxConfig> {
	let parsed: unknown
	try {
		parsed = JSON.parse(await fs.readFile(filePath, "utf8"))
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new CursorSandboxConfigError(`Invalid JSON in .cursor/sandbox.json: ${error.message}`)
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

	const configPath = options.configPath ?? resolveCursorSandboxConfigPath(options.workspaceRoot)
	let config: CursorSandboxConfig
	try {
		config = await loadCursorSandboxConfigFile(configPath)
	} catch (error) {
		if (isMissingFileError(error)) {
			return undefined
		}

		const message = error instanceof Error ? error.message : String(error)
		options.logger?.warn(`[Cursor Sandbox] ${message}`)
		return createRuntimePolicy({
			configPath,
			workspaceRoot: options.workspaceRoot,
			status: "invalid",
			error: message,
			config: {
				type: "workspace_readonly",
				additionalReadwritePaths: [],
				additionalReadonlyPaths: [],
				disableTmpWrite: true,
				enableSharedBuildCache: false,
				networkPolicy: { default: "deny", allow: [] },
			},
			policySetting: "readOnly",
		})
	}

	return createRuntimePolicy({
		configPath,
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

function createRuntimePolicy(options: {
	configPath: string
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
	const allowNetworkAutoApprove = options.config.networkPolicy.default === "allow"
	const allowWriteAutoApprove = writablePaths.length > 0 && effectiveAccess === "workspace"
	const allowTerminalAutoApprove =
		effectiveAccess === "workspace" &&
		options.config.type === "workspace_readwrite" &&
		!options.config.disableTmpWrite &&
		allowNetworkAutoApprove

	return {
		source: "cursor-sandbox",
		status: options.status,
		configPath: options.configPath,
		workspaceRoot,
		effectiveAccess,
		config: options.config,
		error: options.error,
		readablePaths,
		writablePaths,
		networkPolicy: options.config.networkPolicy,
		disableTmpWrite: options.config.disableTmpWrite,
		enableSharedBuildCache: options.config.enableSharedBuildCache,
		allowReadAutoApprove: true,
		allowWriteAutoApprove,
		allowTerminalAutoApprove,
		allowNetworkAutoApprove,
		commandPermissions:
			effectiveAccess === "readOnly"
				? {
						allow: [...READ_ONLY_COMMAND_ALLOW_PATTERNS],
						allowRedirects: false,
					}
				: undefined,
	}
}

function normalizeSandboxPaths(workspaceRoot: string, paths: ReadonlyArray<string>): string[] {
	return dedupePaths(paths.map((candidate) => path.resolve(workspaceRoot, candidate)))
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
