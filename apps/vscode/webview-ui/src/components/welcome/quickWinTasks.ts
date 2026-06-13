export interface QuickWinTask {
	id: string;
	title: string;
	description: string;
	icon?: string;
	meta?: string;
	prompt: string;
	buttonText?: string;
}

export const quickWinTasks: QuickWinTask[] = [
	{
		id: "review_current_diff",
		title: "Review diff",
		description: "Bugs, regressions, missing checks",
		icon: "ReviewIcon",
		meta: "Review",
		prompt:
			"Review the current workspace diff like a senior engineer. Prioritize bugs, behavioral regressions, missing tests, and risky assumptions. Do not modify files; report findings first with file and line references where possible.",
	},
	{
		id: "find_entry_points",
		title: "Map entry points",
		description: "Files, flows, ownership",
		icon: "SearchIcon",
		meta: "Explore",
		prompt:
			"Inspect this workspace and identify the most relevant entry points for the current task. Summarize the files, ownership boundaries, data flow, and likely edit locations. Do not modify files until the implementation path is clear.",
	},
	{
		id: "draft_patch_plan",
		title: "Plan the patch",
		description: "Edit sequence and checks",
		icon: "DiagramIcon",
		meta: "Plan",
		prompt:
			"Create a concise implementation plan for this workspace. Explore the relevant files first, then produce the patch sequence, validation steps, and a fenced Mermaid diagram for any non-trivial flow. Do not modify files until I approve the plan.",
	},
	{
		id: "spawn_parallel_agents",
		title: "Open focus lanes",
		description: "Split research across agents",
		icon: "AgentsIcon",
		meta: "Agents",
		prompt:
			"Use subagents to inspect up to four independent areas of this workspace in parallel. Ask each subagent for evidence-backed findings, then synthesize the implementation path, risks, and validation plan before editing.",
	},
	{
		id: "sandbox_terminal_plan",
		title: "Check terminal safety",
		description: "Classify commands before running",
		icon: "TerminalIcon",
		meta: "Sandbox",
		prompt:
			"Inspect the current task and produce a terminal execution plan. Split commands into sandbox-safe, approval-required elevated, network-required, and destructive categories. Explain the minimum command set needed, then run only sandbox-safe checks unless I approve escalation.",
	},
	{
		id: "openai_skills_bootstrap",
		title: "Load skills",
		description: "Use relevant instructions",
		icon: "SkillIcon",
		meta: "Skills",
		prompt:
			"Inspect this workspace for available Codie skills and project skills. Select the smallest relevant skill set for the current task, explain why each applies, then use those instructions while planning and implementing the next safe change.",
	},
	{
		id: "focused_smoke",
		title: "Verify slice",
		description: "Run the smallest useful check",
		icon: "VerifyIcon",
		meta: "Verify",
		prompt:
			"Inspect the current changes and choose the smallest meaningful validation command for this workspace. Run it if it is safe in the current sandbox; otherwise explain the approval needed and the exact command.",
	},
	{
		id: "codex_auth_probe",
		title: "Check Codie sign-in",
		description: "Auth wiring and redaction",
		icon: "KeyIcon",
		meta: "Codie",
		prompt:
			"Inspect the Codie sign-in path for this workspace. Verify provider defaults, local auth import behavior, token redaction, model loading, and backend headers. Report evidence and patch any small safe regression you find.",
	},
];
