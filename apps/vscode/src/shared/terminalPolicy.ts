export const CODEVIBE_TERMINAL_POLICY_MARKER_PREFIX = "__codevibe_terminal_policy__:"

export const CODEVIBE_TERMINAL_RUN_MODES = ["sandboxed", "elevated", "default"] as const

export type CodeVibeTerminalRunMode = (typeof CODEVIBE_TERMINAL_RUN_MODES)[number]

export function encodeTerminalRunMode(mode: CodeVibeTerminalRunMode): string {
	return `${CODEVIBE_TERMINAL_POLICY_MARKER_PREFIX}${mode}`
}

export function decodeTerminalRunMode(value: string | undefined): CodeVibeTerminalRunMode | undefined {
	if (!value?.startsWith(CODEVIBE_TERMINAL_POLICY_MARKER_PREFIX)) {
		return undefined
	}

	const candidate = value.slice(CODEVIBE_TERMINAL_POLICY_MARKER_PREFIX.length).trim()
	return CODEVIBE_TERMINAL_RUN_MODES.includes(candidate as CodeVibeTerminalRunMode)
		? (candidate as CodeVibeTerminalRunMode)
		: undefined
}
