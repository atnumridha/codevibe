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
		title: "Draft a patch plan",
		description: "Sequence the work with clear file ownership",
		icon: "DiagramIcon",
		meta: "Plan",
		prompt:
			"Create a concise implementation plan for this workspace. Explore the relevant files first, then produce the patch sequence, validation steps, and a fenced Mermaid diagram for any non-trivial flow. Do not modify files until I approve the plan.",
	},
	{
		id: "focused_smoke",
		title: "Run focused checks",
		description: "Pick the smallest useful test or typecheck",
		icon: "VerifyIcon",
		meta: "Verify",
		prompt:
			"Inspect the current changes and choose the smallest meaningful validation command for this workspace. Run it if it is safe in the current sandbox; otherwise explain the approval needed and the exact command.",
	},
];
