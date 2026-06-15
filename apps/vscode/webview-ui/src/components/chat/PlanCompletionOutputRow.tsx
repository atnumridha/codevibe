import type {
	LocalPlanBuildMetadata,
	PlanTodoStatus,
} from "@shared/plan-build";
import {
	cyclePlanTodoStatus,
	generatePlanTodoId,
	markdownTodosToPlanTodos,
	PLAN_TODO_STATUSES,
} from "@shared/plan-build";
import {
	BuildPlanRequest,
	PlanRequest,
	PlanTodoStatusRequest,
	PlanUpdateRequest,
	type PlanFile,
	type PlanMetadata,
	type PlanPhase,
	type PlanTodo,
} from "@shared/proto/cline/plan";
import {
	CheckCircle2Icon,
	CircleIcon,
	CircleSlashIcon,
	CopyIcon,
	ExternalLinkIcon,
	FileTextIcon,
	LoaderCircleIcon,
	SaveIcon,
	SearchIcon,
	SparklesIcon,
	Trash2Icon,
} from "lucide-react";
import {
	KeyboardEvent,
	MouseEvent,
	memo,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { CopyButton } from "@/components/common/CopyButton";
import MarkdownBlock from "@/components/common/MarkdownBlock";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PlanServiceClient } from "@/services/grpc-client";

interface PlanCompletionOutputProps {
	text: string;
	onCopy?: () => void;
	headClassNames?: string;
	localPlanBuild?: LocalPlanBuildMetadata;
	canBuild?: boolean;
	composerId?: string;
}

interface FlattenedTodo {
	todo: PlanTodo;
	phaseIndex?: number;
	todoIndex: number;
	phaseName?: string;
}

const statusIcons = {
	pending: CircleIcon,
	in_progress: LoaderCircleIcon,
	completed: CheckCircle2Icon,
	cancelled: CircleSlashIcon,
} satisfies Record<PlanTodoStatus, typeof CircleIcon>;

const statusLabels = {
	pending: "Pending",
	in_progress: "In Progress",
	completed: "Completed",
	cancelled: "Cancelled",
} satisfies Record<PlanTodoStatus, string>;

function createEmptyMetadata(): PlanMetadata {
	return {
		name: "Plan",
		overview: "",
		todos: [],
		isProject: false,
		phases: [],
	};
}

function normalizeMetadata(metadata?: PlanMetadata): PlanMetadata {
	return {
		name: metadata?.name || "Plan",
		overview: metadata?.overview || "",
		todos: metadata?.todos || [],
		isProject: Boolean(metadata?.isProject),
		phases: metadata?.phases || [],
	};
}

function flattenTodos(metadata: PlanMetadata): FlattenedTodo[] {
	const topLevel = metadata.todos.map((todo, todoIndex) => ({
		todo,
		todoIndex,
	}));
	const phaseTodos = metadata.phases.flatMap((phase, phaseIndex) =>
		phase.todos.map((todo, todoIndex) => ({
			todo,
			phaseIndex,
			todoIndex,
			phaseName: phase.name,
		})),
	);
	return [...topLevel, ...phaseTodos];
}

function mapTodos(
	metadata: PlanMetadata,
	mapper: (todo: PlanTodo) => PlanTodo,
): PlanMetadata {
	return {
		...metadata,
		todos: metadata.todos.map(mapper),
		phases: metadata.phases.map((phase) => ({
			...phase,
			todos: phase.todos.map(mapper),
		})),
	};
}

function updateTodo(
	metadata: PlanMetadata,
	todoId: string,
	updater: (todo: PlanTodo) => PlanTodo,
): PlanMetadata {
	return mapTodos(metadata, (todo) =>
		todo.id === todoId ? updater(todo) : todo,
	);
}

function removeTodos(metadata: PlanMetadata, todoIds: string[]): PlanMetadata {
	const idSet = new Set(todoIds);
	return {
		...metadata,
		todos: metadata.todos.filter((todo) => !idSet.has(todo.id)),
		phases: metadata.phases.map((phase) => ({
			...phase,
			todos: phase.todos.filter((todo) => !idSet.has(todo.id)),
		})),
	};
}

function insertTodoAfter(
	metadata: PlanMetadata,
	todoId: string,
	todo: PlanTodo,
): PlanMetadata {
	const topIndex = metadata.todos.findIndex(
		(candidate) => candidate.id === todoId,
	);
	if (topIndex >= 0) {
		const todos = [...metadata.todos];
		todos.splice(topIndex + 1, 0, todo);
		return { ...metadata, todos };
	}
	return {
		...metadata,
		phases: metadata.phases.map((phase) => {
			const index = phase.todos.findIndex(
				(candidate) => candidate.id === todoId,
			);
			if (index < 0) {
				return phase;
			}
			const todos = [...phase.todos];
			todos.splice(index + 1, 0, todo);
			return { ...phase, todos };
		}),
	};
}

function moveFocus(
	inputRefs: React.MutableRefObject<Map<string, HTMLInputElement>>,
	todoId: string,
): void {
	window.requestAnimationFrame(() => inputRefs.current.get(todoId)?.focus());
}

function statusFromString(status: string): PlanTodoStatus {
	return status === "in_progress" ||
		status === "completed" ||
		status === "cancelled"
		? status
		: "pending";
}

function fileNameFromPath(value?: string): string {
	const parts = (value || "").split(/[\\/]/).filter(Boolean);
	return parts[parts.length - 1] || "local .plan.md";
}

function stripInlineMarkdown(value: string): string {
	return value
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/\*([^*]+)\*/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.trim();
}

function extractMarkdownTitle(value?: string): string | undefined {
	for (const line of (value || "").split(/\r?\n/)) {
		const heading = line.trim().match(/^#{1,3}\s+(.+)$/);
		if (heading?.[1]) {
			return stripInlineMarkdown(heading[1]);
		}
	}
	return undefined;
}

function extractMarkdownPreview(value?: string): string | undefined {
	for (const line of (value || "").split(/\r?\n/)) {
		const trimmed = line.trim();
		if (
			!trimmed ||
			trimmed.startsWith("#") ||
			/^-\s*\[[ xX]\]\s+/.test(trimmed) ||
			/^```/.test(trimmed)
		) {
			continue;
		}
		return stripInlineMarkdown(trimmed);
	}
	return undefined;
}

const PlanCompletionOutputRow = memo(
	({
		text,
		headClassNames,
		localPlanBuild,
		canBuild = false,
		composerId,
	}: PlanCompletionOutputProps) => {
		const [plan, setPlan] = useState<PlanFile | undefined>();
		const [createdPlanBuild, setCreatedPlanBuild] = useState<
			LocalPlanBuildMetadata | undefined
		>();
		const [metadata, setMetadata] = useState<PlanMetadata>(createEmptyMetadata);
		const [body, setBody] = useState(text);
		const [selectedIds, setSelectedIds] = useState<string[]>([]);
		const [lastSelectedId, setLastSelectedId] = useState<string | undefined>();
		const [isLoading, setIsLoading] = useState(false);
		const [isSaving, setIsSaving] = useState(false);
		const [isStartingBuild, setIsStartingBuild] = useState<
			"agent" | "multitask" | "new_agent" | undefined
		>();
		const [search, setSearch] = useState("");
		const [showRawMarkdown, setShowRawMarkdown] = useState(false);
		const [isBuildMenuOpen, setIsBuildMenuOpen] = useState(false);
		const [buildMenuPosition, setBuildMenuPosition] = useState<
			{ left: number; top: number; width: number } | undefined
		>();
		const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
		const buildMenuRef = useRef<HTMLDivElement>(null);
		const buildMenuPanelRef = useRef<HTMLDivElement>(null);
		const effectivePlanBuild = localPlanBuild || createdPlanBuild;

		const updateBuildMenuPosition = () => {
			const trigger = buildMenuRef.current?.querySelector(
				"[data-build-action-trigger]",
			);
			if (!(trigger instanceof HTMLElement)) {
				return;
			}
			const triggerRect = trigger.getBoundingClientRect();
			const panelHeight = buildMenuPanelRef.current?.offsetHeight ?? 152;
			const panelWidth = Math.max(
				buildMenuPanelRef.current?.offsetWidth ?? 224,
				triggerRect.width,
			);
			const viewportWidth = document.documentElement.clientWidth;
			const viewportHeight = document.documentElement.clientHeight;
			const gutter = 8;
			const left = Math.min(
				Math.max(gutter, triggerRect.right - panelWidth),
				Math.max(gutter, viewportWidth - panelWidth - gutter),
			);
			const bottomTop = triggerRect.bottom + 4;
			const top =
				bottomTop + panelHeight <= viewportHeight - gutter
					? bottomTop
					: Math.max(gutter, triggerRect.top - panelHeight - 4);
			setBuildMenuPosition({ left, top, width: panelWidth });
		};

		useEffect(() => {
			setCreatedPlanBuild(undefined);
			setShowRawMarkdown(false);
		}, [localPlanBuild?.planId, localPlanBuild?.planPath]);

		useEffect(() => {
			if (!isBuildMenuOpen) {
				return;
			}

			const closeOnOutsidePointer = (event: PointerEvent) => {
				const target = event.target;
				if (target instanceof Node && buildMenuRef.current?.contains(target)) {
					return;
				}
				setIsBuildMenuOpen(false);
			};
			const closeOnEscape = (event: globalThis.KeyboardEvent) => {
				if (event.key === "Escape") {
					setIsBuildMenuOpen(false);
				}
			};
			const updatePosition = () => updateBuildMenuPosition();

			window.requestAnimationFrame(() => {
				updateBuildMenuPosition();
			});

			document.addEventListener("pointerdown", closeOnOutsidePointer);
			document.addEventListener("keydown", closeOnEscape);
			window.addEventListener("resize", updatePosition);
			window.addEventListener("scroll", updatePosition, true);
			return () => {
				document.removeEventListener("pointerdown", closeOnOutsidePointer);
				document.removeEventListener("keydown", closeOnEscape);
				window.removeEventListener("resize", updatePosition);
				window.removeEventListener("scroll", updatePosition, true);
			};
		}, [isBuildMenuOpen]);

		useEffect(() => {
			if (!effectivePlanBuild?.planId && !effectivePlanBuild?.planPath) {
				setBody(text);
				return;
			}
			let cancelled = false;
			setIsLoading(true);
			PlanServiceClient.getPlan(
				PlanRequest.create({
					planId: effectivePlanBuild.planId,
					planPath: effectivePlanBuild.planPath,
				}),
			)
				.then((nextPlan) => {
					if (cancelled) {
						return;
					}
					setPlan(nextPlan);
					setMetadata(normalizeMetadata(nextPlan.metadata));
					setBody(nextPlan.body || text);
				})
				.catch((error) => console.error("Failed to load local plan:", error))
				.finally(() => {
					if (!cancelled) {
						setIsLoading(false);
					}
				});
			return () => {
				cancelled = true;
			};
		}, [effectivePlanBuild?.planId, effectivePlanBuild?.planPath, text]);

		const flattenedTodos = useMemo(() => flattenTodos(metadata), [metadata]);
		const selectedTodoIds = selectedIds.filter((id) =>
			flattenedTodos.some((item) => item.todo.id === id),
		);
		const hasStructuredTodos = flattenedTodos.length > 0;
		const hasSelectedTodos = selectedTodoIds.length > 0;
		const searchNeedle = search.trim().toLowerCase();
		const searchMatchesBody = Boolean(
			searchNeedle && body.toLowerCase().includes(searchNeedle),
		);
		const buildStatus =
			plan?.buildStatus || effectivePlanBuild?.status || "none";
		const visiblePlanPath = plan?.planPath || effectivePlanBuild?.planPath;
		const visiblePlanName = fileNameFromPath(visiblePlanPath);
		const hasPlanArtifact = Boolean(
			effectivePlanBuild?.planId ||
				effectivePlanBuild?.planPath ||
				plan?.planId ||
				plan?.planPath,
		);
		const completedTodos = flattenedTodos.filter(
			(item) =>
				item.todo.status === "completed" || item.todo.status === "cancelled",
		).length;
		const progressPercent = flattenedTodos.length
			? Math.round((completedTodos / flattenedTodos.length) * 100)
			: 0;
		const statusCounts = flattenedTodos.reduce(
			(counts, item) => {
				counts[statusFromString(item.todo.status)] += 1;
				return counts;
			},
			{
				pending: 0,
				in_progress: 0,
				completed: 0,
				cancelled: 0,
			} satisfies Record<PlanTodoStatus, number>,
		);
		const activeTodo =
			flattenedTodos.find(
				(item) => statusFromString(item.todo.status) === "in_progress",
			) ||
			flattenedTodos.find(
				(item) => statusFromString(item.todo.status) === "pending",
			);
		const liveStatusText = isStartingBuild
			? isStartingBuild === "multitask"
				? "Starting parallel build"
				: isStartingBuild === "new_agent"
					? "Starting new agent"
				: "Starting local build"
			: buildStatus === "active"
				? "Build active"
				: buildStatus === "complete"
					? "Build complete"
					: plan?.status === "complete"
					? "Plan complete"
					: "Planning";
		const planPreviewMarkdown = body || text;
		const previewTodos = useMemo(
			() =>
				hasStructuredTodos
					? []
					: markdownTodosToPlanTodos(planPreviewMarkdown, 0),
			[hasStructuredTodos, planPreviewMarkdown],
		);
		const markdownTitle = extractMarkdownTitle(planPreviewMarkdown);
		const displayPlanName =
			metadata.name && metadata.name !== "Plan" && metadata.name !== "Untitled plan"
				? metadata.name
				: markdownTitle || metadata.name || "Implementation plan";
		const previewText = extractMarkdownPreview(planPreviewMarkdown);
		const visibleTodoCount = hasStructuredTodos
			? flattenedTodos.length
			: previewTodos.length;
		const visibleCompletedCount = hasStructuredTodos
			? completedTodos
			: previewTodos.filter((todo) => todo.status === "completed").length;

		const savePlan = async (
			nextMetadata = metadata,
			nextBody = body,
		): Promise<PlanFile | undefined> => {
			if (!effectivePlanBuild?.planId && !effectivePlanBuild?.planPath) {
				return undefined;
			}
			setIsSaving(true);
			try {
				const saved = await PlanServiceClient.updatePlan(
					PlanUpdateRequest.create({
						planId: effectivePlanBuild.planId,
						planPath: effectivePlanBuild.planPath,
						planMetadata: nextMetadata,
						body: nextBody,
					}),
				);
				setPlan(saved);
				setMetadata(normalizeMetadata(saved.metadata));
				setBody(saved.body);
				return saved;
			} catch (error) {
				console.error("Failed to save local plan:", error);
				return undefined;
			} finally {
				setIsSaving(false);
			}
		};

		const updateStatus = async (todoIds: string[], status: PlanTodoStatus) => {
			if (!todoIds.length) {
				return;
			}
			const nextMetadata = mapTodos(metadata, (todo) =>
				todoIds.includes(todo.id) ? { ...todo, status } : todo,
			);
			setMetadata(nextMetadata);
			if (effectivePlanBuild?.planId || effectivePlanBuild?.planPath) {
				try {
					const saved = await PlanServiceClient.updatePlanTodoStatus(
						PlanTodoStatusRequest.create({
							planId: effectivePlanBuild.planId,
							planPath: effectivePlanBuild.planPath,
							todoIds,
							status,
						}),
					);
					setPlan(saved);
					setMetadata(normalizeMetadata(saved.metadata));
					setBody(saved.body);
				} catch (error) {
					console.error("Failed to update todo status:", error);
				}
			}
		};

		const toggleSelection = (todoId: string, shiftKey: boolean) => {
			if (shiftKey && lastSelectedId) {
				const from = flattenedTodos.findIndex(
					(item) => item.todo.id === lastSelectedId,
				);
				const to = flattenedTodos.findIndex((item) => item.todo.id === todoId);
				if (from >= 0 && to >= 0) {
					const [start, end] = from < to ? [from, to] : [to, from];
					const range = flattenedTodos
						.slice(start, end + 1)
						.map((item) => item.todo.id);
					setSelectedIds(Array.from(new Set([...selectedIds, ...range])));
					return;
				}
			}
			setSelectedIds((current) =>
				current.includes(todoId)
					? current.filter((id) => id !== todoId)
					: [...current, todoId],
			);
			setLastSelectedId(todoId);
		};

		const onStatusClick = async (
			todo: PlanTodo,
			event: MouseEvent<HTMLButtonElement>,
		) => {
			if (event.metaKey || event.ctrlKey) {
				await updateStatus(
					[todo.id],
					cyclePlanTodoStatus(statusFromString(todo.status)),
				);
				return;
			}
			toggleSelection(todo.id, event.shiftKey);
		};

		const onTodoKeyDown = (
			event: KeyboardEvent<HTMLInputElement>,
			item: FlattenedTodo,
		) => {
			const input = event.currentTarget;
			const value = input.value;
			if (event.key === "ArrowUp" || event.key === "ArrowDown") {
				const index = flattenedTodos.findIndex(
					(candidate) => candidate.todo.id === item.todo.id,
				);
				const next = flattenedTodos[index + (event.key === "ArrowUp" ? -1 : 1)];
				if (next) {
					event.preventDefault();
					moveFocus(inputRefs, next.todo.id);
				}
				return;
			}
			if (event.key === "Enter") {
				event.preventDefault();
				const splitAt = input.selectionStart ?? value.length;
				const currentContent = value.slice(0, splitAt).trim();
				const nextContent = value.slice(splitAt).trim();
				const newTodo: PlanTodo = {
					id: generatePlanTodoId(),
					content: nextContent || "New todo",
					status: "pending",
					dependencies: [],
				};
				const nextMetadata = insertTodoAfter(
					updateTodo(metadata, item.todo.id, (todo) => ({
						...todo,
						content: currentContent || todo.content,
					})),
					item.todo.id,
					newTodo,
				);
				setMetadata(nextMetadata);
				moveFocus(inputRefs, newTodo.id);
				return;
			}
			if (event.key === "Backspace" && value.length === 0) {
				event.preventDefault();
				const index = flattenedTodos.findIndex(
					(candidate) => candidate.todo.id === item.todo.id,
				);
				const previous = flattenedTodos[index - 1];
				setMetadata(removeTodos(metadata, [item.todo.id]));
				if (previous) {
					moveFocus(inputRefs, previous.todo.id);
				}
			}
		};

		const buildPlan = async (mode: "agent" | "multitask" | "new_agent") => {
			if (!canBuild || isStartingBuild) {
				return;
			}
			setIsBuildMenuOpen(false);
			setIsStartingBuild(mode);
			try {
				const saved = await savePlan();
				const sourcePlan = saved || plan;
				const response = await PlanServiceClient.buildPlan(
					BuildPlanRequest.create({
						planId: sourcePlan?.planId || effectivePlanBuild?.planId,
						planPath: sourcePlan?.planPath || effectivePlanBuild?.planPath,
						mode,
						todoIds: hasSelectedTodos ? selectedTodoIds : [],
						body: sourcePlan?.body || body || text,
						composerId,
					}),
				);
				if (response.plan) {
					setPlan(response.plan);
					setMetadata(normalizeMetadata(response.plan.metadata));
					setBody(response.plan.body || body || text);
					setCreatedPlanBuild({
						planId: response.plan.planId,
						planPath: response.plan.planPath,
						todoCount: response.plan.todoCount,
						status:
							response.plan.buildStatus === "active" ||
							response.plan.buildStatus === "complete"
								? response.plan.buildStatus
								: "none",
					});
				}
			} catch (error) {
				console.error("Failed to build local plan:", error);
			} finally {
				setIsStartingBuild(undefined);
			}
		};

		const renderBuildActionMenu = (
			idleLabel: string,
			triggerClassName: string,
		) => {
			const triggerLabel = isStartingBuild ? liveStatusText : idleLabel;
			const actionClassName =
				"w-full rounded-sm border border-description/20 bg-background/70 px-2 py-1.5 text-left text-xs text-foreground hover:border-primary/50 hover:bg-muted focus:border-primary/50 focus:bg-muted focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";
			const primaryActionClassName = cn(
				actionClassName,
				"border-primary/45 bg-primary/10 font-medium",
			);
			const toggleBuildMenu = () => {
				if (isBuildMenuOpen) {
					setIsBuildMenuOpen(false);
					return;
				}
				updateBuildMenuPosition();
				setIsBuildMenuOpen(true);
			};

			return (
				<div className="relative grid shrink-0" ref={buildMenuRef}>
					<button
						aria-expanded={isBuildMenuOpen}
						aria-haspopup="menu"
						aria-label="Build plan action"
						className={cn(
							"inline-flex items-center justify-between gap-2 rounded-sm border border-description/30 bg-background/60 text-xs text-foreground outline-none focus:border-primary/60 disabled:cursor-not-allowed disabled:opacity-50",
							triggerClassName,
						)}
						data-build-action-trigger
						disabled={!canBuild || Boolean(isStartingBuild)}
						onClick={toggleBuildMenu}
						type="button"
					>
						<span className="truncate">{triggerLabel}</span>
						<span className="text-description">v</span>
					</button>
					{isBuildMenuOpen && (
						<div
							className="fixed z-[1000] grid min-w-56 gap-1 rounded-sm border border-description/30 bg-background p-1 shadow-lg"
							data-build-action-menu
							ref={buildMenuPanelRef}
							role="menu"
							style={{
								left: buildMenuPosition?.left ?? 8,
								top: buildMenuPosition?.top ?? 8,
								width: buildMenuPosition?.width ?? 224,
							}}
						>
							<button
								aria-label="Build"
								className={primaryActionClassName}
								data-build-action-button
								data-default-build-action
								onClick={() => void buildPlan("agent")}
								role="menuitem"
								type="button"
							>
								<span className="block">Build</span>
								<span
									aria-hidden="true"
									className="block text-[10px] font-normal text-description"
								>
									Run locally in Act mode
								</span>
							</button>
							<button
								className={actionClassName}
								data-build-action-button
								onClick={() => void buildPlan("multitask")}
								role="menuitem"
								type="button"
							>
								<span className="block">Build in Parallel</span>
								<span className="block text-[10px] text-description">
									Prepare multitask local execution
								</span>
							</button>
							<button
								className={actionClassName}
								data-build-action-button
								disabled={!hasSelectedTodos}
								onClick={() => void buildPlan("new_agent")}
								role="menuitem"
								type="button"
							>
								Build Selected in New Agent
							</button>
						</div>
					)}
				</div>
			);
		};

		const deleteSelectedTodos = async () => {
			if (!hasSelectedTodos) {
				return;
			}
			const nextMetadata = removeTodos(metadata, selectedTodoIds);
			setSelectedIds([]);
			setMetadata(nextMetadata);
			await savePlan(nextMetadata);
		};

		const openPlan = async () => {
			if (!effectivePlanBuild?.planId && !effectivePlanBuild?.planPath) {
				return;
			}
			await PlanServiceClient.openPlan(
				PlanRequest.create({
					planId: effectivePlanBuild.planId,
					planPath: effectivePlanBuild.planPath,
				}),
			);
		};

		const renderTodo = (item: FlattenedTodo) => {
			const todoStatus = statusFromString(item.todo.status);
			const StatusIcon = statusIcons[todoStatus];
			const selected = selectedTodoIds.includes(item.todo.id);
			const matches = Boolean(
				searchNeedle && item.todo.content.toLowerCase().includes(searchNeedle),
			);
			const dependencies = item.todo.dependencies.filter(Boolean);
			return (
				<div
					className={cn(
						"group grid grid-cols-[30px_minmax(0,1fr)] gap-2 rounded-sm border px-2 py-2 transition-colors",
						todoStatus === "in_progress"
							? "border-primary/50 bg-primary/10"
							: "border-description/20 bg-background/30",
						todoStatus === "completed" && "opacity-80",
						selected && "bg-accent/25",
						matches && "outline outline-1 outline-primary/50",
					)}
					key={item.todo.id}
				>
					<Button
						aria-label={statusLabels[todoStatus]}
						className={cn(
							"size-7 shrink-0 rounded-full border",
							todoStatus === "completed" && "border-success/50 text-success",
							todoStatus === "in_progress" && "border-primary/60 text-primary",
						)}
						onClick={(event) => onStatusClick(item.todo, event)}
						size="icon"
						title={statusLabels[todoStatus]}
						variant="ghost"
					>
						<StatusIcon
							className={cn(
								"size-3",
								todoStatus === "in_progress" && "animate-spin",
							)}
						/>
					</Button>
					<div className="min-w-0 space-y-1">
						<div className="flex min-w-0 items-center justify-between gap-2">
							{item.phaseName ? (
								<div className="text-[10px] uppercase text-description truncate">
									{item.phaseName}
								</div>
							) : (
								<div className="text-[10px] uppercase text-description">
									Task {item.todoIndex + 1}
								</div>
							)}
							<div className="shrink-0 rounded-sm border border-description/20 px-1 py-0.5 text-[10px] uppercase text-description">
								{statusLabels[todoStatus]}
							</div>
						</div>
						<input
							className="w-full bg-transparent border border-transparent rounded-sm px-1 py-0.5 text-sm font-medium text-foreground outline-none focus:border-primary/50"
							onChange={(event) =>
								setMetadata(
									updateTodo(metadata, item.todo.id, (todo) => ({
										...todo,
										content: event.target.value,
									})),
								)
							}
							onKeyDown={(event) => onTodoKeyDown(event, item)}
							ref={(node) => {
								if (node) {
									inputRefs.current.set(item.todo.id, node);
								} else {
									inputRefs.current.delete(item.todo.id);
								}
							}}
							value={item.todo.content}
						/>
						<div className="flex min-w-0 flex-wrap items-center gap-1">
							{dependencies.slice(0, 3).map((dependency) => (
								<span
									className="max-w-full truncate rounded-sm border border-description/20 px-1 py-0.5 text-[10px] text-description"
									key={dependency}
									title={dependency}
								>
									{dependency}
								</span>
							))}
							<input
								aria-label="Dependencies"
								className="min-w-24 flex-1 bg-transparent border border-transparent rounded-sm px-1 py-0.5 text-xs text-description outline-none focus:border-primary/50"
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
				</div>
			);
		};

		const renderTodos = () => {
			if (flattenedTodos.length === 0) {
				return (
					<div className="text-description text-sm px-1 py-2">No todos</div>
				);
			}
			return (
				<div className="space-y-1">
					{metadata.todos.map((todo, todoIndex) =>
						renderTodo({ todo, todoIndex }),
					)}
					{metadata.phases.map((phase: PlanPhase, phaseIndex) => (
						<div className="space-y-1" key={`${phase.name}-${phaseIndex}`}>
							<div className="px-1 pt-2 text-xs font-semibold text-foreground truncate">
								{phase.name}
							</div>
							{phase.todos.map((todo, todoIndex) =>
								renderTodo({
									todo,
									phaseIndex,
									todoIndex,
									phaseName: phase.name,
								}),
							)}
						</div>
					))}
				</div>
			);
		};

		if (!hasPlanArtifact && canBuild && !hasStructuredTodos) {
			return (
				<div
					className={cn(
						"min-w-0 rounded-sm border border-description/40 bg-code p-2",
						isBuildMenuOpen && "relative z-50 overflow-visible",
					)}
					data-plan-card
				>
					<div
						className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-sm border border-description/25 bg-background/40 px-2 py-1.5"
						data-plan-visible-summary
						title={
							previewText
								? `${displayPlanName} - ${visibleCompletedCount}/${visibleTodoCount} tasks - ${previewText}`
								: `${displayPlanName} - ${visibleCompletedCount}/${visibleTodoCount} tasks`
						}
					>
						<div className="flex min-w-0 items-center gap-2">
							<span className="min-w-0 truncate text-sm font-semibold text-foreground">
								{displayPlanName || "Implementation plan"}
							</span>
						</div>
						{renderBuildActionMenu("Build", "h-7 min-w-36 px-2")}
					</div>
				</div>
			);
		}

		return (
			<div
				className={cn(
					"min-w-0 rounded-sm border border-description/40 bg-code p-2 pt-3",
					isBuildMenuOpen
						? "relative z-50 overflow-visible"
						: "overflow-hidden",
				)}
				data-plan-card
			>
				<div className={cn(headClassNames, "justify-between px-1")}>
					<div className="flex gap-2 items-center min-w-0">
						<SparklesIcon className="size-2 shrink-0" />
						<span className="text-foreground font-bold truncate">
							{displayPlanName || "Plan Created"}
						</span>
						{hasPlanArtifact && (
							<span className="shrink-0 rounded-sm border border-description/30 px-1 py-0.5 text-[10px] uppercase text-description">
								{buildStatus}
							</span>
						)}
						{flattenedTodos.length > 0 && (
							<span className="shrink-0 rounded-sm border border-description/30 px-1 py-0.5 text-[10px] text-description">
								{completedTodos}/{flattenedTodos.length}
							</span>
						)}
						{isLoading && (
							<LoaderCircleIcon className="size-3 animate-spin text-description" />
						)}
					</div>
					<div className="flex items-center gap-1">
						<CopyButton textToCopy={plan?.serialized || text || ""} />
						{hasPlanArtifact && (
							<Button
								aria-label="Open plan"
								onClick={openPlan}
								size="icon"
								title="Open plan"
								variant="ghost"
							>
								<ExternalLinkIcon className="size-3" />
							</Button>
						)}
					</div>
				</div>

				{hasStructuredTodos ? (
					<div className="mx-1 mt-2 grid gap-2 rounded-sm border border-description/20 bg-background/30 px-3 py-3">
						<div className="flex min-w-0 items-start justify-between gap-3">
							<div className="min-w-0">
								<div className="text-[11px] uppercase text-description">
									{liveStatusText}
								</div>
								<div className="mt-1 text-sm font-semibold text-foreground wrap-anywhere">
									{activeTodo?.todo.content ||
										metadata.overview ||
										"Ready to build"}
								</div>
							</div>
							<div className="shrink-0 text-right">
								<div className="text-lg font-semibold text-foreground">
									{progressPercent}%
								</div>
								<div className="text-[10px] uppercase text-description">
									complete
								</div>
							</div>
						</div>
						<div className="h-1.5 overflow-hidden rounded-full bg-description/20">
							<div
								className={cn(
									"h-full rounded-full bg-primary transition-all duration-300",
									buildStatus === "complete" && "bg-success",
								)}
								style={{ width: `${progressPercent}%` }}
							/>
						</div>
						<div className="grid grid-cols-4 gap-1 text-center text-[10px] text-description">
							{PLAN_TODO_STATUSES.map((status) => (
								<div
									className="rounded-sm border border-description/20 px-1 py-1"
									key={status}
								>
									<div className="font-semibold text-foreground">
										{statusCounts[status]}
									</div>
									<div className="truncate">{statusLabels[status]}</div>
								</div>
							))}
						</div>
					</div>
				) : (
					<div className="mx-1 mt-2 grid gap-2 rounded-sm border border-description/20 bg-background/30 px-3 py-3">
						<div className="flex min-w-0 items-center justify-between gap-3">
							<div className="min-w-0">
								<div className="text-[11px] uppercase text-description">
									{isStartingBuild ? liveStatusText : "Plan ready"}
								</div>
								<div className="mt-1 text-sm font-semibold text-foreground wrap-anywhere">
									{displayPlanName || "Implementation plan"}
								</div>
							</div>
							{isStartingBuild && (
								<LoaderCircleIcon className="size-4 shrink-0 animate-spin text-primary" />
							)}
						</div>
						<div className="wrap-anywhere max-h-52 overflow-auto border-t-1 border-description/20 pt-2 text-sm [&_a]:break-all [&_code]:break-words [&_code]:whitespace-normal [&_hr]:opacity-20 [&_p:last-child]:mb-0 [&_pre]:max-w-full">
							{showRawMarkdown ? (
								<pre className="m-0 whitespace-pre-wrap break-words font-mono text-xs text-description">
									{planPreviewMarkdown}
								</pre>
							) : (
								<MarkdownBlock markdown={planPreviewMarkdown} />
							)}
						</div>
					</div>
				)}

				{hasPlanArtifact && (
					<div className="mx-1 mt-2 flex min-w-0 items-center gap-1 rounded-sm border border-description/20 px-2 py-1 text-[11px] text-description">
						<FileTextIcon className="size-3 shrink-0" />
						<span
							className="max-w-[45%] shrink-0 truncate font-medium text-foreground"
							title={visiblePlanPath}
						>
							{visiblePlanName}
						</span>
						<span
							className="min-w-0 truncate font-mono"
							title={visiblePlanPath}
						>
							{visiblePlanPath}
						</span>
					</div>
				)}

				{hasPlanArtifact ? (
					<div className="w-full relative border-t-1 border-description/20 rounded-b-sm">
						<div className="grid gap-2 p-2 pt-3">
							<div className="grid gap-1 rounded-sm border border-description/20 px-2 py-2">
								<div className="text-sm font-semibold text-foreground wrap-anywhere">
									{metadata.name}
								</div>
								{metadata.overview && (
									<div className="text-xs leading-relaxed text-description wrap-anywhere">
										{metadata.overview}
									</div>
								)}
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
									const StatusIcon = statusIcons[status];
									return (
										<Button
											aria-label={statusLabels[status]}
											disabled={!hasSelectedTodos}
											key={status}
											onClick={() => updateStatus(selectedTodoIds, status)}
											size="icon"
											title={statusLabels[status]}
											variant="ghost"
										>
											<StatusIcon
												className={cn(
													"size-3",
													status === "in_progress" && "animate-spin",
												)}
											/>
										</Button>
									);
								})}
								<Button
									aria-label="Delete selected"
									disabled={!hasSelectedTodos}
									onClick={deleteSelectedTodos}
									size="icon"
									title="Delete selected"
									variant="ghost"
								>
									<Trash2Icon className="size-3" />
								</Button>
								<Button
									aria-label="Save plan"
									disabled={isSaving}
									onClick={() => savePlan()}
									size="icon"
									title="Save plan"
								>
									{isSaving ? (
										<LoaderCircleIcon className="size-3 animate-spin" />
									) : (
										<SaveIcon className="size-3" />
									)}
								</Button>
							</div>

							<div className="border-t-1 border-description/20 pt-2">
								{renderTodos()}
							</div>

							{showRawMarkdown ? (
								<div className="grid gap-2">
									<textarea
										className={cn(
											"min-h-32 w-full resize-y bg-transparent border border-description/30 rounded-sm px-2 py-2 text-sm outline-none focus:border-primary/60",
											searchMatchesBody &&
												"outline outline-1 outline-primary/40",
										)}
										onChange={(event) => setBody(event.target.value)}
										value={body}
									/>
									<div className="flex justify-end">
										<Button
											disabled={isSaving}
											onClick={() => savePlan()}
											size="sm"
											title="Save Markdown"
										>
											{isSaving ? (
												<LoaderCircleIcon className="size-3 animate-spin" />
											) : (
												<SaveIcon className="size-3" />
											)}
											Save Markdown
										</Button>
									</div>
								</div>
							) : (
								<div className="wrap-anywhere overflow-hidden border-t-1 border-description/20 pt-3 [&_a]:break-all [&_code]:break-words [&_code]:whitespace-normal [&_hr]:opacity-20 [&_p:last-child]:mb-0 [&_pre]:max-w-full">
									<MarkdownBlock markdown={body || text} />
								</div>
							)}
						</div>
					</div>
				) : hasStructuredTodos ? (
					<div className="w-full relative border-t-1 border-description/20 rounded-b-sm">
						<div className="plan-completion-content p-2 pt-3 w-full [&_hr]:opacity-20 [&_p:last-child]:mb-0">
							<div className="wrap-anywhere overflow-hidden [&_a]:break-all [&_code]:break-words [&_code]:whitespace-normal [&_hr]:opacity-20 [&_pre]:max-w-full">
								<MarkdownBlock markdown={text} />
							</div>
						</div>
					</div>
				) : null}

				{(hasPlanArtifact || canBuild) && (
					<div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1 border-t-1 border-description/20 pt-2 px-1">
						<div
							className="flex min-w-0 items-center gap-1.5 rounded-sm border border-description/20 bg-background/30 px-2 py-1 text-xs"
							data-plan-visible-summary
							title={
								previewText
									? `${displayPlanName} - ${previewText}`
									: displayPlanName
							}
						>
							<span className="shrink-0 rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase text-primary">
								{liveStatusText}
							</span>
							<span className="min-w-0 truncate font-semibold text-foreground">
								{displayPlanName || "Implementation plan"}
							</span>
							{previewText && (
								<span className="hidden min-w-0 flex-1 truncate text-description min-[420px]:block">
									{previewText}
								</span>
							)}
							{visibleTodoCount > 0 && (
								<span className="shrink-0 rounded-sm border border-description/20 px-1.5 py-0.5 text-[10px] text-description">
									{visibleCompletedCount}/{visibleTodoCount} tasks
								</span>
							)}
						</div>
						<div className="flex items-center justify-end gap-1">
							<Button
								aria-label="Copy plan"
								onClick={() =>
									navigator.clipboard.writeText(plan?.serialized || text || "")
								}
								size="icon"
								title="Copy plan"
								variant="ghost"
							>
								<CopyIcon className="size-3" />
							</Button>
							<Button
								aria-label={
									showRawMarkdown ? "Show rendered plan" : "Show raw markdown"
								}
								onClick={() => setShowRawMarkdown((current) => !current)}
								size="sm"
								title={
									showRawMarkdown ? "Show rendered plan" : "Show raw markdown"
								}
								variant="ghost"
							>
								<FileTextIcon className="size-3" />
								{showRawMarkdown ? "Rendered" : "Raw Markdown"}
							</Button>
						</div>
						<div className="col-span-2 flex flex-wrap justify-end gap-1">
							{renderBuildActionMenu("Build actions", "h-8 min-w-48 px-2")}
						</div>
					</div>
				)}
			</div>
		);
	},
);

PlanCompletionOutputRow.displayName = "PlanCompletionOutputRow";

export default PlanCompletionOutputRow;
