import type { z } from "zod"
import type { McpServer } from "@/shared/mcp"
import { ServerConfigSchema } from "@/services/mcp/schemas"
import { expandEnvironmentVariables } from "@/utils/envExpansion"
import type { CursorCompatibleUriRoute } from "./CursorUriRoutes"

const MAX_MCP_SERVER_NAME_LENGTH = 128
const RESERVED_MCP_SERVER_NAMES = new Set(["__proto__", "constructor", "prototype"])

export type CursorMcpServerConfig = z.infer<typeof ServerConfigSchema>

export interface CursorMcpInstallRequest {
	serverName: string
	serverConfig: CursorMcpServerConfig
	source: "config" | "direct"
}

export type CursorMcpOAuthNextAction = "none" | "authenticate"

export interface CursorMcpOAuthSummary {
	oauthRequired?: boolean
	oauthAuthStatus?: McpServer["oauthAuthStatus"]
	oauthNextAction?: CursorMcpOAuthNextAction
	oauthDetail?: string
}

export class CursorMcpInstallError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "CursorMcpInstallError"
	}
}

export function getInstalledServerOAuthSummary(server: McpServer | undefined): CursorMcpOAuthSummary {
	if (!server) {
		return {}
	}

	const oauthAuthStatus = server.oauthAuthStatus
	const authStatusRequiresAuth = oauthAuthStatus === "unauthenticated" || oauthAuthStatus === "pending"
	const oauthRequired = server.oauthRequired ?? authStatusRequiresAuth

	if (!oauthRequired && !oauthAuthStatus) {
		return {}
	}

	const oauthNextAction: CursorMcpOAuthNextAction =
		oauthRequired && oauthAuthStatus !== "authenticated" ? "authenticate" : "none"

	return {
		oauthRequired,
		oauthAuthStatus,
		oauthNextAction,
		oauthDetail:
			oauthNextAction === "authenticate"
				? server.error || "This MCP server requires authentication to get started."
				: undefined,
	}
}

export function buildCursorMcpInstallRequest(route: CursorCompatibleUriRoute): CursorMcpInstallRequest {
	if (route.kind !== "mcp-install") {
		throw new CursorMcpInstallError(`Unsupported Cursor MCP install route: ${route.kind}`)
	}

	const params = route.params
	const config = getRecord(params.config)
	const requestedName = normalizeMcpServerName(getFirstString(params.name, params.server, params.id), {
		required: false,
	})

	const configuredServers = getConfiguredServerEntries(config)
	if (configuredServers) {
		const entries = configuredServers
		if (entries.length === 0) {
			throw new CursorMcpInstallError("MCP config must include at least one server")
		}

		const [serverName, rawServerConfig] = selectConfiguredServer(entries, requestedName)
		return {
			serverName,
			serverConfig: parseServerConfig(rawServerConfig),
			source: "config",
		}
	}

	const rawServerConfig = buildDirectServerConfig(params, config)
	const serverName = requestedName ?? deriveDirectServerName(params)
	return {
		serverName,
		serverConfig: parseServerConfig(rawServerConfig),
		source: "direct",
	}
}

export function formatCursorMcpInstallDetail(request: CursorMcpInstallRequest): string {
	const config = request.serverConfig as Record<string, unknown>
	const lines = [
		`Server: ${request.serverName}`,
		`Transport: ${config.type ?? "stdio"}`,
	]
	if (typeof config.url === "string") {
		lines.push(`URL: ${formatUrlForDisplay(config.url) ?? "[provided url]"}`)
	}
	if (typeof config.command === "string") {
		lines.push(`Command: ${config.command}${Array.isArray(config.args) ? ` ${config.args.join(" ")}` : ""}`)
	}
	if (config.env && typeof config.env === "object") {
		lines.push(`Environment keys: ${Object.keys(config.env).sort().join(", ") || "(none)"}`)
	}
	if (config.headers && typeof config.headers === "object") {
		lines.push(`Header keys: ${Object.keys(config.headers).sort().join(", ") || "(none)"}`)
	}
	return lines.join("\n")
}

function formatUrlForDisplay(value: string): string | undefined {
	try {
		const url = new URL(value)
		return `${url.origin}${url.pathname}${url.search ? "?[redacted]" : ""}${url.hash ? "#[redacted]" : ""}`
	} catch {
		return undefined
	}
}

function selectConfiguredServer(
	entries: Array<[string, unknown]>,
	requestedName: string | undefined,
): [string, unknown] {
	if (requestedName) {
		const entry = entries.find(([name]) => name === requestedName)
		if (!entry) {
			throw new CursorMcpInstallError(`MCP config does not contain server "${requestedName}"`)
		}
		return [normalizeMcpServerName(entry[0], { required: true }), entry[1]]
	}

	if (entries.length !== 1) {
		throw new CursorMcpInstallError("MCP config contains multiple servers; include name, server, or id to choose one")
	}

	return [normalizeMcpServerName(entries[0][0], { required: true }), entries[0][1]]
}

function buildDirectServerConfig(
	params: CursorCompatibleUriRoute["params"],
	config: Record<string, unknown> | undefined,
): Record<string, unknown> {
	const rawConfig = config && !config.mcpServers ? { ...config } : {}
	const url = getString(params.url)
	const command = getString(params.command)
	const packageName = getString(params.package)

	if (url) {
		return {
			...rawConfig,
			url,
			type: (rawConfig.type as string | undefined) ?? (rawConfig.transportType === "http" ? "streamableHttp" : undefined) ?? "streamableHttp",
			disabled: rawConfig.disabled ?? false,
			autoApprove: rawConfig.autoApprove ?? [],
		}
	}

	if (command) {
		return {
			...rawConfig,
			command,
			type: "stdio",
			disabled: rawConfig.disabled ?? false,
			autoApprove: rawConfig.autoApprove ?? [],
		}
	}

	if (packageName) {
		return {
			...rawConfig,
			command: "npx",
			args: ["-y", packageName],
			type: "stdio",
			disabled: rawConfig.disabled ?? false,
			autoApprove: rawConfig.autoApprove ?? [],
		}
	}

	throw new CursorMcpInstallError("MCP install requires config, url, command, or package")
}

function deriveDirectServerName(params: CursorCompatibleUriRoute["params"]): string {
	const packageName = getString(params.package)
	if (packageName) {
		return normalizeMcpServerName(safeNameCandidate(packageName), { required: true })
	}

	const url = getString(params.url)
	if (url) {
		try {
			const parsed = new URL(url)
			const pathName = parsed.pathname.split("/").filter(Boolean).pop()
			return normalizeMcpServerName(safeNameCandidate(pathName ? `${parsed.hostname}-${pathName}` : parsed.hostname), {
				required: true,
			})
		} catch {
			return normalizeMcpServerName(safeNameCandidate(url), { required: true })
		}
	}

	const command = getString(params.command)
	if (command) {
		return normalizeMcpServerName(safeNameCandidate(command.split(/\s+/)[0] || command), { required: true })
	}

	throw new CursorMcpInstallError("MCP server name is required")
}

function getConfiguredServerEntries(config: Record<string, unknown> | undefined): Array<[string, unknown]> | undefined {
	if (!config) {
		return undefined
	}
	if (config.mcpServers && typeof config.mcpServers === "object" && !Array.isArray(config.mcpServers)) {
		return Object.entries(config.mcpServers as Record<string, unknown>)
	}
	if (isBareMcpServerMap(config)) {
		return Object.entries(config)
	}
	return undefined
}

function isBareMcpServerMap(config: Record<string, unknown>): boolean {
	const entries = Object.entries(config)
	if (entries.length === 0 || looksLikeSingleServerConfig(config)) {
		return false
	}
	return entries.every(([, value]) => Boolean(getRecord(value)))
}

function looksLikeSingleServerConfig(config: Record<string, unknown>): boolean {
	return [
		"type",
		"transport",
		"transportType",
		"command",
		"args",
		"cwd",
		"env",
		"url",
		"headers",
		"autoApprove",
		"disabled",
		"timeout",
		"remoteConfigured",
	].some((key) => Object.hasOwn(config, key))
}

function safeNameCandidate(value: string): string {
	return value
		.trim()
		.replace(/^@/, "")
		.replace(/[^a-zA-Z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, MAX_MCP_SERVER_NAME_LENGTH)
}

function parseServerConfig(value: unknown): CursorMcpServerConfig {
	const result = ServerConfigSchema.safeParse(expandEnvironmentVariables(value))
	if (!result.success) {
		const issue = result.error.issues[0]
		const path = issue?.path.length ? `${issue.path.join(".")}: ` : ""
		throw new CursorMcpInstallError(`Invalid MCP server config: ${path}${issue?.message ?? "validation failed"}`)
	}
	return result.data
}

function normalizeMcpServerName(value: string | undefined, options: { required: true }): string
function normalizeMcpServerName(value: string | undefined, options: { required: false }): string | undefined
function normalizeMcpServerName(value: string | undefined, options: { required: boolean }): string | undefined {
	const normalized = value?.trim()
	if (!normalized) {
		if (options.required) {
			throw new CursorMcpInstallError("MCP server name is required")
		}
		return undefined
	}
	if (normalized.length > MAX_MCP_SERVER_NAME_LENGTH) {
		throw new CursorMcpInstallError(`MCP server name must be ${MAX_MCP_SERVER_NAME_LENGTH} characters or fewer`)
	}
	if (RESERVED_MCP_SERVER_NAMES.has(normalized) || /[\x00-\x1f/\\]/.test(normalized)) {
		throw new CursorMcpInstallError("MCP server name contains unsafe characters")
	}
	return normalized
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function getString(value: string | Record<string, unknown> | undefined): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function getFirstString(
	...values: Array<string | Record<string, unknown> | undefined>
): string | undefined {
	for (const value of values) {
		const candidate = getString(value)
		if (candidate) {
			return candidate
		}
	}
	return undefined
}
