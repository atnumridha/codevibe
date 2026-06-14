import type { PlanFileRecord, PlanRegistryRecord } from "@core/plan/PlanStorageService"
import type { PlanMetadata as SharedPlanMetadata, PlanPhase as SharedPlanPhase, PlanTodo as SharedPlanTodo } from "@shared/plan-build"
import {
	PlanFile,
	PlanMetadata,
	PlanPhase,
	PlanRegistry,
	PlanRegistryEntry,
	PlanTodo,
} from "@shared/proto/cline/plan"

export function toProtoTodo(todo: SharedPlanTodo): PlanTodo {
	return PlanTodo.create({
		id: todo.id,
		content: todo.content,
		status: todo.status,
		dependencies: todo.dependencies,
	})
}

export function toProtoPhase(phase: SharedPlanPhase): PlanPhase {
	return PlanPhase.create({
		name: phase.name,
		todos: phase.todos.map(toProtoTodo),
	})
}

export function toProtoMetadata(metadata: SharedPlanMetadata): PlanMetadata {
	return PlanMetadata.create({
		name: metadata.name,
		overview: metadata.overview,
		todos: metadata.todos.map(toProtoTodo),
		isProject: metadata.isProject,
		phases: metadata.phases?.map(toProtoPhase) || [],
	})
}

export function fromProtoMetadata(metadata?: PlanMetadata): SharedPlanMetadata {
	return {
		name: metadata?.name || "Untitled plan",
		overview: metadata?.overview || "",
		todos:
			metadata?.todos.map((todo) => ({
				id: todo.id,
				content: todo.content,
				status:
					todo.status === "in_progress" || todo.status === "completed" || todo.status === "cancelled"
						? todo.status
						: "pending",
				dependencies: todo.dependencies,
			})) || [],
		isProject: Boolean(metadata?.isProject),
		phases:
			metadata?.phases.map((phase) => ({
				name: phase.name,
				todos: phase.todos.map((todo) => ({
					id: todo.id,
					content: todo.content,
					status:
						todo.status === "in_progress" || todo.status === "completed" || todo.status === "cancelled"
							? todo.status
							: "pending",
					dependencies: todo.dependencies,
				})),
			})) || [],
	}
}

export function toProtoPlanFile(plan: PlanFileRecord): PlanFile {
	return PlanFile.create({
		planId: plan.planId,
		planPath: plan.planPath,
		metadata: toProtoMetadata(plan.metadata),
		body: plan.body,
		serialized: plan.serialized,
		status: plan.status,
		todoCount: plan.todoCount,
		completedTodoCount: plan.completedTodoCount,
		buildStatus: plan.buildStatus,
	})
}

export function toProtoRegistryEntry(entry: PlanRegistryRecord): PlanRegistryEntry {
	return PlanRegistryEntry.create({
		id: entry.id,
		name: entry.name,
		uri: entry.uri,
		createdBy: entry.createdBy,
		editedBy: entry.editedBy,
		referencedBy: entry.referencedBy,
		builtBy: entry.builtBy.map((build) => `${build.mode}:${build.status}:${build.todoIds.join(",")}`),
		createdAt: entry.createdAt,
		lastUpdatedAt: entry.lastUpdatedAt,
		status: entry.status,
		redirects: entry.redirects,
	})
}

export function toProtoRegistry(entries: PlanRegistryRecord[]): PlanRegistry {
	return PlanRegistry.create({ plans: entries.map(toProtoRegistryEntry) })
}
