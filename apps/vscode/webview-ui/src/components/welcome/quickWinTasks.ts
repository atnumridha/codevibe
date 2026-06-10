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
		id: "visual_plan",
		title: "Draw the patch plan",
		description: "Explore, then render the flow as Mermaid",
		icon: "DiagramIcon",
		prompt: "Create a visual implementation plan for this workspace. Explore the relevant files first, then produce a concise plan with a fenced Mermaid diagram that maps ownership, data flow, and the patch sequence. Do not modify files until I approve the plan.",
	},
	{
		id: "parallel_agents",
		title: "Split into agents",
		description: "Find independent slices and ownership",
		icon: "AgentsIcon",
		prompt: "Plan this work for parallel CodeVibe agents. Inspect the repo structure, identify independent implementation slices with non-overlapping file ownership, and propose the exact prompts for each spawned agent. Keep the critical path local and wait for approval before launching or editing.",
	},
	{
		id: "sandbox_audit",
		title: "Audit terminal safety",
		description: "Classify commands by sandbox policy",
		icon: "VerifyIcon",
		prompt: "Audit the current workspace task for terminal safety. List the commands you would run, classify each as sandboxed or elevated with the reason, then execute only safe read/check commands after the normal approval boundary.",
	},
	{
		id: "ship_smoke",
		title: "Package and smoke test",
		description: "VSIX, install, MCP, browser, diffs",
		icon: "ShipIcon",
		prompt: "Harden the current CodeVibe changes for release. Inspect the diff, run focused checks, package the VSIX, install it into VS Code, and smoke-test Codex auth, native chat, diffs, terminal approvals, MCP, and browser automation where practical.",
	},
]
