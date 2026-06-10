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
		title: "Review current diff",
		description: "Find regressions, edge cases, and missing checks",
		icon: "ReviewIcon",
		meta: "Review",
		prompt:
			"Review the current workspace diff like a senior engineer. Prioritize bugs, behavioral regressions, missing tests, and risky assumptions. Do not modify files; report findings first with file and line references where possible.",
	},
	{
		id: "find_entry_points",
		title: "Find the entry points",
		description: "Map the files and flows before editing",
		icon: "SearchIcon",
		meta: "Explore",
		prompt:
			"Inspect this workspace and identify the most relevant entry points for the current task. Summarize the files, ownership boundaries, data flow, and likely edit locations. Do not modify files until the implementation path is clear.",
	},
	{
		id: "draft_patch_plan",
		title: "Map a Mermaid plan",
		description: "Draw the change graph before editing",
		icon: "DiagramIcon",
		meta: "Plan",
		prompt:
			"Create a concise implementation plan for this workspace. Explore the relevant files first, then produce the patch sequence, validation steps, and a fenced Mermaid diagram for any non-trivial flow. Do not modify files until I approve the plan.",
	},
	{
		id: "spawn_parallel_agents",
		title: "Spawn parallel agents",
		description: "Split research across focused subagents",
		icon: "AgentsIcon",
		meta: "Agents",
		prompt:
			"Use subagents to inspect up to four independent areas of this workspace in parallel. Ask each subagent for evidence-backed findings, then synthesize the implementation path, risks, and validation plan before editing.",
	},
	{
		id: "sandbox_terminal_plan",
		title: "Plan terminal safety",
		description: "Separate sandboxed and elevated commands",
		icon: "TerminalIcon",
		meta: "Sandbox",
		prompt:
			"Inspect the current task and produce a terminal execution plan. Split commands into sandbox-safe, approval-required elevated, network-required, and destructive categories. Explain the minimum command set needed, then run only sandbox-safe checks unless I approve escalation.",
	},
	{
		id: "openai_skills_bootstrap",
		title: "Use OpenAI skills",
		description: "Load skills before making changes",
		icon: "SkillIcon",
		meta: "Skills",
		prompt:
			"Inspect this workspace for available OpenAI/Codex skills and project skills. Select the smallest relevant skill set for the current task, explain why each applies, then use those instructions while planning and implementing the next safe change.",
	},
	{
		id: "focused_smoke",
		title: "Verify the slice",
		description: "Pick the smallest useful test or typecheck",
		icon: "VerifyIcon",
		meta: "Verify",
		prompt:
			"Inspect the current changes and choose the smallest meaningful validation command for this workspace. Run it if it is safe in the current sandbox; otherwise explain the approval needed and the exact command.",
	},
	{
		id: "codex_auth_probe",
		title: "Check Codex auth",
		description: "Validate .codex/auth.json provider wiring",
		icon: "KeyIcon",
		meta: "Codex",
		prompt:
			"Inspect the CodeVibe Codex auth path for this workspace. Verify provider defaults, .codex/auth.json import behavior, token redaction, model loading, and backend headers. Report evidence and patch any small safe regression you find.",
	},
];
