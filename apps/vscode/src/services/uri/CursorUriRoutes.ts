import { z } from "zod"

export const CURSOR_COMPATIBLE_URI_PATHS = [
	"/createchat",
	"/mcp/install",
	"/background-agent",
	"/settings",
	"/prompt",
	"/command",
	"/rule",
	"/pr-review",
	"/plugin/add",
	"/glass",
] as const

const MAX_CURSOR_URI_PARAM_LENGTH = 16_384
const MAX_CURSOR_URI_CONFIG_JSON_LENGTH = 64 * 1024
const SECRET_PARAM_PATTERN = /(token|secret|password|authorization|api[-_]?key|credential)/i

type CursorCompatibleUriPath = (typeof CURSOR_COMPATIBLE_URI_PATHS)[number]

export type CursorCompatibleUriKind =
	| "createchat"
	| "mcp-install"
	| "background-agent"
	| "settings"
	| "prompt"
	| "command"
	| "rule"
	| "pr-review"
	| "plugin-add"
	| "glass"

export interface CursorCompatibleUriRoute {
	kind: CursorCompatibleUriKind
	path: CursorCompatibleUriPath
	params: Record<string, string | Record<string, unknown>>
}

export type CursorCompatibleUriParseResult =
	| { recognized: false }
	| { recognized: true; route: CursorCompatibleUriRoute }
	| { recognized: true; error: string }

const boundedString = z.string().min(1).max(MAX_CURSOR_URI_PARAM_LENGTH)
const optionalBoundedString = z.string().max(MAX_CURSOR_URI_PARAM_LENGTH).optional()
const configSchema = z.record(z.string(), z.unknown()).optional()

const promptLikeSchema = z
	.object({
		prompt: optionalBoundedString,
		text: optionalBoundedString,
		message: optionalBoundedString,
		mode: optionalBoundedString,
		model: optionalBoundedString,
		workspace: optionalBoundedString,
		config: configSchema,
	})
	.strict()
	.refine((value) => value.prompt || value.text || value.message, "prompt, text, or message is required")

const mcpInstallSchema = z
	.object({
		name: optionalBoundedString,
		server: optionalBoundedString,
		id: optionalBoundedString,
		url: optionalBoundedString,
		command: optionalBoundedString,
		package: optionalBoundedString,
		config: configSchema,
	})
	.strict()
	.refine(
		(value) => value.name || value.server || value.id || value.url || value.command || value.package || value.config,
		"one MCP identifier or config is required",
	)

const backgroundAgentSchema = z
	.object({
		prompt: optionalBoundedString,
		task: optionalBoundedString,
		message: optionalBoundedString,
		repository: optionalBoundedString,
		repo: optionalBoundedString,
		branch: optionalBoundedString,
		baseBranch: optionalBoundedString,
		config: configSchema,
	})
	.strict()
	.refine((value) => value.prompt || value.task || value.message, "prompt, task, or message is required")

const settingsSchema = z
	.object({
		section: optionalBoundedString,
		tab: optionalBoundedString,
		query: optionalBoundedString,
		config: configSchema,
	})
	.strict()

const commandSchema = z
	.object({
		command: boundedString,
		cwd: optionalBoundedString,
		workspace: optionalBoundedString,
		config: configSchema,
	})
	.strict()

const ruleSchema = z
	.object({
		name: optionalBoundedString,
		path: optionalBoundedString,
		content: optionalBoundedString,
		url: optionalBoundedString,
		config: configSchema,
	})
	.strict()
	.refine((value) => value.name || value.path || value.content || value.url || value.config, "rule input is required")

const prReviewSchema = z
	.object({
		url: optionalBoundedString,
		repo: optionalBoundedString,
		repository: optionalBoundedString,
		number: optionalBoundedString,
		pullRequest: optionalBoundedString,
		instructions: optionalBoundedString,
		config: configSchema,
	})
	.strict()
	.refine(
		(value) => value.url || ((value.repo || value.repository) && (value.number || value.pullRequest)),
		"PR URL or repository plus PR number is required",
	)

const pluginAddSchema = z
	.object({
		id: optionalBoundedString,
		name: optionalBoundedString,
		url: optionalBoundedString,
		config: configSchema,
	})
	.strict()
	.refine((value) => value.id || value.name || value.url || value.config, "plugin identifier or config is required")

const glassSchema = z
	.object({
		prompt: optionalBoundedString,
		text: optionalBoundedString,
		message: optionalBoundedString,
		config: configSchema,
	})
	.strict()

const routeSchemas: Record<CursorCompatibleUriPath, { kind: CursorCompatibleUriKind; schema: z.ZodTypeAny }> = {
	"/createchat": { kind: "createchat", schema: promptLikeSchema },
	"/mcp/install": { kind: "mcp-install", schema: mcpInstallSchema },
	"/background-agent": { kind: "background-agent", schema: backgroundAgentSchema },
	"/settings": { kind: "settings", schema: settingsSchema },
	"/prompt": { kind: "prompt", schema: promptLikeSchema },
	"/command": { kind: "command", schema: commandSchema },
	"/rule": { kind: "rule", schema: ruleSchema },
	"/pr-review": { kind: "pr-review", schema: prReviewSchema },
	"/plugin/add": { kind: "plugin-add", schema: pluginAddSchema },
	"/glass": { kind: "glass", schema: glassSchema },
}

export function isCursorCompatibleUriPath(path: string): path is CursorCompatibleUriPath {
	return (CURSOR_COMPATIBLE_URI_PATHS as readonly string[]).includes(path)
}

function decodeBase64JsonConfig(value: string): Record<string, unknown> {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
	const raw = Buffer.from(padded, "base64").toString("utf8")
	if (raw.length > MAX_CURSOR_URI_CONFIG_JSON_LENGTH) {
		throw new Error("config JSON exceeds maximum length")
	}
	const parsed = JSON.parse(raw) as unknown
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("config must decode to a JSON object")
	}
	return parsed as Record<string, unknown>
}

function queryToObject(query: URLSearchParams): Record<string, string | Record<string, unknown>> {
	const values: Record<string, string | Record<string, unknown>> = {}
	for (const [key, value] of query.entries()) {
		if (!key || key.length > 128) {
			throw new Error("query parameter name is invalid")
		}
		if (Object.hasOwn(values, key)) {
			throw new Error(`duplicate query parameter: ${key}`)
		}
		if (value.length > MAX_CURSOR_URI_PARAM_LENGTH) {
			throw new Error(`query parameter is too large: ${key}`)
		}
		values[key] = key === "config" ? decodeBase64JsonConfig(value) : value
	}
	return values
}

function formatSchemaError(error: z.ZodError): string {
	return error.issues
		.map((issue) => {
			const path = issue.path.join(".")
			return path ? `${path}: ${issue.message}` : issue.message
		})
		.join("; ")
}

export function parseCursorCompatibleUri(
	path: string,
	query: URLSearchParams,
): CursorCompatibleUriParseResult {
	if (!isCursorCompatibleUriPath(path)) {
		return { recognized: false }
	}

	try {
		const candidate = queryToObject(query)
		const definition = routeSchemas[path]
		const parsed = definition.schema.safeParse(candidate)
		if (!parsed.success) {
			return { recognized: true, error: formatSchemaError(parsed.error) }
		}
		return {
			recognized: true,
			route: {
				kind: definition.kind,
				path,
				params: parsed.data as Record<string, string | Record<string, unknown>>,
			},
		}
	} catch (error) {
		return {
			recognized: true,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

function getPromptText(route: CursorCompatibleUriRoute): string | undefined {
	const params = route.params
	for (const key of ["prompt", "task", "text", "message"] as const) {
		const value = params[key]
		if (typeof value === "string" && value.trim()) {
			return value.trim()
		}
	}
	return undefined
}

function formatParamValue(key: string, value: string | Record<string, unknown>): string {
	if (typeof value !== "string") {
		return `config keys: ${Object.keys(value).sort().join(", ") || "(none)"}`
	}
	if (SECRET_PARAM_PATTERN.test(key)) {
		return "[redacted]"
	}
	return value
}

function formatRouteDetails(route: CursorCompatibleUriRoute, skipKeys: string[] = []): string {
	const skipped = new Set(skipKeys)
	const lines = Object.entries(route.params)
		.filter(([key]) => !skipped.has(key))
		.map(([key, value]) => `- ${key}: ${formatParamValue(key, value)}`)
	return lines.length > 0 ? lines.join("\n") : "- No additional route parameters."
}

export function buildCursorCompatibleTaskPrompt(route: CursorCompatibleUriRoute): string {
	const prompt = getPromptText(route)

	if (route.kind === "createchat" || route.kind === "prompt" || route.kind === "glass") {
		return prompt || "Open the Cursor-compatible Glass route and ask me what to do next."
	}

	if (route.kind === "command") {
		const command = typeof route.params.command === "string" ? route.params.command : ""
		return [
			"A Cursor-compatible command deeplink requested this command. Review it with the user before running it, and use normal terminal approval boundaries.",
			"",
			"```sh",
			command,
			"```",
			"",
			formatRouteDetails(route, ["command"]),
		].join("\n")
	}

	const title = {
		"mcp-install": "MCP install",
		"background-agent": "background agent",
		settings: "settings",
		rule: "rule",
		"pr-review": "pull request review",
		"plugin-add": "plugin add",
	}[route.kind]

	return [
		`A Cursor-compatible ${title} deeplink was opened. Validate the request and ask for confirmation before making changes, installing packages, opening network connections, or running commands.`,
		...(prompt ? ["", "Requested prompt:", prompt] : []),
		"",
		"Route details:",
		formatRouteDetails(route, ["prompt", "task", "text", "message"]),
	].join("\n")
}
