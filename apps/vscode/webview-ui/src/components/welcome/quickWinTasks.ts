export interface QuickWinTask {
	id: string
	title: string
	description: string
	icon?: string
	prompt: string
	buttonText?: string
}

export const quickWinTasks: QuickWinTask[] = [
	{
		id: "review_workspace",
		title: "Review this workspace",
		description: "Map architecture, risks, and next fixes",
		icon: "ReviewIcon",
		prompt: "Review this workspace like a senior engineer. First inspect the repo structure and key files, then summarize the architecture, likely risks, missing tests, and the highest-value next fixes. Do not modify files unless I explicitly approve a follow-up implementation.",
	},
	{
		id: "plan_feature",
		title: "Plan a feature",
		description: "Explore first, then stage the patch path",
		icon: "PlanIcon",
		prompt: "Help me plan a feature in this workspace. Start by exploring the relevant files and existing patterns, then produce a concise implementation plan with risks, files to edit, and tests to run. Wait for approval before making changes.",
	},
	{
		id: "harden_changes",
		title: "Harden current changes",
		description: "Audit diffs, run checks, close gaps",
		icon: "VerifyIcon",
		prompt: "Audit the current git changes. Identify bugs, style regressions, missing tests, and packaging risks. Run the relevant checks where practical, then fix focused issues that are clearly safe and report anything that needs my decision.",
	},
]
