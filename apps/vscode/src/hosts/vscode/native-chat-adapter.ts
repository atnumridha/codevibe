export type CodeVibeNativeChatRequestLike = {
	prompt?: unknown
	command?: unknown
}

export function buildCodeVibeNativeChatTaskText(request: CodeVibeNativeChatRequestLike): string {
	const prompt = typeof request.prompt === "string" ? request.prompt.trim() : ""
	const command = typeof request.command === "string" ? request.command.trim().toLowerCase() : ""
	switch (command) {
		case "plan":
			return prompt
				? `Plan this task first before editing.\n\n${prompt}`
				: "Plan the next Codie task first before editing."
		case "review":
			return prompt
				? `Review this request and prioritize bugs, risks, regressions, and missing tests.\n\n${prompt}`
				: "Review the current workspace and prioritize bugs, risks, regressions, and missing tests."
		default:
			return prompt
	}
}

export function buildCodeVibeNativeChatStartedMarkdown(taskId: string): string {
	return [
		`Started Codie task \`${taskId}\` from native VS Code Chat.`,
		"",
		"Codie is now running the real planner, tools, diffs, terminal approvals, MCP, browser automation, and Codex-backed provider flow. Open Codie only when you want the full task timeline or controls.",
	].join("\n")
}

export function buildCodeVibeNativeChatEmptyPromptMarkdown(): string {
	return "Tell Codie what to build, review, explain, or change. The native Chat route starts the same Codie task engine used by the extension UI."
}

export function buildCodeVibeNativeChatFallbackMarkdown(errorMessage: string | undefined, hasPrompt: boolean): string {
	const reason = errorMessage ? `\n\nStartup detail: ${errorMessage}` : ""
	if (!hasPrompt) {
		return `Opened Codie Agent. Start a task there to use Codie's planner, tools, diffs, terminal approvals, MCP, and browser automation.${reason}`
	}
	return `Codie could not start the task directly from native Chat, so the prompt was moved into the Codie task box.${reason}`
}
