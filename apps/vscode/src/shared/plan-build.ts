export const LOCAL_PLAN_BUILD_LABEL = "Build Locally"
export const PARALLEL_PLAN_BUILD_LABEL = "Build in Parallel"

export const PLAN_TODO_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const
export type PlanTodoStatus = (typeof PLAN_TODO_STATUSES)[number]

export type PlanBuildMode = "agent" | "project" | "multitask"
export type PlanBuildStatus = "none" | "active" | "complete"
export type PlanStatus = "pending" | "in_progress" | "complete"

export interface PlanTodo {
	id: string
	content: string
	status: PlanTodoStatus
	dependencies: string[]
}

export interface PlanPhase {
	name: string
	todos: PlanTodo[]
}

export interface PlanMetadata {
	name: string
	overview: string
	todos: PlanTodo[]
	isProject: boolean
	phases?: PlanPhase[]
}

export interface LocalPlanBuildMetadata {
	planId: string
	planPath: string
	todoCount: number
	status: PlanBuildStatus
}

export interface LocalPlanExecutionMessageInput {
	planText?: string
	planId?: string
	planPath?: string
	taskProgress?: string
	mode?: PlanBuildMode
	selectedTodoIds?: string[]
	skipSubmission?: boolean
	forceNewAgent?: boolean
}

export interface ExecutePlanAction {
	type: "ExecutePlanAction"
	isPlanExecution: true
	planId?: string
	planUri?: string
	planContent: string
	unifiedMode: PlanBuildMode
	executionMode: PlanBuildMode
	selectedTodoIds: string[]
	skipSubmission: boolean
	targetEnvironment: "local"
	entrypoint: "plan_tab_build" | "plan_tab_build_parallel" | "plan_tab_build_new_agent"
}

const CHECKBOX_LINE = /^-\s*\[([ xX])\]\s*(.+)$/

export function normalizePlanText(planText?: string): string {
	return (planText || "").replace(/\r\n/g, "\n").trim()
}

export function isPlanTodoStatus(value: unknown): value is PlanTodoStatus {
	return typeof value === "string" && PLAN_TODO_STATUSES.includes(value as PlanTodoStatus)
}

export function normalizePlanTodoStatus(value: unknown): PlanTodoStatus {
	return isPlanTodoStatus(value) ? value : "pending"
}

export function generatePlanTodoId(now = Date.now(), random = Math.random()): string {
	const randomPart = Math.floor(random * 1_000_000)
		.toString(36)
		.padStart(4, "0")
	return `todo-${now}-${randomPart}`
}

export function cyclePlanTodoStatus(status: PlanTodoStatus): PlanTodoStatus {
	const currentIndex = PLAN_TODO_STATUSES.indexOf(status)
	return PLAN_TODO_STATUSES[(currentIndex + 1) % PLAN_TODO_STATUSES.length]
}

export function extractMarkdownTodos(text?: string): string[] {
	return normalizePlanText(text)
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => CHECKBOX_LINE.test(line))
}

export function markdownTodosToPlanTodos(text?: string, idSeed = Date.now()): PlanTodo[] {
	return extractMarkdownTodos(text).map((line, index) => {
		const match = line.match(CHECKBOX_LINE)
		const checkbox = match?.[1] || " "
		const content = (match?.[2] || line).trim()
		return {
			id: generatePlanTodoId(idSeed + index, (index + 1) / 10_000),
			content,
			status: checkbox.toLowerCase() === "x" ? "completed" : "pending",
			dependencies: [],
		}
	})
}

export function resetMarkdownTodosToPending(text?: string): string {
	return extractMarkdownTodos(text)
		.map((line) => {
			const match = line.match(CHECKBOX_LINE)
			return match ? `- [ ] ${match[2].trim()}` : line
		})
		.join("\n")
}

export function getPlanTodos(metadata?: Pick<PlanMetadata, "todos" | "phases">): PlanTodo[] {
	if (!metadata) {
		return []
	}
	const todos = Array.isArray(metadata.todos) ? metadata.todos : []
	const phaseTodos = Array.isArray(metadata.phases) ? metadata.phases.flatMap((phase) => phase.todos || []) : []
	return [...todos, ...phaseTodos]
}

export function getNonCompletedPlanTodoIds(metadata: PlanMetadata): string[] {
	return getPlanTodos(metadata)
		.filter((todo) => todo.status !== "completed" && todo.status !== "cancelled")
		.map((todo) => todo.id)
}

export function updatePlanTodosStatus(metadata: PlanMetadata, todoIds: string[], status: PlanTodoStatus): PlanMetadata {
	const idSet = new Set(todoIds)
	const updateTodo = (todo: PlanTodo): PlanTodo => (idSet.has(todo.id) ? { ...todo, status } : todo)
	return {
		...metadata,
		todos: metadata.todos.map(updateTodo),
		phases: metadata.phases?.map((phase) => ({ ...phase, todos: phase.todos.map(updateTodo) })),
	}
}

export function removePlanTodos(metadata: PlanMetadata, todoIds: string[]): PlanMetadata {
	const idSet = new Set(todoIds)
	return {
		...metadata,
		todos: metadata.todos.filter((todo) => !idSet.has(todo.id)),
		phases: metadata.phases?.map((phase) => ({ ...phase, todos: phase.todos.filter((todo) => !idSet.has(todo.id)) })),
	}
}

export function derivePlanStatus(metadata: PlanMetadata): PlanStatus {
	const todos = getPlanTodos(metadata)
	if (todos.length === 0) {
		return "pending"
	}
	if (todos.every((todo) => todo.status === "completed" || todo.status === "cancelled")) {
		return "complete"
	}
	// A plan is only "in_progress" when at least one todo is actively in progress.
	// If work was partially completed but nothing is currently active, treat it as pending/not-progressing.
	if (todos.some((todo) => todo.status === "in_progress")) {
		return "in_progress"
	}
	return "pending"
}

export function derivePlanBuildStatus(metadata: PlanMetadata, activeTodoIds: string[] = []): PlanBuildStatus {
	const todos = getPlanTodos(metadata)
	if (activeTodoIds.length > 0 || todos.some((todo) => todo.status === "in_progress")) {
		return "active"
	}
	if (todos.length > 0 && todos.every((todo) => todo.status === "completed" || todo.status === "cancelled")) {
		return "complete"
	}
	return "none"
}

export function planMetadataToTaskProgress(metadata: PlanMetadata, todoIds?: string[]): string {
	const idSet = todoIds?.length ? new Set(todoIds) : undefined
	return getPlanTodos(metadata)
		.filter((todo) => !idSet || idSet.has(todo.id))
		.map((todo) => {
			const checkbox = todo.status === "completed" || todo.status === "cancelled" ? "x" : " "
			const suffix = todo.status === "cancelled" ? " (cancelled)" : ""
			return `- [${checkbox}] ${todo.content}${suffix}`
		})
		.join("\n")
}

export function buildLocalPlanExecutionMessage({
	planText,
	planId,
	planPath,
	taskProgress,
	mode = "agent",
	selectedTodoIds,
	skipSubmission = false,
	forceNewAgent = false,
}: LocalPlanExecutionMessageInput): string {
	const normalizedPlan = normalizePlanText(planText)
	const normalizedTaskProgress = normalizePlanText(taskProgress)
	const action: ExecutePlanAction = {
		type: "ExecutePlanAction",
		isPlanExecution: true,
		planId,
		planUri: planPath,
		planContent: normalizedPlan,
		unifiedMode: mode,
		executionMode: mode,
		selectedTodoIds: selectedTodoIds ?? [],
		skipSubmission,
		targetEnvironment: "local",
		entrypoint: forceNewAgent
			? "plan_tab_build_new_agent"
			: mode === "multitask"
				? "plan_tab_build_parallel"
				: "plan_tab_build",
	}
	const modeLabel =
		mode === "multitask"
			? "Build this plan locally with parallel subagents in Act mode."
			: forceNewAgent
				? "Build the selected plan todos locally in a new Act-mode agent."
			: "Build this plan locally in Act mode."
	const routingRequirement =
		mode === "multitask"
			? "- Route this as a local parallel build using local subagents only. Do not start or transfer to a cloud/background build."
			: forceNewAgent
				? "- Route this as a brand-new local agent build for only the selected todos. Do not start or transfer to a cloud/background build."
			: "- Route this as a local agent build only. Do not start or transfer to a cloud/background build."
	const sections = [
		modeLabel,
		"",
		"The plan below is accepted and attached as the execution reference. Use it as the source of truth.",
		"",
		"<execute_plan_action>",
		JSON.stringify(action, null, 2),
		"</execute_plan_action>",
		"",
		"Execution requirements:",
		routingRequirement,
		"- Do not edit the plan file during execution.",
		"- Todos have already been created from the plan; do not recreate duplicate todos.",
		"- Mark todos in progress as you start each item, using task_progress to keep the single todo source of truth current.",
		"- Continue until every accepted todo is completed or intentionally cancelled.",
	]

	if (mode === "multitask") {
		sections.push("- Split independent accepted todos across local subagents where that is safe, then integrate and verify the combined result.")
	}

	if (selectedTodoIds?.length) {
		sections.push("", "<selected_todo_ids>", selectedTodoIds.join("\n"), "</selected_todo_ids>")
	}

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
