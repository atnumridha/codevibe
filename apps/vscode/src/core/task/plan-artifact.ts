import { ensureTaskDirectoryExists } from "@core/storage/disk"
import {
	extractMarkdownTodos,
	normalizePlanText,
	resetMarkdownTodosToPending,
	type LocalPlanBuildMetadata,
} from "@shared/plan-build"
import fs from "fs/promises"
import path from "path"

export async function writeLocalPlanArtifact({
	taskId,
	response,
	taskProgress,
}: {
	taskId: string
	response: string
	taskProgress?: string
}): Promise<LocalPlanBuildMetadata> {
	const taskDir = await ensureTaskDirectoryExists(taskId)
	const planId = `local-plan-${taskId}`
	const planPath = path.join(taskDir, `${planId}.plan.md`)
	const normalizedResponse = normalizePlanText(response)
	const pendingTodos = resetMarkdownTodosToPending(taskProgress || response)
	const todoCount = extractMarkdownTodos(pendingTodos).length
	const createdAt = new Date().toISOString()
	const content = [
		"---",
		`planId: ${planId}`,
		`taskId: ${taskId}`,
		`createdAt: ${createdAt}`,
		"status: pending",
		"---",
		"",
		`# Plan for Task ${taskId}`,
		"",
		"## Plan",
		"",
		normalizedResponse,
		"",
		"## Todos",
		"",
		pendingTodos || "_No explicit todos were provided with this plan._",
		"",
	].join("\n")

	await fs.writeFile(planPath, content, "utf8")

	return {
		planId,
		planPath,
		todoCount,
		status: "none",
	}
}
