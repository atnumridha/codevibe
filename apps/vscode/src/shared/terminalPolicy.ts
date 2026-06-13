export const CODEVIBE_TERMINAL_POLICY_MARKER_PREFIX = "__codevibe_terminal_policy__:"
export const CODEVIBE_TERMINAL_REQUEST_MARKER_PREFIX = "__codevibe_terminal_request__:"

export const CODEVIBE_TERMINAL_RUN_MODES = ["sandboxed", "elevated", "default"] as const

export type CodeVibeTerminalRunMode = (typeof CODEVIBE_TERMINAL_RUN_MODES)[number]

const TERMINAL_APPROVAL_PAYLOAD_KIND = "codevibe.terminalApproval"
const TERMINAL_APPROVAL_PAYLOAD_VERSION = 1
const TERMINAL_REQUEST_PAYLOAD_KIND = "codevibe.terminalRequest"
const TERMINAL_REQUEST_PAYLOAD_VERSION = 1

export type CodeVibeTerminalApprovalPayload = {
	kind: typeof TERMINAL_APPROVAL_PAYLOAD_KIND
	version: typeof TERMINAL_APPROVAL_PAYLOAD_VERSION
	terminalRunMode: CodeVibeTerminalRunMode
}

export type CodeVibeTerminalRequestPayload = {
	kind: typeof TERMINAL_REQUEST_PAYLOAD_KIND
	version: typeof TERMINAL_REQUEST_PAYLOAD_VERSION
	requestedTerminalRunMode?: CodeVibeTerminalRunMode
	prefixRule?: string[]
}

export const CODEVIBE_TERMINAL_RUN_MODE_LABELS: Record<CodeVibeTerminalRunMode, string> = {
	sandboxed: "Sandboxed",
	default: "Unelevated",
	elevated: "Elevated",
}

export function getTerminalRunModeLabel(mode: CodeVibeTerminalRunMode): string {
	return CODEVIBE_TERMINAL_RUN_MODE_LABELS[mode]
}

function isTerminalRunMode(value: unknown): value is CodeVibeTerminalRunMode {
	return CODEVIBE_TERMINAL_RUN_MODES.includes(value as CodeVibeTerminalRunMode)
}

export function encodeTerminalRunMode(mode: CodeVibeTerminalRunMode): string {
	return `${CODEVIBE_TERMINAL_POLICY_MARKER_PREFIX}${mode}`
}

export function decodeTerminalRunMode(value: string | undefined): CodeVibeTerminalRunMode | undefined {
	if (!value?.startsWith(CODEVIBE_TERMINAL_POLICY_MARKER_PREFIX)) {
		return undefined
	}

	const candidate = value.slice(CODEVIBE_TERMINAL_POLICY_MARKER_PREFIX.length).trim()
	return isTerminalRunMode(candidate) ? candidate : undefined
}

export function encodeTerminalApprovalPayload(mode: CodeVibeTerminalRunMode): string {
	const payload: CodeVibeTerminalApprovalPayload = {
		kind: TERMINAL_APPROVAL_PAYLOAD_KIND,
		version: TERMINAL_APPROVAL_PAYLOAD_VERSION,
		terminalRunMode: mode,
	}
	return JSON.stringify(payload)
}

export function decodeTerminalApprovalPayload(value: string | undefined): CodeVibeTerminalRunMode | undefined {
	if (!value) {
		return undefined
	}

	try {
		const payload = JSON.parse(value) as Partial<CodeVibeTerminalApprovalPayload>
		if (
			payload.kind === TERMINAL_APPROVAL_PAYLOAD_KIND &&
			payload.version === TERMINAL_APPROVAL_PAYLOAD_VERSION &&
			isTerminalRunMode(payload.terminalRunMode)
		) {
			return payload.terminalRunMode
		}
	} catch {
		// Fall through to legacy marker decoding below.
	}

	return decodeTerminalRunMode(value)
}

export function encodeTerminalRequestPayload(request: {
	requestedTerminalRunMode?: CodeVibeTerminalRunMode
	prefixRule?: string[]
}): string {
	const payload: CodeVibeTerminalRequestPayload = {
		kind: TERMINAL_REQUEST_PAYLOAD_KIND,
		version: TERMINAL_REQUEST_PAYLOAD_VERSION,
		...(request.requestedTerminalRunMode ? { requestedTerminalRunMode: request.requestedTerminalRunMode } : {}),
		...(request.prefixRule?.length ? { prefixRule: request.prefixRule } : {}),
	}
	return JSON.stringify(payload)
}

export function decodeTerminalRequestPayload(value: string | undefined): Omit<
	CodeVibeTerminalRequestPayload,
	"kind" | "version"
> | undefined {
	if (!value) {
		return undefined
	}

	try {
		const payload = JSON.parse(value) as Partial<CodeVibeTerminalRequestPayload>
		if (payload.kind !== TERMINAL_REQUEST_PAYLOAD_KIND || payload.version !== TERMINAL_REQUEST_PAYLOAD_VERSION) {
			return undefined
		}

		return {
			...(isTerminalRunMode(payload.requestedTerminalRunMode)
				? { requestedTerminalRunMode: payload.requestedTerminalRunMode }
				: {}),
			...(Array.isArray(payload.prefixRule)
				? { prefixRule: payload.prefixRule.filter((part): part is string => typeof part === "string" && part.length > 0) }
				: {}),
		}
	} catch {
		return undefined
	}
}

export function appendTerminalRunModeMarker(commandText: string, mode: CodeVibeTerminalRunMode): string {
	return `${commandText.replace(/\s+$/, "")}\n${encodeTerminalRunMode(mode)}`
}

export function appendTerminalRequestMarker(
	commandText: string,
	request: { requestedTerminalRunMode?: CodeVibeTerminalRunMode; prefixRule?: string[] },
): string {
	if (!request.requestedTerminalRunMode && !request.prefixRule?.length) {
		return commandText
	}

	return `${commandText.replace(/\s+$/, "")}\n${CODEVIBE_TERMINAL_REQUEST_MARKER_PREFIX}${encodeTerminalRequestPayload(
		request,
	)}`
}

export function extractTerminalRunModeMarker(commandText: string): {
	command: string
	terminalRunMode?: CodeVibeTerminalRunMode
	requestedTerminalRunMode?: CodeVibeTerminalRunMode
	prefixRule?: string[]
} {
	const lines = commandText.split(/\r?\n/)
	let terminalRunMode: CodeVibeTerminalRunMode | undefined
	let requestedTerminalRunMode: CodeVibeTerminalRunMode | undefined
	let prefixRule: string[] | undefined
	const commandLines: string[] = []

	for (const line of lines) {
		const trimmedLine = line.trim()
		const decoded = decodeTerminalRunMode(trimmedLine)
		if (decoded) {
			terminalRunMode = decoded
			continue
		}
		if (trimmedLine.startsWith(CODEVIBE_TERMINAL_REQUEST_MARKER_PREFIX)) {
			const requestPayload = decodeTerminalRequestPayload(trimmedLine.slice(CODEVIBE_TERMINAL_REQUEST_MARKER_PREFIX.length))
			if (requestPayload) {
				requestedTerminalRunMode = requestPayload.requestedTerminalRunMode
				prefixRule = requestPayload.prefixRule
				continue
			}
		}
		commandLines.push(line)
	}

	return {
		command: commandLines.join("\n").trim(),
		terminalRunMode,
		requestedTerminalRunMode,
		prefixRule,
	}
}
