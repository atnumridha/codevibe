import * as vscode from "vscode"
import {
	buildCodeVibeTerminalPolicyEnv,
	getCodeVibeTerminalPolicyEnvSignature,
} from "@/integrations/terminal/terminalPolicyEnv"
import type { CommandExecutionOptions } from "@/integrations/terminal/types"

export function getCodeVibeTerminalEnv(options?: CommandExecutionOptions): NonNullable<vscode.TerminalOptions["env"]> {
	return {
		CODEVIBE_ACTIVE: "true",
		CLINE_ACTIVE: "true",
		...buildCodeVibeTerminalPolicyEnv(options),
	}
}

export function getCodeVibeTerminalEnvSignature(options?: CommandExecutionOptions): string {
	return getCodeVibeTerminalPolicyEnvSignature(options)
}

export function createCodeVibeTerminalOptions(options: {
	cwd?: string | vscode.Uri
	shellPath?: string
	executionOptions?: CommandExecutionOptions
} = {}): vscode.TerminalOptions {
	const terminalOptions: vscode.TerminalOptions = {
		name: "Codie",
		iconPath: new vscode.ThemeIcon("codevibe-icon"),
		env: getCodeVibeTerminalEnv(options.executionOptions),
	}

	if (options.cwd !== undefined) {
		terminalOptions.cwd = options.cwd
	}

	if (options.shellPath) {
		terminalOptions.shellPath = options.shellPath
	}

	return terminalOptions
}
