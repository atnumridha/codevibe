import type { LocalPlanBuildMetadata, PlanTodoStatus } from "@shared/plan-build"
import { cyclePlanTodoStatus, generatePlanTodoId, PLAN_TODO_STATUSES } from "@shared/plan-build"
import {
	BuildPlanRequest,
	PlanRequest,
	PlanTodoStatusRequest,
	PlanUpdateRequest,
	type PlanFile,
	type PlanMetadata,
	type PlanPhase,
	type PlanTodo,
} from "@shared/proto/cline/plan"
import {
	CheckCircle2Icon,
	CircleIcon,
	CircleSlashIcon,
	CopyIcon,
	ExternalLinkIcon,
	FileTextIcon,
	GitBranchIcon,
	LoaderCircleIcon,
	PlayIcon,
	SaveIcon,
	SearchIcon,
	SparklesIcon,
	Trash2Icon,
} from "lucide-react"
import { KeyboardEvent, MouseEvent, memo, useEffect, useMemo, useRef, useState } from "react"
import { CopyButton } from "@/components/common/CopyButton"
import MarkdownBlock from "@/components/common/MarkdownBlock"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { PlanServiceClient } from "@/services/grpc-client"

interface PlanCompletionOutputProps {
	text: string
	onCopy?: () => void
	headClassNames?: string
	localPlanBuild?: LocalPlanBuildMetadata
	canBuild?: boolean
}

interface FlattenedTodo {
	todo: PlanTodo
	phaseIndex?: number
	todoIndex: number
	phaseName?: string
}

const statusIcons = {
	pending: CircleIcon,
	in_progress: LoaderCircleIcon,
	completed: CheckCircle2Icon,
	cancelled: CircleSlashIcon,
} satisfies Record<PlanTodoStatus, typeof CircleIcon>

const statusLabels = {
	pending: "Pending",
	in_progress: "In Progress",
	completed: "Completed",
	cancelled: "Cancelled",
} satisfies Record<PlanTodoStatus, string>

function createEmptyMetadata(): PlanMetadata {
	return {
		name: "Plan",
		overview: "",
		todos: [],
		isProject: false,
		phases: [],
	}
}

function normalizeMetadata(metadata?: PlanMetadata): PlanMetadata {
	return {
		name: metadata?.name || "Plan",
		overview: metadata?.overview || "",
		todos: metadata?.todos || [],
		isProject: Boolean(metadata?.isProject),
		phases: metadata?.phases || [],
	}
}

function flattenTodos(metadata: PlanMetadata): FlattenedTodo[] {
	const topLevel = metadata.todos.map((todo, todoIndex) => ({ todo, todoIndex }))
	const phaseTodos = metadata.phases.flatMap((phase, phaseIndex) =>
		phase.todos.map((todo, todoIndex) => ({
			todo,
			phaseIndex,
			todoIndex,
			phaseName: phase.name,
		})),
	)
	return [...topLevel, ...phaseTodos]
}

function mapTodos(metadata: PlanMetadata, mapper: (todo: PlanTodo) => PlanTodo): PlanMetadata {
	return {
		...metadata,
		todos: metadata.todos.map(mapper),
		phases: metadata.phases.map((phase) => ({ ...phase, todos: phase.todos.map(mapper) })),
	}
}

function updateTodo(metadata: PlanMetadata, todoId: string, updater: (todo: PlanTodo) => PlanTodo): PlanMetadata {
	return mapTodos(metadata, (todo) => (todo.id === todoId ? updater(todo) : todo))
}

function removeTodos(metadata: PlanMetadata, todoIds: string[]): PlanMetadata {
	const idSet = new Set(todoIds)
	return {
		...metadata,
		todos: metadata.todos.filter((todo) => !idSet.has(todo.id)),
		phases: metadata.phases.map((phase) => ({ ...phase, todos: phase.todos.filter((todo) => !idSet.has(todo.id)) })),
	}
}

function insertTodoAfter(metadata: PlanMetadata, todoId: string, todo: PlanTodo): PlanMetadata {
	const topIndex = metadata.todos.findIndex((candidate) => candidate.id === todoId)
	if (topIndex >= 0) {
		const todos = [...metadata.todos]
		todos.splice(topIndex + 1, 0, todo)
		return { ...metadata, todos }
	}
	return {
		...metadata,
		phases: metadata.phases.map((phase) => {
			const index = phase.todos.findIndex((candidate) => candidate.id === todoId)
			if (index < 0) {
				return phase
			}
			const todos = [...phase.todos]
			todos.splice(index + 1, 0, todo)
			return { ...phase, todos }
		}),
	}
}

function moveFocus(inputRefs: React.MutableRefObject<Map<string, HTMLInputElement>>, todoId: string): void {
	window.requestAnimationFrame(() => inputRefs.current.get(todoId)?.focus())
}

function statusFromString(status: string): PlanTodoStatus {
	return status === "in_progress" || status === "completed" || status === "cancelled" ? status : "pending"
}

function fileNameFromPath(value?: string): string {
	const parts = (value || "").split(/[\\/]/).filter(Boolean)
	return parts[parts.length - 1] || "local .plan.md"
}

const PlanCompletionOutputRow = memo(
	({ text, headClassNames, localPlanBuild, canBuild = false }: PlanCompletionOutputProps) => {
		const [plan, setPlan] = useState<PlanFile | undefined>()
		const [metadata, setMetadata] = useState<PlanMetadata>(createEmptyMetadata)
		const [body, setBody] = useState(text)
		const [selectedIds, setSelectedIds] = useState<string[]>([])
		const [lastSelectedId, setLastSelectedId] = useState<string | undefined>()
		const [isLoading, setIsLoading] = useState(false)
		const [isSaving, setIsSaving] = useState(false)
		const [isStartingBuild, setIsStartingBuild] = useState<"agent" | "multitask" | undefined>()
		const [search, setSearch] = useState("")
		const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map())

		useEffect(() => {
			if (!localPlanBuild?.planId && !localPlanBuild?.planPath) {
				setBody(text)
				return
			}
			let cancelled = false
			setIsLoading(true)
			PlanServiceClient.getPlan(
				PlanRequest.create({
					planId: localPlanBuild.planId,
					planPath: localPlanBuild.planPath,
				}),
			)
				.then((nextPlan) => {
					if (cancelled) {
						return
					}
					setPlan(nextPlan)
					setMetadata(normalizeMetadata(nextPlan.metadata))
					setBody(nextPlan.body || text)
				})
				.catch((error) => console.error("Failed to load local plan:", error))
				.finally(() => {
					if (!cancelled) {
						setIsLoading(false)
					}
				})
			return () => {
				cancelled = true
			}
		}, [localPlanBuild?.planId, localPlanBuild?.planPath, text])

		const flattenedTodos = useMemo(() => flattenTodos(metadata), [metadata])
		const selectedTodoIds = selectedIds.filter((id) => flattenedTodos.some((item) => item.todo.id === id))
		const hasSelectedTodos = selectedTodoIds.length > 0
		const searchNeedle = search.trim().toLowerCase()
		const searchMatchesBody = Boolean(searchNeedle && body.toLowerCase().includes(searchNeedle))
		const buildStatus = plan?.buildStatus || localPlanBuild?.status || "none"
		const visiblePlanPath = plan?.planPath || localPlanBuild?.planPath
		const visiblePlanName = fileNameFromPath(visiblePlanPath)

		const savePlan = async (nextMetadata = metadata, nextBody = body): Promise<PlanFile | undefined> => {
			if (!localPlanBuild?.planId && !localPlanBuild?.planPath) {
				return undefined
			}
			setIsSaving(true)
			try {
				const saved = await PlanServiceClient.updatePlan(
					PlanUpdateRequest.create({
						planId: localPlanBuild.planId,
						planPath: localPlanBuild.planPath,
						planMetadata: nextMetadata,
						body: nextBody,
					}),
				)
				setPlan(saved)
				setMetadata(normalizeMetadata(saved.metadata))
				setBody(saved.body)
				return saved
			} catch (error) {
				console.error("Failed to save local plan:", error)
				return undefined
			} finally {
				setIsSaving(false)
			}
		}

		const updateStatus = async (todoIds: string[], status: PlanTodoStatus) => {
			if (!todoIds.length) {
				return
			}
			const nextMetadata = mapTodos(metadata, (todo) => (todoIds.includes(todo.id) ? { ...todo, status } : todo))
			setMetadata(nextMetadata)
			if (localPlanBuild?.planId || localPlanBuild?.planPath) {
				try {
					const saved = await PlanServiceClient.updatePlanTodoStatus(
						PlanTodoStatusRequest.create({
							planId: localPlanBuild.planId,
							planPath: localPlanBuild.planPath,
							todoIds,
							status,
						}),
					)
					setPlan(saved)
					setMetadata(normalizeMetadata(saved.metadata))
					setBody(saved.body)
				} catch (error) {
					console.error("Failed to update todo status:", error)
				}
			}
		}

		const toggleSelection = (todoId: string, shiftKey: boolean) => {
			if (shiftKey && lastSelectedId) {
				const from = flattenedTodos.findIndex((item) => item.todo.id === lastSelectedId)
				const to = flattenedTodos.findIndex((item) => item.todo.id === todoId)
				if (from >= 0 && to >= 0) {
					const [start, end] = from < to ? [from, to] : [to, from]
					const range = flattenedTodos.slice(start, end + 1).map((item) => item.todo.id)
					setSelectedIds(Array.from(new Set([...selectedIds, ...range])))
					return
				}
			}
			setSelectedIds((current) =>
				current.includes(todoId) ? current.filter((id) => id !== todoId) : [...current, todoId],
			)
			setLastSelectedId(todoId)
		}

		const onStatusClick = async (todo: PlanTodo, event: MouseEvent<HTMLButtonElement>) => {
			if (event.metaKey || event.ctrlKey) {
				await updateStatus([todo.id], cyclePlanTodoStatus(statusFromString(todo.status)))
				return
			}
			toggleSelection(todo.id, event.shiftKey)
		}

		const onTodoKeyDown = (event: KeyboardEvent<HTMLInputElement>, item: FlattenedTodo) => {
			const input = event.currentTarget
			const value = input.value
			if (event.key === "ArrowUp" || event.key === "ArrowDown") {
				const index = flattenedTodos.findIndex((candidate) => candidate.todo.id === item.todo.id)
				const next = flattenedTodos[index + (event.key === "ArrowUp" ? -1 : 1)]
				if (next) {
					event.preventDefault()
					moveFocus(inputRefs, next.todo.id)
				}
				return
			}
			if (event.key === "Enter") {
				event.preventDefault()
				const splitAt = input.selectionStart ?? value.length
				const currentContent = value.slice(0, splitAt).trim()
				const nextContent = value.slice(splitAt).trim()
				const newTodo: PlanTodo = {
					id: generatePlanTodoId(),
					content: nextContent || "New todo",
					status: "pending",
					dependencies: [],
				}
				const nextMetadata = insertTodoAfter(
					updateTodo(metadata, item.todo.id, (todo) => ({ ...todo, content: currentContent || todo.content })),
					item.todo.id,
					newTodo,
				)
				setMetadata(nextMetadata)
				moveFocus(inputRefs, newTodo.id)
				return
			}
			if (event.key === "Backspace" && value.length === 0) {
				event.preventDefault()
				const index = flattenedTodos.findIndex((candidate) => candidate.todo.id === item.todo.id)
				const previous = flattenedTodos[index - 1]
				setMetadata(removeTodos(metadata, [item.todo.id]))
				if (previous) {
					moveFocus(inputRefs, previous.todo.id)
				}
			}
		}

		const buildPlan = async (mode: "agent" | "multitask") => {
			if (!canBuild || isStartingBuild || (!localPlanBuild?.planId && !localPlanBuild?.planPath)) {
				return
			}
			setIsStartingBuild(mode)
			try {
				const saved = await savePlan()
				const sourcePlan = saved || plan
				await PlanServiceClient.buildPlan(
					BuildPlanRequest.create({
						planId: sourcePlan?.planId || localPlanBuild.planId,
						planPath: sourcePlan?.planPath || localPlanBuild.planPath,
						mode,
						todoIds: hasSelectedTodos ? selectedTodoIds : [],
					}),
				)
			} catch (error) {
				console.error("Failed to build local plan:", error)
			} finally {
				setIsStartingBuild(undefined)
			}
		}

		const deleteSelectedTodos = async () => {
			if (!hasSelectedTodos) {
				return
			}
			const nextMetadata = removeTodos(metadata, selectedTodoIds)
			setSelectedIds([])
			setMetadata(nextMetadata)
			await savePlan(nextMetadata)
		}

		const openPlan = async () => {
			if (!localPlanBuild?.planId && !localPlanBuild?.planPath) {
				return
			}
			await PlanServiceClient.openPlan(
				PlanRequest.create({
					planId: localPlanBuild.planId,
					planPath: localPlanBuild.planPath,
				}),
			)
		}

		const renderTodo = (item: FlattenedTodo) => {
			const todoStatus = statusFromString(item.todo.status)
			const StatusIcon = statusIcons[todoStatus]
			const selected = selectedTodoIds.includes(item.todo.id)
			const matches = Boolean(searchNeedle && item.todo.content.toLowerCase().includes(searchNeedle))
			return (
				<div
					className={cn(
						"grid grid-cols-[24px_minmax(0,1fr)] gap-2 rounded-sm px-1 py-1",
						selected && "bg-accent/20",
						matches && "outline outline-1 outline-primary/40",
					)}
					key={item.todo.id}>
					<Button
						aria-label={statusLabels[todoStatus]}
						className="size-6 shrink-0"
						onClick={(event) => onStatusClick(item.todo, event)}
						size="icon"
						title={statusLabels[todoStatus]}
						variant="ghost">
						<StatusIcon className={cn("size-3", todoStatus === "in_progress" && "animate-spin")} />
					</Button>
					<div className="min-w-0 space-y-1">
						{item.phaseName && <div className="text-[10px] uppercase text-description truncate">{item.phaseName}</div>}
						<input
							className="w-full bg-transparent border border-transparent rounded-sm px-1 py-0.5 text-sm outline-none focus:border-primary/50"
							onChange={(event) =>
								setMetadata(updateTodo(metadata, item.todo.id, (todo) => ({ ...todo, content: event.target.value })))
							}
							onKeyDown={(event) => onTodoKeyDown(event, item)}
							ref={(node) => {
								if (node) {
									inputRefs.current.set(item.todo.id, node)
								} else {
									inputRefs.current.delete(item.todo.id)
								}
							}}
							value={item.todo.content}
						/>
						<input
							aria-label="Dependencies"
							className="w-full bg-transparent border border-transparent rounded-sm px-1 py-0.5 text-xs text-description outline-none focus:border-primary/50"
							onChange={(event) =>
								setMetadata(
									updateTodo(metadata, item.todo.id, (todo) => ({
										...todo,
										dependencies: event.target.value
											.split(",")
											.map((dependency) => dependency.trim())
											.filter(Boolean),
									})),
								)
							}
							placeholder="dependencies"
							value={item.todo.dependencies.join(", ")}
						/>
					</div>
				</div>
			)
		}

		const renderTodos = () => {
			if (flattenedTodos.length === 0) {
				return <div className="text-description text-sm px-1 py-2">No todos</div>
			}
			return (
				<div className="space-y-1">
					{metadata.todos.map((todo, todoIndex) => renderTodo({ todo, todoIndex }))}
					{metadata.phases.map((phase: PlanPhase, phaseIndex) => (
						<div className="space-y-1" key={`${phase.name}-${phaseIndex}`}>
							<div className="px-1 pt-2 text-xs font-semibold text-foreground truncate">{phase.name}</div>
							{phase.todos.map((todo, todoIndex) => renderTodo({ todo, phaseIndex, todoIndex, phaseName: phase.name }))}
						</div>
					))}
				</div>
			)
		}

		return (
			<div className="rounded-sm border border-description/50 overflow-visible bg-code p-2 pt-3">
				<div className={cn(headClassNames, "justify-between px-1")}>
					<div className="flex gap-2 items-center min-w-0">
						<SparklesIcon className="size-2 shrink-0" />
						<span className="text-foreground font-bold truncate">{metadata.name || "Plan Created"}</span>
						{localPlanBuild && (
							<span className="shrink-0 rounded-sm border border-description/30 px-1 py-0.5 text-[10px] uppercase text-description">
								{buildStatus}
							</span>
						)}
						{isLoading && <LoaderCircleIcon className="size-3 animate-spin text-description" />}
					</div>
					<div className="flex items-center gap-1">
						<CopyButton textToCopy={plan?.serialized || text || ""} />
						{localPlanBuild && (
							<Button aria-label="Open plan" onClick={openPlan} size="icon" title="Open plan" variant="ghost">
								<ExternalLinkIcon className="size-3" />
							</Button>
						)}
					</div>
				</div>

				{localPlanBuild && (
					<div className="mx-1 mt-2 flex min-w-0 items-center gap-1 rounded-sm border border-description/20 px-2 py-1 text-[11px] text-description">
						<FileTextIcon className="size-3 shrink-0" />
						<span className="shrink-0 font-medium text-foreground" title={visiblePlanPath}>
							{visiblePlanName}
						</span>
						<span className="min-w-0 truncate font-mono" title={visiblePlanPath}>
							{visiblePlanPath}
						</span>
					</div>
				)}

				{localPlanBuild ? (
					<div className="w-full relative border-t-1 border-description/20 rounded-b-sm">
						<div className="grid gap-2 p-2 pt-3">
							<div className="grid gap-2">
								<input
									className="w-full bg-transparent border border-description/30 rounded-sm px-2 py-1 text-sm font-semibold outline-none focus:border-primary/60"
									onChange={(event) => setMetadata({ ...metadata, name: event.target.value })}
									value={metadata.name}
								/>
								<textarea
									className="min-h-14 w-full resize-y bg-transparent border border-description/30 rounded-sm px-2 py-1 text-sm outline-none focus:border-primary/60"
									onChange={(event) => setMetadata({ ...metadata, overview: event.target.value })}
									value={metadata.overview}
								/>
							</div>

							<div className="flex flex-wrap items-center gap-1">
								<div className="relative min-w-32 flex-1">
									<SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-description" />
									<input
										className="w-full bg-transparent border border-description/30 rounded-sm py-1 pl-7 pr-2 text-xs outline-none focus:border-primary/60"
										onChange={(event) => setSearch(event.target.value)}
										value={search}
									/>
								</div>
								{PLAN_TODO_STATUSES.map((status) => {
									const StatusIcon = statusIcons[status]
									return (
										<Button
											aria-label={statusLabels[status]}
											disabled={!hasSelectedTodos}
											key={status}
											onClick={() => updateStatus(selectedTodoIds, status)}
											size="icon"
											title={statusLabels[status]}
											variant="ghost">
											<StatusIcon className={cn("size-3", status === "in_progress" && "animate-spin")} />
										</Button>
									)
								})}
								<Button
									aria-label="Delete selected"
									disabled={!hasSelectedTodos}
									onClick={deleteSelectedTodos}
									size="icon"
									title="Delete selected"
									variant="ghost">
									<Trash2Icon className="size-3" />
								</Button>
								<Button aria-label="Save plan" disabled={isSaving} onClick={() => savePlan()} size="icon" title="Save plan">
									{isSaving ? <LoaderCircleIcon className="size-3 animate-spin" /> : <SaveIcon className="size-3" />}
								</Button>
							</div>

							<div className="border-t-1 border-description/20 pt-2">{renderTodos()}</div>

							<textarea
								className={cn(
									"min-h-32 w-full resize-y bg-transparent border border-description/30 rounded-sm px-2 py-2 text-sm outline-none focus:border-primary/60",
									searchMatchesBody && "outline outline-1 outline-primary/40",
								)}
								onChange={(event) => setBody(event.target.value)}
								value={body}
							/>

							<div className="wrap-anywhere border-t-1 border-description/20 pt-3 [&_hr]:opacity-20 [&_p:last-child]:mb-0">
								<MarkdownBlock markdown={body || text} />
							</div>
						</div>
					</div>
				) : (
					<div className="w-full relative border-t-1 border-description/20 rounded-b-sm">
						<div className="plan-completion-content p-2 pt-3 w-full [&_hr]:opacity-20 [&_p:last-child]:mb-0">
							<div className="wrap-anywhere [&_hr]:opacity-20">
								<MarkdownBlock markdown={text} />
							</div>
						</div>
					</div>
				)}

				{localPlanBuild && (
					<div className="flex flex-wrap justify-end gap-1 border-t-1 border-description/20 pt-2 px-1">
						<Button
							aria-label="Copy plan"
							onClick={() => navigator.clipboard.writeText(plan?.serialized || text || "")}
							size="icon"
							title="Copy plan"
							variant="ghost">
							<CopyIcon className="size-3" />
						</Button>
						<Button
							aria-label="Build in Parallel"
							disabled={!canBuild || Boolean(isStartingBuild)}
							onClick={() => buildPlan("multitask")}
							size="sm"
							title="Build in Parallel"
							variant="ghost">
							{isStartingBuild === "multitask" ? (
								<LoaderCircleIcon className="animate-spin" />
							) : (
								<GitBranchIcon className="size-3" />
							)}
							Build in Parallel
						</Button>
						<Button
							aria-label="Build Locally"
							disabled={!canBuild || Boolean(isStartingBuild)}
							onClick={() => buildPlan("agent")}
							size="sm"
							title="Build Locally">
							{isStartingBuild === "agent" ? <LoaderCircleIcon className="animate-spin" /> : <PlayIcon />}
							Build Locally
						</Button>
					</div>
				)}
			</div>
		)
	},
)

PlanCompletionOutputRow.displayName = "PlanCompletionOutputRow"

export default PlanCompletionOutputRow
