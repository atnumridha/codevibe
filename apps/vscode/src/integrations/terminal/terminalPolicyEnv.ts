import type { CommandExecutionOptions } from "./types"

export type TerminalSandboxEnforcement = "none" | "required" | "macos-sandbox-exec"

export function buildCodeVibeTerminalPolicyEnv(
	options?: CommandExecutionOptions,
	sandboxEnforcement: TerminalSandboxEnforcement = options?.terminalRunMode === "sandboxed" ? "required" : "none",
): Record<string, string> {
	const mode = options?.terminalRunMode ?? "default"
	const background = Boolean(options?.useBackgroundExecution || mode === "sandboxed")

	return {
		CODEVIBE_TERMINAL_RUN_MODE: mode,
		CODEVIBE_TERMINAL_SANDBOX: mode === "sandboxed" ? "1" : "0",
		CODEVIBE_TERMINAL_ELEVATED: mode === "elevated" ? "1" : "0",
		CODEVIBE_TERMINAL_BACKGROUND: background ? "1" : "0",
		CODEVIBE_TERMINAL_SANDBOX_ENFORCEMENT: sandboxEnforcement,
	}
}

export function getCodeVibeTerminalPolicyEnvSignature(options?: CommandExecutionOptions): string {
	const env = buildCodeVibeTerminalPolicyEnv(options)

	return [
		env.CODEVIBE_TERMINAL_RUN_MODE,
		env.CODEVIBE_TERMINAL_SANDBOX,
		env.CODEVIBE_TERMINAL_ELEVATED,
		env.CODEVIBE_TERMINAL_BACKGROUND,
		env.CODEVIBE_TERMINAL_SANDBOX_ENFORCEMENT,
	].join(":")
}
