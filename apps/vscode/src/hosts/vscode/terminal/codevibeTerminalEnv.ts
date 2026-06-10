import * as vscode from "vscode"

export function getCodeVibeTerminalEnv(): NonNullable<vscode.TerminalOptions["env"]> {
	return {
		CODEVIBE_ACTIVE: "true",
		CLINE_ACTIVE: "true",
	}
}

export function createCodeVibeTerminalOptions(options: {
	cwd?: string | vscode.Uri
	shellPath?: string
} = {}): vscode.TerminalOptions {
	const terminalOptions: vscode.TerminalOptions = {
		name: "CodeVibe",
		iconPath: new vscode.ThemeIcon("codevibe-icon"),
		env: getCodeVibeTerminalEnv(),
	}

	if (options.cwd !== undefined) {
		terminalOptions.cwd = options.cwd
	}

	if (options.shellPath) {
		terminalOptions.shellPath = options.shellPath
	}

	return terminalOptions
}
