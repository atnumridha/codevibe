import {
	getPlanStorageService,
	registerPlanChangeHandler,
	registerPlanOpenHandler,
	type PlanRegistryRecord,
} from "@core/plan/PlanStorageService"
import {
	buildLocalPlanExecutionMessage,
	cyclePlanTodoStatus,
	getPlanTodos,
	normalizePlanTodoStatus,
	type PlanBuildMode,
} from "@shared/plan-build"
import { getWorkspacePath } from "@utils/path"
import * as path from "node:path"
import * as vscode from "vscode"
import type { Controller } from "@/core/controller"
import { ExtensionRegistryInfo } from "@/registry"
import { Logger } from "@/shared/services/Logger"

const PLAN_VIEW_ID = `${ExtensionRegistryInfo.views.AgentContainer}-plans`
const PLAN_EDITOR_VIEW_TYPE = "codevibe.planEditor"

type PlanCommandTarget = PlanTreeItem | vscode.Uri | string | undefined
type PlanEditorMessage = {
	command?: string
	todoId?: string
	todoIds?: string[]
	status?: string
	content?: string
	beforeContent?: string
	afterContent?: string
}

export function registerVscodePlanIntegration(
	context: vscode.ExtensionContext,
	getController: () => Controller | undefined,
): void {
	const provider = new VscodePlanTreeProvider()
	const treeView = vscode.window.createTreeView(PLAN_VIEW_ID, {
		treeDataProvider: provider,
		showCollapseAll: false,
	})

	context.subscriptions.push(
		treeView,
		provider,
		vscode.commands.registerCommand(ExtensionRegistryInfo.commands.PlansRefresh, () => provider.refresh()),
		registerPlanChangeHandler(() => provider.refresh()),
		registerPlanOpenHandler(async ({ planPath }) => {
			await openPlanPath(planPath)
		}),
		vscode.commands.registerCommand(ExtensionRegistryInfo.commands.PlansOpenLatest, async () => {
			const latest = await provider.getLatestPlan()
			if (!latest) {
				void vscode.window.showInformationMessage("No local Codie plans found yet.")
				return
			}
			await openPlanPath(latest.uri)
		}),
		vscode.commands.registerCommand(ExtensionRegistryInfo.commands.PlansOpenFolder, async () => {
			const planDir = await getPlanStorageService().getPlanDir(await getWorkspacePath())
			await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(planDir))
		}),
		vscode.commands.registerCommand(ExtensionRegistryInfo.commands.PlansOpen, async (target?: PlanCommandTarget) => {
			const planPath = await resolvePlanPath(target, provider)
			if (planPath) {
				await openPlanPath(planPath)
			}
		}),
		vscode.commands.registerCommand(ExtensionRegistryInfo.commands.PlansBuildLocal, async (target?: PlanCommandTarget) => {
			await buildPlanFromNativeCommand(getController(), await resolvePlanPath(target, provider), "agent", provider)
		}),
		vscode.commands.registerCommand(ExtensionRegistryInfo.commands.PlansBuildParallel, async (target?: PlanCommandTarget) => {
			await buildPlanFromNativeCommand(getController(), await resolvePlanPath(target, provider), "multitask", provider)
		}),
		vscode.window.registerCustomEditorProvider(
			PLAN_EDITOR_VIEW_TYPE,
			new VscodePlanEditorProvider(getController, () => provider.refresh()),
			{
				supportsMultipleEditorsPerDocument: false,
				webviewOptions: { retainContextWhenHidden: true },
			},
		),
	)
}

class VscodePlanTreeProvider implements vscode.TreeDataProvider<PlanTreeItem>, vscode.Disposable {
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<PlanTreeItem | undefined | void>()
	readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event
	private watcher?: vscode.FileSystemWatcher

	refresh(): void {
		void this.ensureWatcher().finally(() => this.onDidChangeTreeDataEmitter.fire())
	}

	async getChildren(element?: PlanTreeItem): Promise<PlanTreeItem[]> {
		if (element) {
			return []
		}
		await this.ensureWatcher()
		const plans = await getPlanStorageService().listPlans(await getWorkspacePath())
		if (!plans.length) {
			return [PlanTreeItem.empty()]
		}
		return plans.map((plan) => PlanTreeItem.fromPlan(plan))
	}

	getTreeItem(element: PlanTreeItem): vscode.TreeItem {
		return element
	}

	async getLatestPlan(): Promise<PlanRegistryRecord | undefined> {
		const plans = await getPlanStorageService().listPlans(await getWorkspacePath())
		return plans[0]
	}

	dispose(): void {
		this.watcher?.dispose()
		this.onDidChangeTreeDataEmitter.dispose()
	}

	private async ensureWatcher(): Promise<void> {
		if (this.watcher) {
			return
		}
		const planDir = await getPlanStorageService().getPlanDir(await getWorkspacePath())
		const pattern = new vscode.RelativePattern(planDir, "*.plan.md")
		this.watcher = vscode.workspace.createFileSystemWatcher(pattern)
		this.watcher.onDidCreate(() => this.onDidChangeTreeDataEmitter.fire())
		this.watcher.onDidChange(() => this.onDidChangeTreeDataEmitter.fire())
		this.watcher.onDidDelete(() => this.onDidChangeTreeDataEmitter.fire())
	}
}

class PlanTreeItem extends vscode.TreeItem {
	readonly planPath?: string

	private constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState, planPath?: string) {
		super(label, collapsibleState)
		this.planPath = planPath
	}

	static fromPlan(plan: PlanRegistryRecord): PlanTreeItem {
		const item = new PlanTreeItem(plan.name || path.basename(plan.uri), vscode.TreeItemCollapsibleState.None, plan.uri)
		item.id = plan.id
		item.resourceUri = vscode.Uri.file(plan.uri)
		item.contextValue = "codevibe.plan"
		item.description = plan.status
		item.tooltip = `${plan.name}\n${plan.uri}`
		item.iconPath = new vscode.ThemeIcon(plan.status === "complete" ? "check" : "checklist")
		item.command = {
			command: ExtensionRegistryInfo.commands.PlansOpen,
			title: "Open Plan",
			arguments: [item],
		}
		return item
	}

	static empty(): PlanTreeItem {
		const item = new PlanTreeItem("No local plans yet", vscode.TreeItemCollapsibleState.None)
		item.contextValue = "codevibe.plan.empty"
		item.description = "Plan mode will create .plan.md files here"
		item.iconPath = new vscode.ThemeIcon("info")
		return item
	}
}

async function resolvePlanPath(target: PlanCommandTarget, provider: VscodePlanTreeProvider): Promise<string | undefined> {
	if (target instanceof PlanTreeItem) {
		return target.planPath
	}
	if (target instanceof vscode.Uri) {
		return target.fsPath
	}
	if (typeof target === "string" && target.trim()) {
		return target
	}
	const latest = await provider.getLatestPlan()
	return latest?.uri
}

async function openPlanPath(planPath: string): Promise<void> {
	await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(planPath), PLAN_EDITOR_VIEW_TYPE, {
		preview: false,
		viewColumn: vscode.ViewColumn.Active,
	})
}

async function openRawPlanPath(planPath: string): Promise<void> {
	const document = await vscode.workspace.openTextDocument(vscode.Uri.file(planPath))
	await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Active })
}

async function buildPlanFromNativeCommand(
	controller: Controller | undefined,
	planPath: string | undefined,
	requestedMode: Exclude<PlanBuildMode, "project">,
	provider: VscodePlanTreeProvider,
	todoIds: string[] = [],
): Promise<void> {
	if (!controller) {
		void vscode.window.showErrorMessage("Codie controller is not ready yet.")
		return
	}
	if (!planPath) {
		void vscode.window.showInformationMessage("No local Codie plan selected.")
		return
	}

	const storage = getPlanStorageService()
	const workspacePath = await getWorkspacePath()
	const initialPlan = await storage.readPlan({ planPath, workspacePath })
	const executionMode: PlanBuildMode =
		requestedMode === "multitask" ? "multitask" : initialPlan.metadata.isProject ? "project" : "agent"
	const builderId = controller.task?.taskId || `vscode-plan-build-${Date.now()}`
	const registration = await storage.registerBuild({
		planId: initialPlan.planId,
		planPath: initialPlan.planPath,
		mode: executionMode,
		builderId,
		todoIds: todoIds.length > 0 ? todoIds : undefined,
		workspacePath,
	})

	const taskProgress = storage.planToTaskProgress(registration.plan, registration.todoIds)
	const message = buildLocalPlanExecutionMessage({
		planText: registration.plan.serialized,
		planPath: registration.plan.planPath,
		taskProgress,
		mode: executionMode,
		selectedTodoIds: registration.todoIds,
	})

	try {
		let started = false
		if (controller.task?.taskState.isAwaitingPlanResponse) {
			await controller.task.updateTaskProgressFromPlan(taskProgress)
			started = await controller.togglePlanActMode("act", {
				message,
				images: [],
				files: [registration.plan.planPath],
			})
		} else {
			const taskId = await controller.initTask(message, [], [registration.plan.planPath], undefined, { mode: "act" } as any)
			started = Boolean(taskId)
		}

		if (!started) {
			throw new Error("Codie could not start an Act-mode build from the selected plan.")
		}

		void vscode.window.showInformationMessage(
			executionMode === "multitask" ? "Started local parallel plan build." : "Started local plan build.",
		)
		provider.refresh()
	} catch (error) {
		await storage.rollbackBuild({
			planId: registration.plan.planId,
			planPath: registration.plan.planPath,
			builderId,
			workspacePath,
		})
		Logger.warn(`Failed to start native plan build: ${error}`)
		void vscode.window.showErrorMessage(error instanceof Error ? error.message : "Failed to start local plan build.")
	}
}

class VscodePlanEditorProvider implements vscode.CustomTextEditorProvider {
	constructor(
		private readonly getController: () => Controller | undefined,
		private readonly refreshPlans: () => void,
	) {}

	async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
		panel.webview.options = { enableScripts: true }

		const update = async () => {
			panel.webview.html = await this.getHtml(document, panel.webview)
		}

		const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
			if (event.document.uri.toString() === document.uri.toString()) {
				void update()
			}
		})
		panel.onDidDispose(() => changeSubscription.dispose())

		panel.webview.onDidReceiveMessage(async (message: PlanEditorMessage) => {
			switch (message.command) {
				case "buildLocal":
					await buildPlanFromNativeCommand(
						this.getController(),
						document.uri.fsPath,
						"agent",
						{
							refresh: this.refreshPlans,
						} as VscodePlanTreeProvider,
						sanitizeTodoIds(message.todoIds),
					)
					break
				case "buildParallel":
					await buildPlanFromNativeCommand(
						this.getController(),
						document.uri.fsPath,
						"multitask",
						{
							refresh: this.refreshPlans,
						} as VscodePlanTreeProvider,
						sanitizeTodoIds(message.todoIds),
					)
					break
				case "openRaw":
					await openRawPlanPath(document.uri.fsPath)
					break
				case "cycleTodo":
					await this.cycleTodo(document.uri.fsPath, message.todoId)
					await update()
					this.refreshPlans()
					break
				case "setTodosStatus":
					await this.setTodosStatus(document.uri.fsPath, sanitizeTodoIds(message.todoIds), message.status)
					await update()
					this.refreshPlans()
					break
				case "updateTodoContent":
					await this.updateTodoContent(document.uri.fsPath, message.todoId, message.content)
					await update()
					this.refreshPlans()
					break
				case "splitTodo":
					await this.splitTodo(document.uri.fsPath, message)
					await update()
					this.refreshPlans()
					break
				case "mergeTodoBackward":
					await this.mergeTodoBackward(document.uri.fsPath, message.todoId)
					await update()
					this.refreshPlans()
					break
				case "deleteTodos":
					await this.deleteTodos(document.uri.fsPath, sanitizeTodoIds(message.todoIds))
					await update()
					this.refreshPlans()
					break
			}
		})

		await update()
	}

	private async cycleTodo(planPath: string, todoId: string | undefined): Promise<void> {
		if (!todoId) {
			return
		}
		const workspacePath = await getWorkspacePath()
		const plan = await getPlanStorageService().readPlan({ planPath, workspacePath })
		const todo = getPlanTodos(plan.metadata).find((candidate) => candidate.id === todoId)
		if (!todo) {
			return
		}
		await getPlanStorageService().updateTodoStatus({
			planPath,
			todoIds: [todoId],
			status: cyclePlanTodoStatus(normalizePlanTodoStatus(todo.status)),
			workspacePath,
		})
	}

	private async setTodosStatus(planPath: string, todoIds: string[], status: string | undefined): Promise<void> {
		if (!todoIds.length) {
			return
		}
		await getPlanStorageService().updateTodoStatus({
			planPath,
			todoIds,
			status: normalizePlanTodoStatus(status),
			workspacePath: await getWorkspacePath(),
		})
	}

	private async updateTodoContent(planPath: string, todoId: string | undefined, content: string | undefined): Promise<void> {
		if (!todoId || content == null) {
			return
		}
		await getPlanStorageService().updateTodoContent({
			planPath,
			todoId,
			content,
			workspacePath: await getWorkspacePath(),
		})
	}

	private async splitTodo(planPath: string, message: PlanEditorMessage): Promise<void> {
		if (!message.todoId) {
			return
		}
		await getPlanStorageService().splitTodo({
			planPath,
			todoId: message.todoId,
			beforeContent: message.beforeContent || "",
			afterContent: message.afterContent || "",
			workspacePath: await getWorkspacePath(),
		})
	}

	private async mergeTodoBackward(planPath: string, todoId: string | undefined): Promise<void> {
		if (!todoId) {
			return
		}
		await getPlanStorageService().mergeTodoBackward({
			planPath,
			todoId,
			workspacePath: await getWorkspacePath(),
		})
	}

	private async deleteTodos(planPath: string, todoIds: string[]): Promise<void> {
		if (!todoIds.length) {
			return
		}
		await getPlanStorageService().removeTodoIds({
			planPath,
			todoIds,
			workspacePath: await getWorkspacePath(),
		})
	}

	private async getHtml(document: vscode.TextDocument, webview: vscode.Webview): Promise<string> {
		const nonce = getNonce()
		const cspSource = webview.cspSource
		const plan = await getPlanStorageService().readPlan({
			planPath: document.uri.fsPath,
			workspacePath: await getWorkspacePath(),
		})
		const todos = [
			...plan.metadata.todos.map((todo) => ({ ...todo, phase: "", group: "__top" })),
			...(plan.metadata.phases || []).flatMap((phase) =>
				phase.todos.map((todo) => ({ ...todo, phase: phase.name, group: phase.name })),
			),
		]
		const todoHtml =
			todos.length > 0
				? todos
						.map((todo, index) => {
							const statusClass = `todo-${escapeAttribute(todo.status)}`
							const phase = todo.phase ? `<span class="todo-phase">${escapeHtml(todo.phase)}</span>` : ""
							return `<li class="${statusClass}" data-todo-row data-todo-id="${escapeHtml(todo.id)}" data-todo-index="${index}" data-todo-group="${escapeHtml(todo.group)}">
								<button class="status" data-status-button title="Click to select. Cmd/Ctrl-click to cycle status.">${escapeHtml(todo.status)}</button>
								<input class="todo-input" data-todo-input value="${escapeHtml(todo.content)}" />
								${phase}
							</li>`
						})
						.join("")
				: `<li class="todo-empty">No executable todos found in frontmatter.</li>`
		const statusButtons = ["pending", "in_progress", "completed", "cancelled"]
			.map((status) => `<button data-bulk-status="${status}" disabled>${escapeHtml(status.replace("_", " "))}</button>`)
			.join("")

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(plan.metadata.name || "Codie Plan")}</title>
	<style>
		:root {
			color-scheme: dark light;
			font-family: var(--vscode-font-family);
			color: var(--vscode-editor-foreground);
			background: var(--vscode-editor-background);
		}
		body { margin: 0; }
		.shell { display: grid; grid-template-rows: auto 1fr; min-height: 100vh; }
		header {
			position: sticky; top: 0; z-index: 2;
			display: grid; gap: 10px; padding: 14px 18px;
			border-bottom: 1px solid var(--vscode-panel-border);
			background: var(--vscode-editor-background);
		}
		.title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
		h1 { margin: 0; font-size: 18px; line-height: 1.25; }
		.path { color: var(--vscode-descriptionForeground); font-size: 11px; font-family: var(--vscode-editor-font-family); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.actions { display: flex; gap: 8px; flex-wrap: wrap; }
		button {
			border: 1px solid var(--vscode-button-border, transparent);
			border-radius: 3px; padding: 5px 10px; cursor: pointer;
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}
		button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
		button:disabled { cursor: default; opacity: 0.45; }
		main { display: grid; grid-template-columns: minmax(220px, 320px) minmax(0, 1fr); gap: 18px; padding: 18px; }
		aside { border-right: 1px solid var(--vscode-panel-border); padding-right: 18px; }
		.meta { display: grid; gap: 8px; color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 16px; }
		.todo-toolbar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
		.todo-toolbar button { padding: 4px 7px; font-size: 11px; }
		.todo-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
		.todo-list li { display: grid; grid-template-columns: 86px minmax(0, 1fr); gap: 8px; align-items: start; padding: 8px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
		.todo-list li.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
		.status { justify-self: start; width: 100%; padding: 3px 5px; font-size: 10px; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
		.todo-input {
			width: 100%; box-sizing: border-box; border: 1px solid transparent; border-radius: 3px;
			padding: 3px 5px; color: inherit; background: transparent; font-family: var(--vscode-font-family);
		}
		.todo-input:focus { border-color: var(--vscode-focusBorder); outline: none; background: var(--vscode-input-background); }
		.todo-completed { opacity: 0.7; }
		.todo-in_progress { border-color: var(--vscode-progressBar-background); }
		.todo-phase { grid-column: 2; color: var(--vscode-descriptionForeground); font-size: 11px; }
		.todo-empty { color: var(--vscode-descriptionForeground); }
		.content { min-width: 0; line-height: 1.55; }
		.content h2 { margin-top: 24px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
		.content code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 1px 3px; border-radius: 3px; }
		pre { overflow: auto; padding: 12px; border-radius: 4px; background: var(--vscode-textCodeBlock-background); }
		.mermaid-preview { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 12px; overflow: auto; background: var(--vscode-editor-inactiveSelectionBackground); }
		.mermaid-svg text { fill: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); font-size: 12px; }
		.mermaid-svg rect { fill: var(--vscode-editor-background); stroke: var(--vscode-focusBorder); }
		.mermaid-svg path { stroke: var(--vscode-descriptionForeground); fill: none; marker-end: url(#arrow); }
		@media (max-width: 760px) { main { grid-template-columns: 1fr; } aside { border-right: 0; border-bottom: 1px solid var(--vscode-panel-border); padding-right: 0; padding-bottom: 16px; } }
	</style>
</head>
<body>
	<div class="shell">
		<header>
			<div class="title-row">
				<div>
					<h1>${escapeHtml(plan.metadata.name || "Codie Plan")}</h1>
					<div class="path">${escapeHtml(plan.planPath)}</div>
				</div>
				<div class="actions">
					<button class="primary" data-command="buildLocal">Build Locally</button>
					<button data-command="buildParallel">Build in Parallel</button>
					<button data-command="openRaw">Open Raw Markdown</button>
				</div>
			</div>
		</header>
		<main>
			<aside>
				<div class="meta">
					<div>Status: ${escapeHtml(plan.status)}</div>
					<div>Build: ${escapeHtml(plan.buildStatus)}</div>
					<div>Todos: ${plan.completedTodoCount}/${plan.todoCount}</div>
				</div>
				<div class="todo-toolbar">
					${statusButtons}
					<button data-command="deleteSelected" disabled>Delete</button>
					<button data-command="buildSelectedLocal" disabled>Build Selected</button>
					<button data-command="buildSelectedParallel" disabled>Build Selected Parallel</button>
				</div>
				<ul class="todo-list">${todoHtml}</ul>
			</aside>
			<section class="content">${renderPlanMarkdown(plan.body)}</section>
		</main>
	</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const selectedIds = new Set();
		let lastSelectedId;

		const rows = () => Array.from(document.querySelectorAll('[data-todo-row]'));
		const selectedPayload = () => Array.from(selectedIds);
		const post = (command, extra = {}) => vscode.postMessage({ command, ...extra });
		const updateBulkState = () => {
			const hasSelection = selectedIds.size > 0;
			document.querySelectorAll('[data-bulk-status], [data-command="deleteSelected"], [data-command="buildSelectedLocal"], [data-command="buildSelectedParallel"]').forEach((button) => {
				button.disabled = !hasSelection;
			});
		};
		const syncSelectedClasses = () => {
			rows().forEach((row) => row.classList.toggle('selected', selectedIds.has(row.dataset.todoId)));
			updateBulkState();
		};
		const selectTodo = (row, event) => {
			const todoId = row.dataset.todoId;
			if (!todoId) {
				return;
			}
			if (event.shiftKey && lastSelectedId) {
				const group = row.dataset.todoGroup;
				const currentRows = rows().filter((candidate) => candidate.dataset.todoGroup === group);
				const from = currentRows.findIndex((candidate) => candidate.dataset.todoId === lastSelectedId);
				const to = currentRows.findIndex((candidate) => candidate.dataset.todoId === todoId);
				if (from >= 0 && to >= 0) {
					const start = Math.min(from, to);
					const end = Math.max(from, to);
					currentRows.slice(start, end + 1).forEach((candidate) => selectedIds.add(candidate.dataset.todoId));
					syncSelectedClasses();
					return;
				}
			}
			if (selectedIds.has(todoId)) {
				selectedIds.delete(todoId);
			} else {
				selectedIds.add(todoId);
			}
			lastSelectedId = todoId;
			syncSelectedClasses();
		};
		const focusAdjacent = (input, direction) => {
			const inputRows = rows();
			const row = input.closest('[data-todo-row]');
			const index = inputRows.indexOf(row);
			const next = inputRows[index + direction]?.querySelector('[data-todo-input]');
			if (next) {
				next.focus();
				const position = direction > 0 ? 0 : next.value.length;
				next.setSelectionRange(position, position);
			}
		};

		document.querySelectorAll('[data-command]').forEach((button) => {
			button.addEventListener('click', () => {
				const command = button.dataset.command;
				if (command === 'deleteSelected') {
					post('deleteTodos', { todoIds: selectedPayload() });
					return;
				}
				if (command === 'buildSelectedLocal') {
					post('buildLocal', { todoIds: selectedPayload() });
					return;
				}
				if (command === 'buildSelectedParallel') {
					post('buildParallel', { todoIds: selectedPayload() });
					return;
				}
				post(command);
			});
		});
		document.querySelectorAll('[data-bulk-status]').forEach((button) => {
			button.addEventListener('click', () => post('setTodosStatus', { todoIds: selectedPayload(), status: button.dataset.bulkStatus }));
		});
		document.querySelectorAll('[data-status-button]').forEach((button) => {
			button.addEventListener('click', (event) => {
				const row = button.closest('[data-todo-row]');
				const todoId = row?.dataset.todoId;
				if (!todoId) {
					return;
				}
				if (event.metaKey || event.ctrlKey) {
					post('cycleTodo', { todoId });
					return;
				}
				selectTodo(row, event);
			});
		});
		document.querySelectorAll('[data-todo-input]').forEach((input) => {
			input.addEventListener('blur', () => {
				const todoId = input.closest('[data-todo-row]')?.dataset.todoId;
				if (todoId) {
					post('updateTodoContent', { todoId, content: input.value });
				}
			});
			input.addEventListener('keydown', (event) => {
				const row = input.closest('[data-todo-row]');
				const todoId = row?.dataset.todoId;
				if (!todoId) {
					return;
				}
				const start = input.selectionStart ?? input.value.length;
				const end = input.selectionEnd ?? input.value.length;
				if (event.key === 'ArrowUp' && start === 0) {
					event.preventDefault();
					focusAdjacent(input, -1);
					return;
				}
				if (event.key === 'ArrowDown' && end === input.value.length) {
					event.preventDefault();
					focusAdjacent(input, 1);
					return;
				}
				if (event.key === 'Enter') {
					event.preventDefault();
					post('splitTodo', {
						todoId,
						beforeContent: input.value.slice(0, start),
						afterContent: input.value.slice(end),
					});
					return;
				}
				if (event.key === 'Backspace' && input.value.length === 0) {
					event.preventDefault();
					post('deleteTodos', { todoIds: [todoId] });
					return;
				}
				if (event.key === 'Backspace' && start === 0 && end === 0) {
					event.preventDefault();
					post('mergeTodoBackward', { todoId });
				}
			});
		});
		updateBulkState();
	</script>
</body>
</html>`
	}
}

function renderPlanMarkdown(markdown: string): string {
	const blocks: string[] = []
	let cursor = 0
	const fencePattern = /```(\w+)?\n([\s\S]*?)```/g
	let match: RegExpExecArray | null
	while ((match = fencePattern.exec(markdown))) {
		blocks.push(renderMarkdownText(markdown.slice(cursor, match.index)))
		const language = (match[1] || "").toLowerCase()
		const code = match[2] || ""
		if (language === "mermaid") {
			blocks.push(renderMermaidBlock(code))
		} else {
			blocks.push(`<pre><code>${escapeHtml(code)}</code></pre>`)
		}
		cursor = match.index + match[0].length
	}
	blocks.push(renderMarkdownText(markdown.slice(cursor)))
	return blocks.join("")
}

function renderMarkdownText(markdown: string): string {
	const lines = markdown.split(/\r?\n/)
	const html: string[] = []
	let inList = false
	for (const line of lines) {
		const trimmed = line.trim()
		if (!trimmed) {
			if (inList) {
				html.push("</ul>")
				inList = false
			}
			continue
		}
		const heading = trimmed.match(/^(#{1,4})\s+(.+)$/)
		if (heading) {
			if (inList) {
				html.push("</ul>")
				inList = false
			}
			const level = Math.min(heading[1].length + 1, 4)
			html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`)
			continue
		}
		const bullet = trimmed.match(/^[-*]\s+(?:\[[ xX]\]\s*)?(.+)$/)
		if (bullet) {
			if (!inList) {
				html.push("<ul>")
				inList = true
			}
			html.push(`<li>${renderInlineMarkdown(bullet[1])}</li>`)
			continue
		}
		if (inList) {
			html.push("</ul>")
			inList = false
		}
		html.push(`<p>${renderInlineMarkdown(trimmed)}</p>`)
	}
	if (inList) {
		html.push("</ul>")
	}
	return html.join("\n")
}

function renderInlineMarkdown(value: string): string {
	return escapeHtml(value)
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/`([^`]+)`/g, "<code>$1</code>")
}

function renderMermaidBlock(source: string): string {
	const graph = parseSimpleFlowchart(source)
	if (!graph) {
		return `<pre class="mermaid-preview"><code>${escapeHtml(source)}</code></pre>`
	}
	const boxWidth = 260
	const boxHeight = 44
	const gap = 28
	const width = boxWidth + 80
	const height = graph.nodes.length * (boxHeight + gap) + 24
	const nodeIndex = new Map(graph.nodes.map((node, index) => [node.id, index]))
	const nodes = graph.nodes
		.map((node, index) => {
			const y = 12 + index * (boxHeight + gap)
			return `<g><rect x="40" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="4"></rect><text x="${40 + boxWidth / 2}" y="${y + 27}" text-anchor="middle">${escapeHtml(node.label)}</text></g>`
		})
		.join("")
	const edges = graph.edges
		.map((edge) => {
			const from = nodeIndex.get(edge.from)
			const to = nodeIndex.get(edge.to)
			if (from == null || to == null) {
				return ""
			}
			const startY = 12 + from * (boxHeight + gap) + boxHeight
			const endY = 12 + to * (boxHeight + gap)
			return `<path d="M 170 ${startY} L 170 ${endY}"></path>`
		})
		.join("")
	return `<div class="mermaid-preview"><svg class="mermaid-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Mermaid flowchart preview"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="currentColor"></path></marker></defs>${edges}${nodes}</svg></div>`
}

function parseSimpleFlowchart(
	source: string,
): { nodes: Array<{ id: string; label: string }>; edges: Array<{ from: string; to: string }> } | undefined {
	if (!/^\s*(flowchart|graph)\b/im.test(source)) {
		return undefined
	}
	const nodes = new Map<string, string>()
	const edges: Array<{ from: string; to: string }> = []
	const nodePattern = /\b([A-Za-z][\w-]*)\[(?:"([^"]+)"|([^\]\n]+))\]/g
	let nodeMatch: RegExpExecArray | null
	while ((nodeMatch = nodePattern.exec(source))) {
		nodes.set(nodeMatch[1], (nodeMatch[2] || nodeMatch[3] || nodeMatch[1]).trim())
	}
	const edgePattern =
		/\b([A-Za-z][\w-]*)\[[^\]\n]+\]\s*-+>+\s*([A-Za-z][\w-]*)\[[^\]\n]+\]|\b([A-Za-z][\w-]*)\s*-+>+\s*([A-Za-z][\w-]*)/g
	let edgeMatch: RegExpExecArray | null
	while ((edgeMatch = edgePattern.exec(source))) {
		const from = edgeMatch[1] || edgeMatch[3]
		const to = edgeMatch[2] || edgeMatch[4]
		if (from && to) {
			edges.push({ from, to })
			if (!nodes.has(from)) {
				nodes.set(from, from)
			}
			if (!nodes.has(to)) {
				nodes.set(to, to)
			}
		}
	}
	if (nodes.size === 0) {
		return undefined
	}
	return { nodes: Array.from(nodes, ([id, label]) => ({ id, label })), edges }
}

function getNonce(): string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("")
}

function sanitizeTodoIds(todoIds: unknown): string[] {
	return Array.isArray(todoIds) ? todoIds.map(String).filter(Boolean) : []
}

function escapeHtml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

function escapeAttribute(value: string): string {
	return escapeHtml(value).replace(/\s+/g, "-")
}
