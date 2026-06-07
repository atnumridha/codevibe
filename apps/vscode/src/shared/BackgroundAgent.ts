export const BACKGROUND_AGENT_LIFECYCLE_STATUSES = [
	"queued",
	"preparing",
	"worktree_ready",
	"fallback_ready",
	"starting",
	"running",
	"failed",
] as const

export type BackgroundAgentLifecycleStatus = (typeof BACKGROUND_AGENT_LIFECYCLE_STATUSES)[number]

export interface BackgroundAgentTaskRecord {
	id: string
	source: "cursor-deeplink"
	status: BackgroundAgentLifecycleStatus
	agentMode: "plan"
	autoApprovalProfile: "read-only-plan-confirmation-required"
	worktreePolicy: "confirm-before-create"
	launchMode?: "worktree" | "controller-record"
	createdAt: number
	updatedAt: number
	prompt: string
	routePrompt?: string
	repository?: string
	requestedBranch?: string
	requestedBaseBranch?: string
	workspaceRoot?: string
	worktreePath?: string
	worktreeBranch?: string
	worktreeBaseRef?: string
	confirmationRequired: true
	fallbackReason?: string
	warning?: string
	taskId?: string
	errorMessage?: string
}

const STATUS_VALUES = new Set<string>(BACKGROUND_AGENT_LIFECYCLE_STATUSES)

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null
}

function isOptionalString(value: unknown): boolean {
	return value === undefined || typeof value === "string"
}

export function isBackgroundAgentTaskRecord(value: unknown): value is BackgroundAgentTaskRecord {
	if (!isRecord(value)) {
		return false
	}

	return (
		typeof value.id === "string" &&
		value.source === "cursor-deeplink" &&
		typeof value.status === "string" &&
		STATUS_VALUES.has(value.status) &&
		value.agentMode === "plan" &&
		value.autoApprovalProfile === "read-only-plan-confirmation-required" &&
		value.worktreePolicy === "confirm-before-create" &&
		(value.launchMode === undefined || value.launchMode === "worktree" || value.launchMode === "controller-record") &&
		typeof value.createdAt === "number" &&
		typeof value.updatedAt === "number" &&
		typeof value.prompt === "string" &&
		value.confirmationRequired === true &&
		isOptionalString(value.routePrompt) &&
		isOptionalString(value.repository) &&
		isOptionalString(value.requestedBranch) &&
		isOptionalString(value.requestedBaseBranch) &&
		isOptionalString(value.workspaceRoot) &&
		isOptionalString(value.worktreePath) &&
		isOptionalString(value.worktreeBranch) &&
		isOptionalString(value.worktreeBaseRef) &&
		isOptionalString(value.fallbackReason) &&
		isOptionalString(value.warning) &&
		isOptionalString(value.taskId) &&
		isOptionalString(value.errorMessage)
	)
}
