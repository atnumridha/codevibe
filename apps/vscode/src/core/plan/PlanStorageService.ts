import { parseYamlFrontmatter } from "@core/context/instructions/user-instructions/frontmatter"
import { openFile as openFileIntegration } from "@integrations/misc/open-file"
import {
	derivePlanBuildStatus,
	derivePlanStatus,
	generatePlanTodoId,
	getNonCompletedPlanTodoIds,
	getPlanTodos,
	markdownTodosToPlanTodos,
	normalizePlanText,
	normalizePlanTodoStatus,
	planMetadataToTaskProgress,
	removePlanTodos,
	updatePlanTodosStatus,
	type PlanBuildMode,
	type PlanMetadata,
	type PlanPhase,
	type PlanTodo,
	type PlanTodoStatus,
} from "@shared/plan-build"
import { getWorkspacePath } from "@utils/path"
import chokidar, { type FSWatcher } from "chokidar"
import { constants as fsConstants } from "fs"
import fs from "fs/promises"
import * as yaml from "js-yaml"
import os from "os"
import path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"

const REGISTRY_FILE_NAME = "composer.planRegistry.json"
const PLAN_EXTENSION = ".plan.md"

type PlanOpenHandler = (input: { planId?: string; planPath: string; workspacePath?: string }) => Promise<void>
export type PlanChangeEvent = {
	kind: "created" | "updated" | "deleted"
	planId?: string
	planPath?: string
}
type PlanChangeHandler = (event: PlanChangeEvent) => void

let planOpenHandler: PlanOpenHandler | undefined
const planChangeHandlers = new Set<PlanChangeHandler>()

export function registerPlanOpenHandler(handler: PlanOpenHandler): { dispose: () => void } {
	planOpenHandler = handler
	return {
		dispose: () => {
			if (planOpenHandler === handler) {
				planOpenHandler = undefined
			}
		},
	}
}

export function registerPlanChangeHandler(handler: PlanChangeHandler): { dispose: () => void } {
	planChangeHandlers.add(handler)
	return {
		dispose: () => {
			planChangeHandlers.delete(handler)
		},
	}
}

function emitPlanChange(event: PlanChangeEvent): void {
	for (const handler of planChangeHandlers) {
		try {
			handler(event)
		} catch (error) {
			Logger.warn(`PlanStorageService: plan change handler failed: ${error}`)
		}
	}
}

export interface PlanFileRecord {
	planId: string
	planPath: string
	metadata: PlanMetadata
	body: string
	serialized: string
	status: ReturnType<typeof derivePlanStatus>
	buildStatus: ReturnType<typeof derivePlanBuildStatus>
	todoCount: number
	completedTodoCount: number
}

export interface PlanRegistryBuildRecord {
	builderId: string
	mode: PlanBuildMode
	todoIds: string[]
	status: "active" | "complete" | "failed"
	startedAt: number
	updatedAt: number
}

export interface PlanRegistryRecord {
	id: string
	name: string
	uri: string
	createdBy: string
	editedBy: string[]
	referencedBy: string[]
	builtBy: PlanRegistryBuildRecord[]
	createdAt: number
	lastUpdatedAt: number
	status: ReturnType<typeof derivePlanStatus>
	redirects: string[]
}

interface PlanRegistryFile {
	version: 1
	plans: PlanRegistryRecord[]
}

interface CreateOrUpdatePlanInput {
	composerId: string
	response: string
	taskProgress?: string
	workspacePath?: string
}

interface UpdatePlanInput {
	planId?: string
	planPath?: string
	metadata: PlanMetadata
	body: string
	workspacePath?: string
}

interface BuildRegistrationInput {
	planId?: string
	planPath?: string
	mode: PlanBuildMode
	builderId: string
	todoIds?: string[]
	workspacePath?: string
}

export class PlanStorageService {
	private resolvedPlanDir?: string
	private watcher?: FSWatcher
	private migrated = false

	async getPlanDir(workspacePath?: string): Promise<string> {
		if (this.resolvedPlanDir) {
			return this.resolvedPlanDir
		}

		const envPlanDir = process.env.CODEVIBE_PLAN_HOME?.trim()
		if (envPlanDir) {
			this.resolvedPlanDir = await this.ensureWritablePlanDir(path.resolve(envPlanDir))
			await this.initializePlanDir(this.resolvedPlanDir)
			return this.resolvedPlanDir
		}

		const homePlanDir = path.join(os.homedir(), ".cursor", "plans")
		try {
			this.resolvedPlanDir = await this.ensureWritablePlanDir(homePlanDir)
		} catch (error) {
			const fallbackRoot = workspacePath || (await getWorkspacePath())
			if (!fallbackRoot) {
				throw error
			}
			Logger.warn(`PlanStorageService: falling back to workspace plan dir after home write failed: ${error}`)
			this.resolvedPlanDir = await this.ensureWritablePlanDir(path.join(fallbackRoot, ".cursor", "plans"))
			await this.ensureWorkspaceFallbackGitignore(fallbackRoot)
		}

		await this.initializePlanDir(this.resolvedPlanDir)
		return this.resolvedPlanDir
	}

	async listPlans(workspacePath?: string): Promise<PlanRegistryRecord[]> {
		const registry = await this.readRegistry(workspacePath)
		return registry.plans.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)
	}

	async readPlan(input: { planId?: string; planPath?: string; workspacePath?: string }): Promise<PlanFileRecord> {
		const planPath = await this.resolvePlanPath(input)
		const planId = input.planId || this.planIdFromPath(planPath)
		const serialized = await fs.readFile(planPath, "utf8")
		return this.attachRegistryBuildStatus(this.toPlanFileRecord(planId, planPath, serialized), input.workspacePath)
	}

	async createOrUpdatePlanForComposer(input: CreateOrUpdatePlanInput): Promise<PlanFileRecord> {
		const planDir = await this.getPlanDir(input.workspacePath)
		const existing = await this.findExistingComposerPlan(input.composerId, input.workspacePath)
		const metadata = this.createMetadataFromResponse(input.response, input.taskProgress, existing?.metadata)
		const planId = existing?.planId || (await this.createFreshPlanId(metadata.name, planDir))
		const planPath = existing?.planPath || path.join(planDir, `${planId}${PLAN_EXTENSION}`)
		const body = normalizePlanText(input.response)
		const serialized = this.serializePlan(metadata, body)

		await fs.writeFile(planPath, serialized, "utf8")
		const record = this.toPlanFileRecord(planId, planPath, serialized)
		await this.upsertRegistryEntry(record, {
			createdBy: input.composerId,
			editedBy: [input.composerId],
			referencedBy: [input.composerId],
		})
		emitPlanChange({ kind: existing ? "updated" : "created", planId, planPath })
		return record
	}

	async updatePlan(input: UpdatePlanInput): Promise<PlanFileRecord> {
		const planPath = await this.resolvePlanPath(input)
		const planId = input.planId || this.planIdFromPath(planPath)
		const metadata = this.normalizeMetadata(input.metadata)
		const serialized = this.serializePlan(metadata, normalizePlanText(input.body))
		await fs.writeFile(planPath, serialized, "utf8")
		const record = this.toPlanFileRecord(planId, planPath, serialized)
		await this.upsertRegistryEntry(record, { editedBy: ["user"] })
		emitPlanChange({ kind: "updated", planId, planPath })
		return record
	}

	async updateTodoStatus(input: {
		planId?: string
		planPath?: string
		todoIds: string[]
		status: PlanTodoStatus
		workspacePath?: string
	}): Promise<PlanFileRecord> {
		const current = await this.readPlan(input)
		const metadata = updatePlanTodosStatus(current.metadata, input.todoIds, input.status)
		return this.updatePlan({
			planId: current.planId,
			planPath: current.planPath,
			metadata,
			body: current.body,
			workspacePath: input.workspacePath,
		})
	}

	async updateTodoContent(input: {
		planId?: string
		planPath?: string
		todoId: string
		content: string
		workspacePath?: string
	}): Promise<PlanFileRecord> {
		const current = await this.readPlan(input)
		const content = input.content.trim() || "New todo"
		const metadata = this.mapMetadataTodos(current.metadata, (todo) =>
			todo.id === input.todoId ? { ...todo, content } : todo,
		)
		return this.updatePlan({
			planId: current.planId,
			planPath: current.planPath,
			metadata,
			body: current.body,
			workspacePath: input.workspacePath,
		})
	}

	async splitTodo(input: {
		planId?: string
		planPath?: string
		todoId: string
		beforeContent: string
		afterContent: string
		workspacePath?: string
	}): Promise<PlanFileRecord> {
		const current = await this.readPlan(input)
		const metadata = this.splitMetadataTodo(current.metadata, input.todoId, input.beforeContent, input.afterContent)
		return this.updatePlan({
			planId: current.planId,
			planPath: current.planPath,
			metadata,
			body: current.body,
			workspacePath: input.workspacePath,
		})
	}

	async mergeTodoBackward(input: {
		planId?: string
		planPath?: string
		todoId: string
		workspacePath?: string
	}): Promise<PlanFileRecord> {
		const current = await this.readPlan(input)
		const metadata = this.mergeMetadataTodoBackward(current.metadata, input.todoId)
		return this.updatePlan({
			planId: current.planId,
			planPath: current.planPath,
			metadata,
			body: current.body,
			workspacePath: input.workspacePath,
		})
	}

	async removeTodoIds(input: {
		planId?: string
		planPath?: string
		todoIds: string[]
		workspacePath?: string
	}): Promise<PlanFileRecord> {
		const current = await this.readPlan(input)
		const metadata = removePlanTodos(current.metadata, input.todoIds)
		return this.updatePlan({
			planId: current.planId,
			planPath: current.planPath,
			metadata,
			body: current.body,
			workspacePath: input.workspacePath,
		})
	}

	async registerBuild(input: BuildRegistrationInput): Promise<{ plan: PlanFileRecord; todoIds: string[] }> {
		const current = await this.readPlan(input)
		const todoIds = input.todoIds?.length ? input.todoIds : getNonCompletedPlanTodoIds(current.metadata)
		const registry = await this.readRegistry(input.workspacePath)
		const entry = this.findOrCreateRegistryEntry(registry, current)
		const now = Date.now()
		entry.builtBy = [
			...entry.builtBy.filter((build) => build.builderId !== input.builderId),
			{
				builderId: input.builderId,
				mode: input.mode,
				todoIds,
				status: "active",
				startedAt: now,
				updatedAt: now,
			},
		]
		entry.referencedBy = this.unique([...entry.referencedBy, input.builderId])
		entry.lastUpdatedAt = now
		entry.status = current.status
		await this.writeRegistry(registry, input.workspacePath)
		emitPlanChange({ kind: "updated", planId: current.planId, planPath: current.planPath })
		return { plan: { ...current, buildStatus: derivePlanBuildStatus(current.metadata, todoIds) }, todoIds }
	}

	async rollbackBuild(input: { planId?: string; planPath?: string; builderId: string; workspacePath?: string }): Promise<void> {
		const current = await this.readPlan(input)
		const registry = await this.readRegistry(input.workspacePath)
		const entry = registry.plans.find((plan) => plan.id === current.planId)
		if (!entry) {
			return
		}
		entry.builtBy = entry.builtBy.filter((build) => build.builderId !== input.builderId)
		entry.lastUpdatedAt = Date.now()
		await this.writeRegistry(registry, input.workspacePath)
		emitPlanChange({ kind: "updated", planId: current.planId, planPath: current.planPath })
	}

	async openPlan(input: { planId?: string; planPath?: string; workspacePath?: string }): Promise<void> {
		const planPath = await this.resolvePlanPath(input)
		if (planOpenHandler) {
			try {
				await planOpenHandler({
					planId: input.planId,
					planPath,
					workspacePath: input.workspacePath,
				})
				return
			} catch (error) {
				Logger.warn(`PlanStorageService: native plan opener failed, falling back to text editor: ${error}`)
			}
		}
		await openFileIntegration(planPath)
	}

	planToTaskProgress(plan: PlanFileRecord, todoIds?: string[]): string {
		return planMetadataToTaskProgress(plan.metadata, todoIds)
	}

	async dispose(): Promise<void> {
		const watcher = this.watcher
		this.watcher = undefined
		this.resolvedPlanDir = undefined
		this.migrated = false
		if (watcher) {
			await watcher.close()
		}
	}

	private async initializePlanDir(planDir: string): Promise<void> {
		await this.migrateLegacyPlans(planDir)
		this.startWatcher(planDir)
		await this.readRegistry()
	}

	private async ensureWritablePlanDir(planDir: string): Promise<string> {
		await fs.mkdir(planDir, { recursive: true })
		await fs.access(planDir, fsConstants.W_OK)
		return planDir
	}

	private async ensureWorkspaceFallbackGitignore(workspaceRoot: string): Promise<void> {
		const cursorDir = path.join(workspaceRoot, ".cursor")
		const gitignorePath = path.join(cursorDir, ".gitignore")
		await fs.mkdir(cursorDir, { recursive: true })
		let existing = ""
		try {
			existing = await fs.readFile(gitignorePath, "utf8")
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error
			}
		}
		const lines = existing.split(/\r?\n/).map((line) => line.trim())
		if (lines.includes("plans/")) {
			return
		}
		const prefix = existing && !existing.endsWith("\n") ? "\n" : ""
		await fs.writeFile(gitignorePath, `${existing}${prefix}plans/\n`, "utf8")
	}

	private startWatcher(planDir: string): void {
		if (this.watcher) {
			return
		}
		this.watcher = chokidar.watch(planDir, {
			ignoreInitial: true,
			depth: 1,
			awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
		})
		this.watcher.on("all", (event, filePath) => {
			if (filePath.endsWith(PLAN_EXTENSION) || path.basename(filePath) === REGISTRY_FILE_NAME) {
				Logger.debug(`PlanStorageService: observed plan storage change ${filePath}`)
				if (filePath.endsWith(PLAN_EXTENSION)) {
					emitPlanChange({
						kind: event === "unlink" ? "deleted" : "updated",
						planId: this.planIdFromPath(filePath),
						planPath: filePath,
					})
				}
			}
		})
	}

	private async migrateLegacyPlans(planDir: string): Promise<void> {
		if (this.migrated) {
			return
		}
		this.migrated = true
		const legacyDirs = [
			HostProvider.isInitialized() ? path.join(HostProvider.get().globalStorageFsPath, "plans") : "",
			path.join(os.homedir(), ".codevibe", "plans"),
			path.join(os.homedir(), ".cline", "plans"),
		].filter(Boolean)

		for (const legacyDir of legacyDirs) {
			try {
				const entries = await fs.readdir(legacyDir, { withFileTypes: true })
				for (const entry of entries) {
					if (!entry.isFile() || !entry.name.endsWith(PLAN_EXTENSION)) {
						continue
					}
					const fromPath = path.join(legacyDir, entry.name)
					const toPath = path.join(planDir, entry.name)
					try {
						await fs.copyFile(fromPath, toPath, fsConstants.COPYFILE_EXCL)
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
							Logger.warn(`PlanStorageService: failed to migrate ${fromPath}: ${error}`)
						}
					}
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
					Logger.warn(`PlanStorageService: failed to inspect legacy plan dir ${legacyDir}: ${error}`)
				}
			}
		}
	}

	private async readRegistry(workspacePath?: string): Promise<PlanRegistryFile> {
		const planDir = await this.getPlanDir(workspacePath)
		const registryPath = path.join(planDir, REGISTRY_FILE_NAME)
		try {
			const raw = await fs.readFile(registryPath, "utf8")
			const parsed = JSON.parse(raw) as Partial<PlanRegistryFile>
			if (Array.isArray(parsed.plans)) {
				return { version: 1, plans: parsed.plans.map((entry) => this.normalizeRegistryEntry(entry)) }
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				Logger.warn(`PlanStorageService: failed to read plan registry: ${error}`)
			}
		}

		const registry = await this.scanRegistry(planDir)
		await this.writeRegistry(registry, workspacePath)
		return registry
	}

	private async writeRegistry(registry: PlanRegistryFile, workspacePath?: string): Promise<void> {
		const planDir = await this.getPlanDir(workspacePath)
		const registryPath = path.join(planDir, REGISTRY_FILE_NAME)
		await fs.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8")
	}

	private async scanRegistry(planDir: string): Promise<PlanRegistryFile> {
		const plans: PlanRegistryRecord[] = []
		const entries = await fs.readdir(planDir, { withFileTypes: true })
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(PLAN_EXTENSION)) {
				continue
			}
			const planPath = path.join(planDir, entry.name)
			try {
				const serialized = await fs.readFile(planPath, "utf8")
				const record = this.toPlanFileRecord(this.planIdFromPath(planPath), planPath, serialized)
				plans.push(this.createRegistryEntry(record, { createdBy: "migration" }))
			} catch (error) {
				Logger.warn(`PlanStorageService: failed to parse plan ${planPath}: ${error}`)
			}
		}
		return { version: 1, plans }
	}

	private async upsertRegistryEntry(
		plan: PlanFileRecord,
		options?: { createdBy?: string; editedBy?: string[]; referencedBy?: string[] },
	): Promise<void> {
		const registry = await this.readRegistry()
		const entry = this.findOrCreateRegistryEntry(registry, plan)
		entry.name = plan.metadata.name
		entry.uri = plan.planPath
		entry.status = plan.status
		entry.lastUpdatedAt = Date.now()
		if (options?.createdBy && !entry.createdBy) {
			entry.createdBy = options.createdBy
		}
		if (options?.editedBy) {
			entry.editedBy = this.unique([...entry.editedBy, ...options.editedBy])
		}
		if (options?.referencedBy) {
			entry.referencedBy = this.unique([...entry.referencedBy, ...options.referencedBy])
		}
		await this.writeRegistry(registry)
	}

	private findOrCreateRegistryEntry(registry: PlanRegistryFile, plan: PlanFileRecord): PlanRegistryRecord {
		let entry = registry.plans.find((candidate) => candidate.id === plan.planId)
		if (!entry) {
			entry = this.createRegistryEntry(plan)
			registry.plans.push(entry)
		}
		return entry
	}

	private createRegistryEntry(
		plan: PlanFileRecord,
		options?: { createdBy?: string; editedBy?: string[]; referencedBy?: string[] },
	): PlanRegistryRecord {
		const now = Date.now()
		return {
			id: plan.planId,
			name: plan.metadata.name,
			uri: plan.planPath,
			createdBy: options?.createdBy || "local",
			editedBy: options?.editedBy || [],
			referencedBy: options?.referencedBy || [],
			builtBy: [],
			createdAt: now,
			lastUpdatedAt: now,
			status: plan.status,
			redirects: [],
		}
	}

	private normalizeRegistryEntry(entry: any): PlanRegistryRecord {
		return {
			id: String(entry.id || ""),
			name: String(entry.name || "Untitled plan"),
			uri: String(entry.uri || ""),
			createdBy: String(entry.createdBy || entry.created_by || "local"),
			editedBy: Array.isArray(entry.editedBy) ? entry.editedBy.map(String) : [],
			referencedBy: Array.isArray(entry.referencedBy) ? entry.referencedBy.map(String) : [],
			builtBy: Array.isArray(entry.builtBy)
				? entry.builtBy.map((build: any) => ({
						builderId: String(build.builderId || ""),
						mode: this.normalizeBuildMode(build.mode),
						todoIds: Array.isArray(build.todoIds) ? build.todoIds.map(String) : [],
						status: build.status === "complete" || build.status === "failed" ? build.status : "active",
						startedAt: Number(build.startedAt || Date.now()),
						updatedAt: Number(build.updatedAt || Date.now()),
					}))
				: [],
			createdAt: Number(entry.createdAt || entry.created_at || Date.now()),
			lastUpdatedAt: Number(entry.lastUpdatedAt || entry.last_updated_at || Date.now()),
			status: entry.status === "complete" || entry.status === "in_progress" ? entry.status : "pending",
			redirects: Array.isArray(entry.redirects) ? entry.redirects.map(String) : [],
		}
	}

	private async resolvePlanPath(input: { planId?: string; planPath?: string; workspacePath?: string }): Promise<string> {
		if (input.planPath) {
			return input.planPath
		}
		if (!input.planId) {
			throw new Error("Plan id or plan path is required")
		}
		const planDir = await this.getPlanDir(input.workspacePath)
		return path.join(planDir, `${this.slugify(input.planId)}${PLAN_EXTENSION}`)
	}

	private async readPlanIfExists(planPath: string, planId: string): Promise<PlanFileRecord | undefined> {
		try {
			const serialized = await fs.readFile(planPath, "utf8")
			return this.toPlanFileRecord(planId, planPath, serialized)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return undefined
			}
			throw error
		}
	}

	private async findExistingComposerPlan(
		composerId: string,
		workspacePath?: string,
	): Promise<PlanFileRecord | undefined> {
		const registry = await this.readRegistry(workspacePath)
		const entry = registry.plans.find(
			(plan) =>
				plan.createdBy === composerId ||
				plan.editedBy.includes(composerId) ||
				plan.referencedBy.includes(composerId),
		)
		if (!entry?.uri) {
			return undefined
		}
		try {
			return await this.readPlanIfExists(entry.uri, entry.id)
		} catch (error) {
			Logger.warn(`PlanStorageService: failed to reuse composer plan ${entry.id}: ${error}`)
			return undefined
		}
	}

	private async createFreshPlanId(name: string, planDir: string): Promise<string> {
		const baseName = this.slugify(name) || "plan"
		for (let attempt = 0; attempt < 10; attempt++) {
			const shortId = Math.random().toString(36).slice(2, 10)
			const planId = `${baseName}_${shortId}`
			try {
				await fs.access(path.join(planDir, `${planId}${PLAN_EXTENSION}`))
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					return planId
				}
				throw error
			}
		}
		return `${baseName}_${Date.now().toString(36)}`
	}

	private toPlanFileRecord(planId: string, planPath: string, serialized: string): PlanFileRecord {
		const parsed = this.parsePlan(serialized)
		const todos = getPlanTodos(parsed.metadata)
		const completedTodoCount = todos.filter((todo) => todo.status === "completed" || todo.status === "cancelled").length
		return {
			planId,
			planPath,
			metadata: parsed.metadata,
			body: parsed.body,
			serialized,
			status: derivePlanStatus(parsed.metadata),
			buildStatus: derivePlanBuildStatus(parsed.metadata),
			todoCount: todos.length,
			completedTodoCount,
		}
	}

	private async attachRegistryBuildStatus(record: PlanFileRecord, workspacePath?: string): Promise<PlanFileRecord> {
		try {
			const registry = await this.readRegistry(workspacePath)
			const entry = registry.plans.find((plan) => plan.id === record.planId)
			const activeTodoIds =
				entry?.builtBy.filter((build) => build.status === "active").flatMap((build) => build.todoIds) ?? []
			return {
				...record,
				buildStatus: derivePlanBuildStatus(record.metadata, activeTodoIds),
			}
		} catch (error) {
			Logger.debug(`PlanStorageService: build status registry lookup skipped: ${error}`)
			return record
		}
	}

	private parsePlan(serialized: string): { metadata: PlanMetadata; body: string } {
		let parsed = parseYamlFrontmatter(serialized)
		if (parsed.parseError) {
			const sanitized = this.sanitizeFrontmatter(serialized)
			const sanitizedParsed = parseYamlFrontmatter(sanitized)
			if (!sanitizedParsed.parseError) {
				parsed = sanitizedParsed
			}
		}

		const body = parsed.hadFrontmatter && !parsed.parseError ? parsed.body : serialized
		const metadata = this.normalizeMetadata(parsed.data)
		if (getPlanTodos(metadata).length === 0) {
			const legacyTodos = this.parseLegacyTodos(body)
			if (legacyTodos.length > 0) {
				metadata.todos = legacyTodos
			}
		}
		return { metadata, body: normalizePlanText(body) }
	}

	private createMetadataFromResponse(response: string, taskProgress?: string, existing?: PlanMetadata): PlanMetadata {
		const sourceTodos = taskProgress?.trim() ? taskProgress : response
		const nextTodos = markdownTodosToPlanTodos(sourceTodos)
		const existingByContent = new Map(getPlanTodos(existing).map((todo) => [todo.content, todo]))
		const todos = nextTodos.map((todo) => {
			const previous = existingByContent.get(todo.content)
			return previous ? { ...todo, id: previous.id, status: previous.status, dependencies: previous.dependencies } : todo
		})
		const phases = this.extractPhases(response, existing)
		const name = existing?.name || this.extractPlanName(response)
		const overview = existing?.overview || this.extractOverview(response)
		return this.normalizeMetadata({
			name,
			overview,
			todos: phases.length > 0 ? [] : todos.map((todo) => ({ ...todo, status: "pending" })),
			isProject: existing?.isProject || phases.length > 0,
			phases:
				phases.length > 0
					? phases.map((phase) => ({
							...phase,
							todos: phase.todos.map((todo) => ({ ...todo, status: "pending" })),
						}))
					: undefined,
		})
	}

	private normalizeMetadata(value: unknown): PlanMetadata {
		const data = typeof value === "object" && value ? (value as Record<string, unknown>) : {}
		const todos = this.normalizeTodos(data.todos)
		const phases = this.normalizePhases(data.phases)
		return {
			name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Untitled plan",
			overview: typeof data.overview === "string" ? data.overview.trim() : "",
			todos,
			isProject: data.isProject === true || data.is_project === true || phases.length > 0,
			phases: phases.length > 0 ? phases : undefined,
		}
	}

	private normalizeTodos(value: unknown): PlanTodo[] {
		if (!Array.isArray(value)) {
			return []
		}
		return value
			.map((todo, index) => {
				if (typeof todo === "string") {
					return {
						id: generatePlanTodoId(Date.now() + index),
						content: todo.trim(),
						status: "pending" as const,
						dependencies: [],
					}
				}
				if (!todo || typeof todo !== "object") {
					return undefined
				}
				const data = todo as Record<string, unknown>
				const content = typeof data.content === "string" ? data.content.trim() : ""
				if (!content) {
					return undefined
				}
				return {
					id: typeof data.id === "string" && data.id.trim() ? data.id.trim() : generatePlanTodoId(Date.now() + index),
					content,
					status: normalizePlanTodoStatus(data.status),
					dependencies: Array.isArray(data.dependencies) ? data.dependencies.map(String) : [],
				}
			})
			.filter((todo): todo is PlanTodo => Boolean(todo))
	}

	private normalizePhases(value: unknown): PlanPhase[] {
		if (!Array.isArray(value)) {
			return []
		}
		return value
			.map((phase) => {
				if (!phase || typeof phase !== "object") {
					return undefined
				}
				const data = phase as Record<string, unknown>
				const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Phase"
				return { name, todos: this.normalizeTodos(data.todos) }
			})
			.filter((phase): phase is PlanPhase => Boolean(phase && phase.todos.length > 0))
	}

	private serializePlan(metadata: PlanMetadata, body: string): string {
		const frontmatter = yaml.dump(metadata, {
			schema: yaml.JSON_SCHEMA,
			lineWidth: 0,
			noRefs: true,
			sortKeys: false,
		})
		return `---\n${frontmatter}---\n\n${normalizePlanText(body)}\n`
	}

	private sanitizeFrontmatter(serialized: string): string {
		const match = serialized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
		if (!match) {
			return serialized
		}
		const sanitizedYaml = match[1]
			.split(/\r?\n/)
			.map((line) => {
				const colonValue = line.match(/^(\s*(?:-\s*)?(?:name|overview|content):\s*)(.+:.+)$/)
				if (!colonValue) {
					return line
				}
				return `${colonValue[1]}${JSON.stringify(colonValue[2].trim())}`
			})
			.join("\n")
		return `---\n${sanitizedYaml}\n---\n${match[2]}`
	}

	private parseLegacyTodos(body: string): PlanTodo[] {
		const lines = normalizePlanText(body).split("\n")
		const todoLines: string[] = []
		let inTodosSection = false
		for (const line of lines) {
			if (/^#{2,4}\s*to-?dos?\s*$/i.test(line.trim())) {
				inTodosSection = true
				continue
			}
			if (inTodosSection && /^#{1,4}\s+/.test(line.trim())) {
				break
			}
			if (inTodosSection) {
				todoLines.push(line)
			}
		}
		return markdownTodosToPlanTodos(todoLines.join("\n"))
	}

	private extractPhases(response: string, existing?: PlanMetadata): PlanPhase[] {
		const lines = normalizePlanText(response).split("\n")
		const phases: PlanPhase[] = []
		let currentPhase: { name: string; lines: string[] } | undefined
		for (const line of lines) {
			const heading = line.match(/^#{2,4}\s*(phase\s+\d+[:.-]?\s*.+|.+\s+phase)\s*$/i)
			if (heading) {
				if (currentPhase) {
					const todos = this.createPhaseTodos(currentPhase, existing)
					if (todos.length > 0) {
						phases.push({ name: currentPhase.name, todos })
					}
				}
				currentPhase = { name: heading[1].trim(), lines: [] }
				continue
			}
			currentPhase?.lines.push(line)
		}
		if (currentPhase) {
			const todos = this.createPhaseTodos(currentPhase, existing)
			if (todos.length > 0) {
				phases.push({ name: currentPhase.name, todos })
			}
		}
		return phases
	}

	private mapMetadataTodos(metadata: PlanMetadata, mapper: (todo: PlanTodo) => PlanTodo): PlanMetadata {
		return {
			...metadata,
			todos: metadata.todos.map(mapper),
			phases: metadata.phases?.map((phase) => ({ ...phase, todos: phase.todos.map(mapper) })),
		}
	}

	private splitMetadataTodo(metadata: PlanMetadata, todoId: string, beforeContent: string, afterContent: string): PlanMetadata {
		const splitList = (todos: PlanTodo[]): PlanTodo[] => {
			const index = todos.findIndex((todo) => todo.id === todoId)
			if (index < 0) {
				return todos
			}
			const current = todos[index]
			const before = beforeContent.trim()
			const after = afterContent.trim()
			const next = [...todos]
			const inserted: PlanTodo = {
				id: generatePlanTodoId(),
				content: after || "New todo",
				status: "pending",
				dependencies: [],
			}
			if (!before) {
				next.splice(index, 0, { ...inserted, content: "New todo" })
				return next
			}
			next.splice(index, 1, { ...current, content: before }, inserted)
			return next
		}

		return {
			...metadata,
			todos: splitList(metadata.todos),
			phases: metadata.phases?.map((phase) => ({ ...phase, todos: splitList(phase.todos) })),
		}
	}

	private mergeMetadataTodoBackward(metadata: PlanMetadata, todoId: string): PlanMetadata {
		const mergeList = (todos: PlanTodo[]): PlanTodo[] => {
			const index = todos.findIndex((todo) => todo.id === todoId)
			if (index <= 0) {
				return todos
			}
			const previous = todos[index - 1]
			const current = todos[index]
			const next = [...todos]
			next[index - 1] = {
				...previous,
				content: [previous.content, current.content].filter(Boolean).join(" ").trim() || previous.content,
			}
			next.splice(index, 1)
			return next
		}

		return {
			...metadata,
			todos: mergeList(metadata.todos),
			phases: metadata.phases?.map((phase) => ({ ...phase, todos: mergeList(phase.todos) })),
		}
	}

	private createPhaseTodos(phase: { name: string; lines: string[] }, existing?: PlanMetadata): PlanTodo[] {
		const existingByContent = new Map(getPlanTodos(existing).map((todo) => [todo.content, todo]))
		return markdownTodosToPlanTodos(phase.lines.join("\n")).map((todo) => {
			const previous = existingByContent.get(todo.content)
			return previous ? { ...todo, id: previous.id, status: previous.status, dependencies: previous.dependencies } : todo
		})
	}

	private extractPlanName(response: string): string {
		const heading = normalizePlanText(response)
			.split("\n")
			.find((line) => /^#{1,3}\s+\S+/.test(line.trim()))
		if (heading) {
			return heading.replace(/^#{1,3}\s+/, "").trim()
		}
		return "Plan"
	}

	private extractOverview(response: string): string {
		const paragraph = normalizePlanText(response)
			.split(/\n{2,}/)
			.map((part) => part.trim())
			.find((part) => part && !part.startsWith("#") && !part.startsWith("- ["))
		return paragraph || ""
	}

	private planIdFromPath(planPath: string): string {
		return path.basename(planPath, PLAN_EXTENSION)
	}

	private slugify(value: string): string {
		return value
			.trim()
			.replace(/[^a-zA-Z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 96)
	}

	private normalizeBuildMode(value: unknown): PlanBuildMode {
		return value === "project" || value === "multitask" ? value : "agent"
	}

	private unique(values: string[]): string[] {
		return Array.from(new Set(values.filter(Boolean)))
	}
}

let singleton: PlanStorageService | undefined

export function getPlanStorageService(): PlanStorageService {
	singleton ??= new PlanStorageService()
	return singleton
}

export function resetPlanStorageServiceForTests(): void {
	const existing = singleton
	singleton = undefined
	planOpenHandler = undefined
	planChangeHandlers.clear()
	if (existing) {
		void existing.dispose().catch((error) => Logger.warn(`PlanStorageService: test reset failed to dispose: ${error}`))
	}
}

export async function disposePlanStorageServiceForTests(): Promise<void> {
	const existing = singleton
	singleton = undefined
	planOpenHandler = undefined
	planChangeHandlers.clear()
	await existing?.dispose()
}
