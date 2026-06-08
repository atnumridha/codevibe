export const CURSOR_COMPATIBLE_ROUTE_LABELS = [
	{ path: "/createchat", label: "Chat" },
	{ path: "/mcp/install", label: "MCP" },
	{ path: "/background-agent", label: "Background" },
	{ path: "/settings", label: "Settings" },
	{ path: "/prompt", label: "Prompt" },
	{ path: "/command", label: "Command" },
	{ path: "/rule", label: "Rule" },
	{ path: "/pr-review", label: "PR Review" },
	{ path: "/plugin/add", label: "Plugin" },
	{ path: "/glass", label: "Glass" },
	{ path: "/automation/ingest", label: "NDJSON" },
	{ path: "/git/checkout", label: "Checkout" },
	{ path: "/git/branch", label: "Branch" },
	{ path: "/git/commit", label: "Commit" },
] as const

export const CURSOR_COMPATIBILITY_SURFACES = [
	"Codex auth",
	"Composer",
	"MCP install",
	"Browser",
	"Retrieval",
	"Background workstreams",
	"Rules",
	"Sandbox",
	"Git helpers",
	"NDJSON ingest",
	"Plugins",
] as const

const ROUTE_PATHS = new Set(CURSOR_COMPATIBLE_ROUTE_LABELS.map((route) => route.path))
const SECRET_KEY_PATTERN =
	/(authorization|api[-_]?key|cookie|credential|id[-_]?token|jwt|password|refresh[-_]?token|secret|session|token)/i
const BEARER_SECRET_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const MAX_PREVIEW_VALUE_LENGTH = 512

export interface CursorUriPreview {
	ok: boolean
	route?: string
	paramKeys: string[]
	redacted: boolean
	text: string
	error?: string
}

function truncatePreviewValue(value: string): string {
	const normalized = value.replace(/[\r\n\t]+/g, " ").trim()
	if (normalized.length <= MAX_PREVIEW_VALUE_LENGTH) {
		return normalized
	}
	return `${normalized.slice(0, MAX_PREVIEW_VALUE_LENGTH)}...`
}

function isSecretKey(key: string): boolean {
	return SECRET_KEY_PATTERN.test(key)
}

function redactSecretLikeString(value: string): { value: string; redacted: boolean } {
	const replaced = value.replace(BEARER_SECRET_PATTERN, "Bearer [REDACTED]")
	return { value: replaced, redacted: replaced !== value }
}

function redactSecretBearingUrl(value: string): { value: string; redacted: boolean } {
	try {
		const parsed = new URL(value)
		let redacted = false
		for (const key of [...new Set(parsed.searchParams.keys())]) {
			if (isSecretKey(key)) {
				parsed.searchParams.set(key, "[REDACTED]")
				redacted = true
			}
		}
		return redacted ? { value: parsed.toString(), redacted } : { value, redacted: false }
	} catch {
		return { value, redacted: false }
	}
}

function redactJsonValue(value: unknown, parentKey = ""): { value: unknown; redacted: boolean } {
	if (isSecretKey(parentKey)) {
		return { value: "[REDACTED]", redacted: true }
	}

	if (typeof value === "string") {
		const urlRedaction = redactSecretBearingUrl(value)
		const bearerRedaction = redactSecretLikeString(urlRedaction.value)
		return {
			value: bearerRedaction.value,
			redacted: urlRedaction.redacted || bearerRedaction.redacted,
		}
	}

	if (Array.isArray(value)) {
		let redacted = false
		const next = value.map((entry) => {
			const result = redactJsonValue(entry)
			redacted ||= result.redacted
			return result.value
		})
		return { value: next, redacted }
	}

	if (value && typeof value === "object") {
		let redacted = false
		const next: Record<string, unknown> = {}
		for (const [key, entry] of Object.entries(value)) {
			const result = redactJsonValue(entry, key)
			redacted ||= result.redacted
			next[key] = result.value
		}
		return { value: next, redacted }
	}

	return { value, redacted: false }
}

function redactParamValue(key: string, value: string): { value: string; redacted: boolean } {
	if (isSecretKey(key)) {
		return { value: "[REDACTED]", redacted: true }
	}

	if (key === "config") {
		try {
			const parsed = JSON.parse(value)
			const result = redactJsonValue(parsed)
			return {
				value: truncatePreviewValue(JSON.stringify(result.value)),
				redacted: result.redacted,
			}
		} catch {
			const fallback = redactSecretLikeString(value)
			return { value: truncatePreviewValue(fallback.value), redacted: fallback.redacted }
		}
	}

	const urlRedaction = redactSecretBearingUrl(value)
	const bearerRedaction = redactSecretLikeString(urlRedaction.value)
	return {
		value: truncatePreviewValue(bearerRedaction.value),
		redacted: urlRedaction.redacted || bearerRedaction.redacted,
	}
}

function inferRoute(parsed: URL): string {
	const directPath = parsed.pathname || "/"
	if (ROUTE_PATHS.has(directPath as (typeof CURSOR_COMPATIBLE_ROUTE_LABELS)[number]["path"])) {
		return directPath
	}

	const hostPath = parsed.hostname ? `/${parsed.hostname}${directPath === "/" ? "" : directPath}` : directPath
	if (ROUTE_PATHS.has(hostPath as (typeof CURSOR_COMPATIBLE_ROUTE_LABELS)[number]["path"])) {
		return hostPath
	}

	if (parsed.hostname === "anysphere.cursor-mcp" && directPath === "/install") {
		return "/mcp/install"
	}

	return directPath
}

export function buildCursorUriPreview(input: string): CursorUriPreview {
	const trimmed = input.trim()
	if (!trimmed) {
		return {
			ok: false,
			paramKeys: [],
			redacted: false,
			text: "Enter a CodeVibe or compatible URI.",
			error: "URI is empty",
		}
	}

	let parsed: URL
	try {
		parsed = new URL(trimmed)
	} catch {
		return {
			ok: false,
			paramKeys: [],
			redacted: false,
			text: "URI is not valid.",
			error: "URI is not valid",
		}
	}

	const route = inferRoute(parsed)
	const paramKeys = [...new Set([...parsed.searchParams.keys()])].sort()
	let redacted = false
	const lines = [
		`scheme: ${parsed.protocol.replace(/:$/, "")}`,
		`host: ${parsed.hostname || "(none)"}`,
		`route: ${route}`,
	]

	if (paramKeys.length === 0) {
		lines.push("params: none")
	} else {
		lines.push("params:")
		for (const key of paramKeys) {
			const values = parsed.searchParams.getAll(key)
			for (const value of values) {
				const result = redactParamValue(key, value)
				redacted ||= result.redacted
				lines.push(`  ${key}: ${result.value}`)
			}
		}
	}

	return {
		ok: true,
		route,
		paramKeys,
		redacted,
		text: lines.join("\n"),
	}
}
