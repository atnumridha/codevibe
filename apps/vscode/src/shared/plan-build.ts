export const LOCAL_PLAN_BUILD_LABEL = "Build Locally"

export type PlanBuildStatus = "none" | "active" | "complete"

export interface LocalPlanBuildMetadata {
	planId: string
	planPath: string
	todoCount: number
	status: PlanBuildStatus
}

export interface LocalPlanExecutionMessageInput {
	planText?: string
	planPath?: string
	taskProgress?: string
}

const CHECKBOX_LINE = /^-\s*\[[ xX]\]\s*(.+)$/

export function normalizePlanText(planText?: string): string {
	return (planText || "").replace(/\r\n/g, "\n").trim()
}

export function extractMarkdownTodos(text?: string): string[] {
	return normalizePlanText(text)
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => CHECKBOX_LINE.test(line))
}

export function resetMarkdownTodosToPending(text?: string): string {
	return extractMarkdownTodos(text)
		.map((line) => {
			const match = line.match(CHECKBOX_LINE)
			return match ? `- [ ] ${match[1].trim()}` : line
		})
		.join("\n")
}

export function buildLocalPlanExecutionMessage({
	planText,
	planPath,
	taskProgress,
}: LocalPlanExecutionMessageInput): string {
	const normalizedPlan = normalizePlanText(planText)
	const normalizedTaskProgress = normalizePlanText(taskProgress)
	const sections = [
		"Build this plan locally in Act mode.",
		"",
		"The plan below is accepted and attached as the execution reference. Use it as the source of truth.",
		"",
		"Execution requirements:",
		"- Route this as a local agent build only. Do not start or transfer to a cloud/background build.",
		"- Do not edit the plan file during execution.",
		"- Todos have already been created from the plan; do not recreate duplicate todos.",
		"- Mark todos in progress as you start each item, using task_progress to keep the single todo source of truth current.",
		"- Continue until every accepted todo is completed or intentionally cancelled.",
	]

	if (planPath) {
		sections.push("", `Plan file reference: ${planPath}`)
	}

	if (normalizedTaskProgress) {
		sections.push("", "<accepted_todos>", normalizedTaskProgress, "</accepted_todos>")
	}

	sections.push(
		"",
		"<accepted_plan>",
		normalizedPlan || "(The accepted plan is already present in the conversation.)",
		"</accepted_plan>",
	)

	return sections.join("\n")
}
