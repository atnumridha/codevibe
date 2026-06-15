import {
	getPlanStorageService,
	registerPlanChangeHandler,
	registerPlanOpenHandler,
	type PlanRegistryRecord,
} from "@core/plan/PlanStorageService";
import { acceptLocalPlanBuild } from "@core/controller/plan/buildPlan";
import {
	cyclePlanTodoStatus,
	getPlanTodos,
	normalizePlanTodoStatus,
	type PlanBuildMode,
} from "@shared/plan-build";
import { getWorkspacePath } from "@utils/path";
import * as path from "node:path";
import * as vscode from "vscode";
import type { Controller } from "@/core/controller";
import { ExtensionRegistryInfo } from "@/registry";
import { Logger } from "@/shared/services/Logger";

const PLAN_VIEW_ID = `${ExtensionRegistryInfo.views.AgentContainer}-plans`;
const PLAN_EDITOR_VIEW_TYPE = "codevibe.planEditor";

type PlanCommandTarget = PlanTreeItem | vscode.Uri | string | undefined;
type PlanEditorMessage = {
	command?: string;
	todoId?: string;
	todoIds?: string[];
	status?: string;
	content?: string;
	body?: string;
	beforeContent?: string;
	afterContent?: string;
};

export function registerVscodePlanIntegration(
	context: vscode.ExtensionContext,
	getController: () => Controller | undefined,
): void {
	const provider = new VscodePlanTreeProvider();
	const treeView = vscode.window.createTreeView(PLAN_VIEW_ID, {
		treeDataProvider: provider,
		showCollapseAll: false,
	});

	context.subscriptions.push(
		treeView,
		provider,
		vscode.commands.registerCommand(
			ExtensionRegistryInfo.commands.PlansRefresh,
			() => provider.refresh(),
		),
		registerPlanChangeHandler(() => provider.refresh()),
		registerPlanOpenHandler(async ({ planPath }) => {
			await openPlanPath(planPath);
		}),
		vscode.commands.registerCommand(
			ExtensionRegistryInfo.commands.PlansOpenLatest,
			async () => {
				const latest = await provider.getLatestPlan();
				if (!latest) {
					void vscode.window.showInformationMessage(
						"No local Codie plans found yet.",
					);
					return;
				}
				await openPlanPath(latest.uri);
			},
		),
		vscode.commands.registerCommand(
			ExtensionRegistryInfo.commands.PlansOpenFolder,
			async () => {
				const planDir = await getPlanStorageService().getPlanDir(
					await getWorkspacePath(),
				);
				await vscode.commands.executeCommand(
					"revealFileInOS",
					vscode.Uri.file(planDir),
				);
			},
		),
		vscode.commands.registerCommand(
			ExtensionRegistryInfo.commands.PlansOpen,
			async (target?: PlanCommandTarget) => {
				const planPath = await resolvePlanPath(target, provider);
				if (planPath) {
					await openPlanPath(planPath);
				}
			},
		),
		vscode.commands.registerCommand(
			ExtensionRegistryInfo.commands.PlansBuildLocal,
			async (target?: PlanCommandTarget) => {
				await buildPlanFromNativeCommand(
					getController(),
					await resolvePlanPath(target, provider),
					"agent",
					provider,
				);
			},
		),
		vscode.commands.registerCommand(
			ExtensionRegistryInfo.commands.PlansBuildParallel,
			async (target?: PlanCommandTarget) => {
				await buildPlanFromNativeCommand(
					getController(),
					await resolvePlanPath(target, provider),
					"multitask",
					provider,
				);
			},
		),
		vscode.window.registerCustomEditorProvider(
			PLAN_EDITOR_VIEW_TYPE,
			new VscodePlanEditorProvider(context.extensionUri, getController, () =>
				provider.refresh(),
			),
			{
				supportsMultipleEditorsPerDocument: false,
				webviewOptions: { retainContextWhenHidden: true },
			},
		),
	);
}

class VscodePlanTreeProvider
	implements vscode.TreeDataProvider<PlanTreeItem>, vscode.Disposable
{
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
		PlanTreeItem | undefined | void
	>();
	readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
	private watcher?: vscode.FileSystemWatcher;

	refresh(): void {
		void this.ensureWatcher().finally(() =>
			this.onDidChangeTreeDataEmitter.fire(),
		);
	}

	async getChildren(element?: PlanTreeItem): Promise<PlanTreeItem[]> {
		if (element) {
			return [];
		}
		await this.ensureWatcher();
		const plans = await getPlanStorageService().listPlans(
			await getWorkspacePath(),
		);
		if (!plans.length) {
			return [PlanTreeItem.empty()];
		}
		return plans.map((plan) => PlanTreeItem.fromPlan(plan));
	}

	getTreeItem(element: PlanTreeItem): vscode.TreeItem {
		return element;
	}

	async getLatestPlan(): Promise<PlanRegistryRecord | undefined> {
		const plans = await getPlanStorageService().listPlans(
			await getWorkspacePath(),
		);
		return plans[0];
	}

	dispose(): void {
		this.watcher?.dispose();
		this.onDidChangeTreeDataEmitter.dispose();
	}

	private async ensureWatcher(): Promise<void> {
		if (this.watcher) {
			return;
		}
		const planDir = await getPlanStorageService().getPlanDir(
			await getWorkspacePath(),
		);
		const pattern = new vscode.RelativePattern(planDir, "*.plan.md");
		this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
		this.watcher.onDidCreate(() => this.onDidChangeTreeDataEmitter.fire());
		this.watcher.onDidChange(() => this.onDidChangeTreeDataEmitter.fire());
		this.watcher.onDidDelete(() => this.onDidChangeTreeDataEmitter.fire());
	}
}

class PlanTreeItem extends vscode.TreeItem {
	readonly planPath?: string;

	private constructor(
		label: string,
		collapsibleState: vscode.TreeItemCollapsibleState,
		planPath?: string,
	) {
		super(label, collapsibleState);
		this.planPath = planPath;
	}

	static fromPlan(plan: PlanRegistryRecord): PlanTreeItem {
		const item = new PlanTreeItem(
			plan.name || path.basename(plan.uri),
			vscode.TreeItemCollapsibleState.None,
			plan.uri,
		);
		item.id = plan.id;
		item.resourceUri = vscode.Uri.file(plan.uri);
		item.contextValue = "codevibe.plan";
		item.description = plan.status;
		item.tooltip = `${plan.name}\n${plan.uri}`;
		item.iconPath = new vscode.ThemeIcon(
			plan.status === "complete" ? "check" : "checklist",
		);
		item.command = {
			command: ExtensionRegistryInfo.commands.PlansOpen,
			title: "Open Plan",
			arguments: [item],
		};
		return item;
	}

	static empty(): PlanTreeItem {
		const item = new PlanTreeItem(
			"No local plans yet",
			vscode.TreeItemCollapsibleState.None,
		);
		item.contextValue = "codevibe.plan.empty";
		item.description = "Plan mode will create .plan.md files here";
		item.iconPath = new vscode.ThemeIcon("info");
		return item;
	}
}

async function resolvePlanPath(
	target: PlanCommandTarget,
	provider: VscodePlanTreeProvider,
): Promise<string | undefined> {
	if (target instanceof PlanTreeItem) {
		return target.planPath;
	}
	if (target instanceof vscode.Uri) {
		return target.fsPath;
	}
	if (typeof target === "string" && target.trim()) {
		return target;
	}
	const latest = await provider.getLatestPlan();
	return latest?.uri;
}

async function openPlanPath(planPath: string): Promise<void> {
	await vscode.commands.executeCommand(
		"vscode.openWith",
		vscode.Uri.file(planPath),
		PLAN_EDITOR_VIEW_TYPE,
		{
			preview: false,
			viewColumn: vscode.ViewColumn.Active,
		},
	);
}

async function openRawPlanPath(planPath: string): Promise<void> {
	const document = await vscode.workspace.openTextDocument(
		vscode.Uri.file(planPath),
	);
	await vscode.window.showTextDocument(document, {
		preview: false,
		viewColumn: vscode.ViewColumn.Active,
	});
}

async function buildPlanFromNativeCommand(
	controller: Controller | undefined,
	planPath: string | undefined,
	requestedMode: Exclude<PlanBuildMode, "project">,
	provider: VscodePlanTreeProvider,
	todoIds: string[] = [],
	options: { forceNewAgent?: boolean; skipSubmission?: boolean } = {},
): Promise<void> {
	if (!controller) {
		void vscode.window.showErrorMessage("Codie controller is not ready yet.");
		return;
	}
	if (!planPath) {
		void vscode.window.showInformationMessage("No local Codie plan selected.");
		return;
	}

	try {
		const accepted = await acceptLocalPlanBuild(controller, {
			planPath,
			requestedMode,
			todoIds,
			forceNewAgent: options.forceNewAgent,
			skipSubmission: options.skipSubmission,
		});

		if (!accepted.started) {
			throw new Error(
				"Codie could not start an Act-mode build from the selected plan.",
			);
		}

		await vscode.commands.executeCommand(
			ExtensionRegistryInfo.commands.FocusChatInput,
			false,
		);

		void vscode.window.showInformationMessage(
			accepted.mode === "multitask"
				? "Codie started a local parallel plan build in Act mode."
				: options.forceNewAgent
					? "Codie started a new local agent for the selected plan todos."
					: "Codie started a local plan build in Act mode.",
		);
		provider.refresh();
	} catch (error) {
		Logger.warn(`Failed to start native plan build: ${error}`);
		void vscode.window.showErrorMessage(
			error instanceof Error
				? error.message
				: "Failed to start local plan build.",
		);
	}
}

class VscodePlanEditorProvider implements vscode.CustomTextEditorProvider {
	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly getController: () => Controller | undefined,
		private readonly refreshPlans: () => void,
	) {}

	async resolveCustomTextEditor(
		document: vscode.TextDocument,
		panel: vscode.WebviewPanel,
	): Promise<void> {
		panel.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri],
		};

		const update = async () => {
			panel.webview.html = await this.getHtml(document, panel.webview);
		};

		const changeSubscription = vscode.workspace.onDidChangeTextDocument(
			(event) => {
				if (event.document.uri.toString() === document.uri.toString()) {
					void update();
				}
			},
		);
		panel.onDidDispose(() => changeSubscription.dispose());

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
					);
					break;
				case "buildParallel":
					await buildPlanFromNativeCommand(
						this.getController(),
						document.uri.fsPath,
						"multitask",
						{
							refresh: this.refreshPlans,
						} as VscodePlanTreeProvider,
						sanitizeTodoIds(message.todoIds),
						{ skipSubmission: true },
					);
					break;
				case "buildNewAgent":
					await buildPlanFromNativeCommand(
						this.getController(),
						document.uri.fsPath,
						"agent",
						{
							refresh: this.refreshPlans,
						} as VscodePlanTreeProvider,
						sanitizeTodoIds(message.todoIds),
						{ forceNewAgent: true },
					);
					break;
				case "openRaw":
					await openRawPlanPath(document.uri.fsPath);
					break;
				case "saveRaw":
					await this.saveRawBody(document.uri.fsPath, message.body);
					await update();
					this.refreshPlans();
					break;
				case "cycleTodo":
					await this.cycleTodo(document.uri.fsPath, message.todoId);
					await update();
					this.refreshPlans();
					break;
				case "setTodosStatus":
					await this.setTodosStatus(
						document.uri.fsPath,
						sanitizeTodoIds(message.todoIds),
						message.status,
					);
					await update();
					this.refreshPlans();
					break;
				case "updateTodoContent":
					await this.updateTodoContent(
						document.uri.fsPath,
						message.todoId,
						message.content,
					);
					await update();
					this.refreshPlans();
					break;
				case "splitTodo":
					await this.splitTodo(document.uri.fsPath, message);
					await update();
					this.refreshPlans();
					break;
				case "mergeTodoBackward":
					await this.mergeTodoBackward(document.uri.fsPath, message.todoId);
					await update();
					this.refreshPlans();
					break;
				case "deleteTodos":
					await this.deleteTodos(
						document.uri.fsPath,
						sanitizeTodoIds(message.todoIds),
					);
					await update();
					this.refreshPlans();
					break;
			}
		});

		await update();
	}

	private async saveRawBody(
		planPath: string,
		body: string | undefined,
	): Promise<void> {
		if (body == null) {
			return;
		}
		const workspacePath = await getWorkspacePath();
		const plan = await getPlanStorageService().readPlan({
			planPath,
			workspacePath,
		});
		await getPlanStorageService().updatePlan({
			planId: plan.planId,
			planPath,
			metadata: plan.metadata,
			body,
			workspacePath,
		});
	}

	private async cycleTodo(
		planPath: string,
		todoId: string | undefined,
	): Promise<void> {
		if (!todoId) {
			return;
		}
		const workspacePath = await getWorkspacePath();
		const plan = await getPlanStorageService().readPlan({
			planPath,
			workspacePath,
		});
		const todo = getPlanTodos(plan.metadata).find(
			(candidate) => candidate.id === todoId,
		);
		if (!todo) {
			return;
		}
		await getPlanStorageService().updateTodoStatus({
			planPath,
			todoIds: [todoId],
			status: cyclePlanTodoStatus(normalizePlanTodoStatus(todo.status)),
			workspacePath,
		});
	}

	private async setTodosStatus(
		planPath: string,
		todoIds: string[],
		status: string | undefined,
	): Promise<void> {
		if (!todoIds.length) {
			return;
		}
		await getPlanStorageService().updateTodoStatus({
			planPath,
			todoIds,
			status: normalizePlanTodoStatus(status),
			workspacePath: await getWorkspacePath(),
		});
	}

	private async updateTodoContent(
		planPath: string,
		todoId: string | undefined,
		content: string | undefined,
	): Promise<void> {
		if (!todoId || content == null) {
			return;
		}
		await getPlanStorageService().updateTodoContent({
			planPath,
			todoId,
			content,
			workspacePath: await getWorkspacePath(),
		});
	}

	private async splitTodo(
		planPath: string,
		message: PlanEditorMessage,
	): Promise<void> {
		if (!message.todoId) {
			return;
		}
		await getPlanStorageService().splitTodo({
			planPath,
			todoId: message.todoId,
			beforeContent: message.beforeContent || "",
			afterContent: message.afterContent || "",
			workspacePath: await getWorkspacePath(),
		});
	}

	private async mergeTodoBackward(
		planPath: string,
		todoId: string | undefined,
	): Promise<void> {
		if (!todoId) {
			return;
		}
		await getPlanStorageService().mergeTodoBackward({
			planPath,
			todoId,
			workspacePath: await getWorkspacePath(),
		});
	}

	private async deleteTodos(
		planPath: string,
		todoIds: string[],
	): Promise<void> {
		if (!todoIds.length) {
			return;
		}
		await getPlanStorageService().removeTodoIds({
			planPath,
			todoIds,
			workspacePath: await getWorkspacePath(),
		});
	}

	private async getHtml(
		document: vscode.TextDocument,
		webview: vscode.Webview,
	): Promise<string> {
		const nonce = getNonce();
		const cspSource = webview.cspSource;
		const mermaidScriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(
				this.extensionUri,
				"assets",
				"plan-editor",
				"mermaid.min.js",
			),
		);
		const plan = await getPlanStorageService().readPlan({
			planPath: document.uri.fsPath,
			workspacePath: await getWorkspacePath(),
		});
		const todos = [
			...plan.metadata.todos.map((todo) => ({
				...todo,
				phase: "",
				group: "__top",
			})),
			...(plan.metadata.phases || []).flatMap((phase) =>
				phase.todos.map((todo) => ({
					...todo,
					phase: phase.name,
					group: phase.name,
				})),
			),
		];
		const completedTodoCount = todos.filter(
			(todo) => todo.status === "completed" || todo.status === "cancelled",
		).length;
		const progressPercent =
			todos.length > 0
				? Math.round((completedTodoCount / todos.length) * 100)
				: 0;
		const statusCounts = todos.reduce(
			(counts, todo) => {
				const status =
					todo.status === "in_progress" ||
					todo.status === "completed" ||
					todo.status === "cancelled"
						? todo.status
						: "pending";
				counts[status] += 1;
				return counts;
			},
			{ pending: 0, in_progress: 0, completed: 0, cancelled: 0 },
		);
		const activeTodo =
			todos.find((todo) => todo.status === "in_progress") ||
			todos.find((todo) => todo.status === "pending");
		const liveStatus =
			plan.buildStatus === "active"
				? "Build active"
				: plan.buildStatus === "complete"
					? "Build complete"
					: plan.status === "complete"
						? "Plan complete"
						: "Planning";
		const humanizeStatus = (value: string) =>
			value
				.replace(/_/g, " ")
				.replace(/\b\w/g, (character) => character.toUpperCase());
		const hasMermaid = /```mermaid\b/i.test(plan.body);
		const planStatusLabel = humanizeStatus(plan.status);
		const buildStatusLabel =
			plan.buildStatus === "none"
				? "Not Started"
				: humanizeStatus(plan.buildStatus);
		const diagramLabel = hasMermaid ? "Mermaid" : "None";
		const todoHtml =
			todos.length > 0
				? todos
						.map((todo, index) => {
							const statusClass = `todo-${escapeAttribute(todo.status)}`;
								const statusLabel = humanizeStatus(todo.status);
								const phase = todo.phase
									? `<span class="todo-phase">${escapeHtml(todo.phase)}</span>`
									: "";
								return `<li class="${statusClass}" data-todo-row data-todo-id="${escapeHtml(todo.id)}" data-todo-index="${index}" data-todo-group="${escapeHtml(todo.group)}">
									<button class="status" data-status-button title="Click to select. Cmd/Ctrl-click to cycle status." aria-label="Select ${escapeAttribute(statusLabel)} task"><span></span></button>
									<div class="todo-content">
										<div class="todo-kicker">${phase || `<span>Task ${index + 1}</span>`}<span class="todo-state">${escapeHtml(statusLabel)}</span></div>
										<input class="todo-input" data-todo-input value="${escapeHtml(todo.content)}" />
										${
											(todo.dependencies ?? []).length
											? `<div class="dependency-row">${(todo.dependencies ?? [])
													.slice(0, 4)
													.map(
														(dependency) =>
															`<span>${escapeHtml(dependency)}</span>`,
													)
													.join("")}</div>`
											: ""
									}
								</div>
							</li>`;
						})
						.join("")
				: `<li class="todo-empty">No executable todos found in frontmatter.</li>`;
		const statusSummaryHtml = [
			"pending",
			"in_progress",
			"completed",
			"cancelled",
			]
				.map((status) => {
					const label = humanizeStatus(status);
					const count = statusCounts[status as keyof typeof statusCounts] ?? 0;
					return `<div class="status-card status-card-${escapeAttribute(status)}"><strong>${count}</strong><span>${escapeHtml(label)}</span></div>`;
				})
			.join("");
		const statusOptions = ["pending", "in_progress", "completed", "cancelled"]
			.map(
				(status) =>
					`<option value="${escapeAttribute(status)}">${escapeHtml(humanizeStatus(status))}</option>`,
			)
			.join("");
		const serializedPlanJson = escapeScriptJson(plan.serialized);

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data: blob:; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(plan.metadata.name || "Codie Plan")}</title>
	<style>
		:root {
			color-scheme: dark light;
			font-family: var(--vscode-font-family);
			color: var(--vscode-editor-foreground);
			background: var(--vscode-editor-background);
		}
		* { box-sizing: border-box; }
			body { margin: 0; background: var(--vscode-editor-background); }
			.shell { display: grid; grid-template-rows: auto 1fr; min-height: 100vh; }
			.plan-header {
				position: sticky; top: 0; z-index: 2;
				display: grid; gap: 10px; padding: 12px 18px 10px;
				border-bottom: 1px solid var(--vscode-panel-border);
				background: var(--vscode-editor-background);
				box-shadow: 0 1px 0 color-mix(in srgb, var(--vscode-panel-border), transparent 45%);
			}
			.title-row {
				display: grid;
				grid-template-columns: minmax(220px, 1fr) max-content;
				align-items: start;
				gap: 16px;
			}
			.title-stack { min-width: 0; display: grid; gap: 3px; }
			.eyebrow { color: var(--vscode-descriptionForeground); font-size: 10px; letter-spacing: 0; text-transform: uppercase; }
			h1 { margin: 0; font-size: 18px; line-height: 1.25; overflow-wrap: anywhere; }
			.path { color: var(--vscode-descriptionForeground); font-size: 11px; font-family: var(--vscode-editor-font-family); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.actions {
				display: flex;
				justify-content: flex-end;
				align-items: center;
				gap: 8px;
				flex-wrap: nowrap;
				min-width: 0;
			}
			.select-control { display: grid; gap: 3px; min-width: 152px; }
			.select-control span {
				color: var(--vscode-descriptionForeground);
				font-size: 10px;
				line-height: 1;
				text-transform: uppercase;
			}
			.select-control select {
				height: 30px;
				min-width: 0;
				border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border));
				border-radius: 6px;
				padding: 0 28px 0 9px;
				background: var(--vscode-dropdown-background, var(--vscode-input-background));
				color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
				font-family: var(--vscode-font-family);
				font-size: 12px;
				line-height: 1.2;
			}
			.select-control select:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
			.select-control select:disabled { opacity: 0.48; }
			.select-control-primary select { border-color: var(--vscode-focusBorder); }
			.select-control.is-running select { opacity: 0.78; }
			.select-control-compact { min-width: 0; flex: 1 1 145px; }
			.plan-dashboard { display: grid; grid-template-columns: minmax(0, 1fr) minmax(308px, 34vw); gap: 10px; align-items: stretch; }
			.live-card {
				display: grid;
				grid-template-columns: minmax(0, 1fr) auto;
				gap: 8px 14px;
				min-width: 0;
				border: 1px solid var(--vscode-panel-border);
				border-left: 3px solid var(--vscode-progressBar-background);
				border-radius: 7px;
				padding: 9px 11px;
				background: var(--vscode-sideBar-background, var(--vscode-editor-background));
			}
			.live-card-complete { border-left-color: var(--vscode-testing-iconPassed); }
			.live-card-active { border-left-color: var(--vscode-progressBar-background); }
			.live-card-top { min-width: 0; display: grid; gap: 2px; }
			.live-label { color: var(--vscode-descriptionForeground); font-size: 11px; text-transform: uppercase; }
			.live-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.live-percent { font-size: 20px; font-weight: 700; text-align: right; line-height: 1; }
			.live-progress { grid-column: 1 / -1; height: 6px; border-radius: 999px; overflow: hidden; background: var(--vscode-input-background); }
			.live-progress span { display: block; height: 100%; width: var(--progress); border-radius: inherit; background: var(--vscode-progressBar-background); transition: width 180ms ease; }
			.status-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; min-width: 0; }
			.status-card {
				border: 1px solid var(--vscode-panel-border); border-radius: 7px; padding: 7px 8px;
				background: var(--vscode-sideBar-background, var(--vscode-editor-background)); text-align: left;
			}
			.status-card strong { display: block; font-size: 15px; line-height: 1.1; }
			.status-card span { display: block; color: var(--vscode-descriptionForeground); font-size: 10px; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			button {
				border: 1px solid var(--vscode-button-border, transparent);
				border-radius: 4px; min-height: 28px; padding: 4px 9px; cursor: pointer;
				background: var(--vscode-button-secondaryBackground);
				color: var(--vscode-button-secondaryForeground);
				font-family: var(--vscode-font-family);
				font-size: 12px;
				line-height: 1.2;
				white-space: nowrap;
			}
			button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
			button.quiet { background: transparent; border-color: transparent; }
			button:disabled { cursor: default; opacity: 0.45; }
			button.is-running { opacity: 0.85; }
			button.icon { width: 28px; height: 28px; padding: 0; display: inline-grid; place-items: center; }
			main { display: grid; grid-template-columns: minmax(280px, 360px) minmax(0, 1fr); min-height: 0; }
			aside {
				border-right: 1px solid var(--vscode-panel-border);
				padding: 16px;
				background: var(--vscode-sideBar-background, var(--vscode-editor-background));
			}
			.meta {
				display: grid; gap: 7px; color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 14px;
				border: 1px solid var(--vscode-panel-border); border-radius: 7px; padding: 10px; background: var(--vscode-editor-background);
			}
			.meta strong { color: var(--vscode-editor-foreground); font-weight: 600; }
			.meta-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
			.meta-row span:last-child { color: var(--vscode-editor-foreground); font-family: var(--vscode-editor-font-family); }
			.meta-summary { color: var(--vscode-editor-foreground); font-family: var(--vscode-editor-font-family); }
			.todo-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
			.todo-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
			.todo-list li { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 9px; align-items: start; padding: 9px; border: 1px solid var(--vscode-panel-border); border-radius: 7px; background: var(--vscode-editor-background); }
			.todo-list li.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
			.status { width: 24px; height: 24px; min-height: 24px; padding: 0; display: inline-grid; place-items: center; border-radius: 999px; background: var(--vscode-input-background); border-color: var(--vscode-panel-border); }
			.status span { width: 9px; height: 9px; border-radius: 50%; background: var(--vscode-descriptionForeground); }
			.todo-content { min-width: 0; display: grid; gap: 4px; }
			.todo-kicker { display: flex; justify-content: space-between; gap: 8px; color: var(--vscode-descriptionForeground); font-size: 10px; text-transform: uppercase; }
			.todo-state { color: var(--vscode-editor-foreground); }
			.todo-input {
				width: 100%; box-sizing: border-box; border: 1px solid transparent; border-radius: 3px;
				padding: 3px 0; color: inherit; background: transparent; font-family: var(--vscode-font-family); font-weight: 600;
			}
			.todo-input:focus { border-color: var(--vscode-focusBorder); outline: none; background: var(--vscode-input-background); }
			.todo-completed { opacity: 0.7; }
		.todo-in_progress { border-color: var(--vscode-progressBar-background); background: var(--vscode-editor-inactiveSelectionBackground); }
		.todo-in_progress .status span { background: var(--vscode-progressBar-background); }
		.todo-completed .status span { background: var(--vscode-testing-iconPassed); }
		.todo-cancelled .status span { background: var(--vscode-testing-iconSkipped); }
		.dependency-row { display: flex; flex-wrap: wrap; gap: 4px; }
		.dependency-row span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; border: 1px solid var(--vscode-panel-border); border-radius: 3px; padding: 1px 4px; color: var(--vscode-descriptionForeground); font-size: 10px; }
		.todo-phase { grid-column: 2; color: var(--vscode-descriptionForeground); font-size: 11px; }
			.todo-empty { color: var(--vscode-descriptionForeground); }
			.content { min-width: 0; line-height: 1.55; padding: 16px 22px 32px; overflow: auto; }
			.plan-canvas { display: grid; align-content: start; gap: 14px; }
			.canvas-banner {
				display: flex; align-items: center; justify-content: space-between; gap: 10px;
				border-bottom: 1px solid var(--vscode-panel-border); padding: 0 0 10px;
				background: transparent;
			}
			.canvas-banner-title { font-weight: 600; font-size: 13px; }
			.canvas-banner-subtitle { color: var(--vscode-descriptionForeground); font-size: 12px; }
			.markdown-body { min-width: 0; max-width: 980px; }
			.markdown-body h1 { font-size: 24px; margin: 4px 0 12px; }
			.markdown-body h2 { margin-top: 24px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
			.markdown-body h3, .markdown-body h4 { margin-top: 18px; }
			.markdown-body code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 1px 3px; border-radius: 3px; }
		.markdown-body pre { overflow: auto; padding: 12px; border-radius: 4px; background: var(--vscode-textCodeBlock-background); }
		.raw-editor {
			width: 100%; min-height: 320px; resize: vertical; border: 1px solid var(--vscode-panel-border);
			border-radius: 4px; padding: 12px; color: var(--vscode-editor-foreground);
			background: var(--vscode-input-background); font-family: var(--vscode-editor-font-family);
			line-height: 1.45;
		}
		.raw-actions { display: none; gap: 8px; }
		.raw-mode .raw-actions { display: flex; }
		.raw-mode .markdown-body { display: none; }
		.raw-mode .raw-editor { display: block; }
		.plan-diagram {
			border: 1px solid var(--vscode-panel-border); border-radius: 6px; overflow: hidden;
			background: var(--vscode-editor-background); margin: 12px 0;
		}
			.diagram-header {
				display: flex; align-items: center; justify-content: space-between; gap: 10px;
				padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border);
				background: var(--vscode-sideBar-background, var(--vscode-editor-background));
			}
		.diagram-title { display: flex; align-items: center; gap: 7px; font-weight: 600; }
		.diagram-actions { display: flex; gap: 4px; }
		.diagram-actions .select-control { min-width: 126px; }
		.diagram-actions .select-control span { display: none; }
		.diagram-actions .select-control select { height: 26px; font-size: 11px; border-radius: 5px; }
		.mermaid-target { min-height: 80px; padding: 14px; overflow: auto; }
		.mermaid-target svg { max-width: 100%; height: auto; }
		.mermaid-loading, .mermaid-error { color: var(--vscode-descriptionForeground); font-size: 12px; padding: 12px; }
		.mermaid-error { color: var(--vscode-errorForeground); }
		.mermaid-source { margin: 0; border-top: 1px solid var(--vscode-panel-border); }
			@media (max-width: 1100px) {
				.title-row { grid-template-columns: 1fr; }
				.actions { justify-content: flex-start; flex-wrap: wrap; }
				.plan-dashboard { grid-template-columns: 1fr; }
			}
			@media (max-width: 760px) {
				main { grid-template-columns: 1fr; }
				aside { border-right: 0; border-bottom: 1px solid var(--vscode-panel-border); }
				.content { padding: 16px; }
			}
	</style>
</head>
<body>
	<script id="plan-source-json" type="application/json">${serializedPlanJson}</script>
	<div class="shell">
			<header class="plan-header">
				<div class="title-row">
					<div class="title-stack">
						<div class="eyebrow">Local executable plan</div>
						<h1>${escapeHtml(plan.metadata.name || "Codie Plan")}</h1>
						<div class="path">${escapeHtml(plan.planPath)}</div>
					</div>
					<div class="actions">
						<label class="select-control select-control-primary" data-build-action-control>
							<span>Build</span>
							<select data-action-select data-build-action-select aria-label="Build plan action">
								<option value="">Choose build action</option>
								<option value="buildLocal">Build Locally</option>
								<option value="buildParallel">Build in Parallel</option>
								<option value="buildSelectedLocal" data-selection-option disabled>Build Selected</option>
								<option value="buildSelectedParallel" data-selection-option disabled>Build Selected Parallel</option>
								<option value="buildNewAgent" data-selection-option disabled>Build Selected in New Agent</option>
							</select>
						</label>
						<label class="select-control">
							<span>Plan</span>
							<select data-action-select aria-label="Plan action">
								<option value="">Plan actions</option>
								<option value="toggleRaw" data-raw-toggle-option>Raw Markdown</option>
								<option value="copyPlan">Copy Plan</option>
								<option value="openRaw">Open Raw Markdown</option>
							</select>
						</label>
					</div>
				</div>
				<div class="plan-dashboard">
					<div class="live-card live-card-${escapeAttribute(plan.buildStatus)}" style="--progress:${progressPercent}%">
						<div class="live-card-top">
							<div class="live-label">${escapeHtml(liveStatus)}</div>
							<div class="live-title">${escapeHtml(activeTodo?.content || plan.metadata.overview || "Ready to build")}</div>
						</div>
						<div>
							<div class="live-percent">${progressPercent}%</div>
							<div class="live-label">complete</div>
						</div>
						<div class="live-progress" aria-label="Plan progress"><span></span></div>
					</div>
				<div class="status-grid">${statusSummaryHtml}</div>
			</div>
		</header>
		<main>
				<aside>
					<div class="meta">
						<div><strong>Executable plan todos</strong></div>
						<div class="meta-row"><span>Status</span><span>${escapeHtml(planStatusLabel)}</span></div>
						<div class="meta-row"><span>Build</span><span>${escapeHtml(buildStatusLabel)}</span></div>
						<div class="meta-row"><span>Diagrams</span><span>${escapeHtml(diagramLabel)}</span></div>
						<div class="meta-summary">Todos: ${completedTodoCount}/${todos.length}</div>
					</div>
				<div class="todo-toolbar">
					<label class="select-control select-control-compact">
						<span>Status</span>
						<select data-bulk-status-select aria-label="Set selected task status" disabled>
							<option value="">Set selected status</option>
							${statusOptions}
						</select>
					</label>
					<label class="select-control select-control-compact">
						<span>Selection</span>
						<select data-selection-action-select aria-label="Selected task action" disabled>
							<option value="">Selected task actions</option>
							<option value="buildSelectedLocal">Build Selected</option>
							<option value="buildSelectedParallel">Build Selected Parallel</option>
							<option value="buildNewAgent">Build Selected in New Agent</option>
							<option value="deleteSelected">Delete Selected</option>
						</select>
					</label>
				</div>
				<ul class="todo-list">${todoHtml}</ul>
			</aside>
			<section class="content plan-canvas" data-rendered-plan-canvas>
				<div class="canvas-banner">
					<div>
						<div class="canvas-banner-title">Rendered local plan canvas</div>
						<div class="canvas-banner-subtitle">Todos, Mermaid diagrams, and Build actions are backed by ${escapeHtml(path.basename(plan.planPath))}.</div>
					</div>
					<div class="raw-actions">
						<button data-command="saveRaw">Save Markdown</button>
					</div>
				</div>
				<div class="markdown-body" data-rendered-markdown>${renderPlanMarkdown(plan.body)}</div>
				<textarea class="raw-editor" data-raw-body hidden>${escapeHtml(plan.body)}</textarea>
			</section>
		</main>
	</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const selectedIds = new Set();
		let lastSelectedId;
		const planSource = JSON.parse(document.getElementById('plan-source-json')?.textContent || '""');

		const rows = () => Array.from(document.querySelectorAll('[data-todo-row]'));
		const selectedPayload = () => Array.from(selectedIds);
		const post = (command, extra = {}) => vscode.postMessage({ command, ...extra });
		let buildStarting = false;
		const updateBulkState = () => {
			const hasSelection = selectedIds.size > 0;
			document.querySelectorAll('[data-bulk-status-select], [data-selection-action-select]').forEach((control) => {
				control.disabled = buildStarting || !hasSelection;
			});
			document.querySelectorAll('[data-selection-option]').forEach((option) => {
				option.disabled = buildStarting || !hasSelection;
			});
			document.querySelectorAll('[data-build-action-select]').forEach((control) => {
				control.disabled = buildStarting;
			});
		};
		const setBuildStarting = () => {
			buildStarting = true;
			document.querySelectorAll('[data-build-action-control]').forEach((control) => control.classList.add('is-running'));
			updateBulkState();
		};
		const setRawMode = () => {
			const canvas = document.querySelector('[data-rendered-plan-canvas]');
			const raw = document.querySelector('[data-raw-body]');
			const isRaw = canvas?.classList.toggle('raw-mode');
			if (raw) {
				raw.hidden = !isRaw;
			}
			document.querySelectorAll('[data-raw-toggle-option]').forEach((option) => {
				option.textContent = isRaw ? 'Rendered Canvas' : 'Raw Markdown';
			});
		};
		const runCommand = (command) => {
			if (!command) {
				return;
			}
			if (command === 'deleteSelected') {
				post('deleteTodos', { todoIds: selectedPayload() });
				return;
			}
			if (command === 'copyPlan') {
				navigator.clipboard.writeText(planSource);
				return;
			}
			if (command === 'toggleRaw') {
				setRawMode();
				return;
			}
			if (command === 'saveRaw') {
				const raw = document.querySelector('[data-raw-body]');
				post('saveRaw', { body: raw?.value || '' });
				return;
			}
			if (command === 'buildSelectedLocal') {
				if (!selectedIds.size) {
					return;
				}
				setBuildStarting();
				post('buildLocal', { todoIds: selectedPayload() });
				return;
			}
			if (command === 'buildSelectedParallel') {
				if (!selectedIds.size) {
					return;
				}
				setBuildStarting();
				post('buildParallel', { todoIds: selectedPayload() });
				return;
			}
			if (command === 'buildNewAgent') {
				if (!selectedIds.size) {
					return;
				}
				setBuildStarting();
				post('buildNewAgent', { todoIds: selectedPayload() });
				return;
			}
			if (command === 'buildLocal' || command === 'buildParallel') {
				setBuildStarting();
			}
			post(command);
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

		document.querySelectorAll('[data-action-select], [data-selection-action-select]').forEach((select) => {
			select.addEventListener('change', () => {
				const command = select.value;
				select.value = '';
				runCommand(command);
			});
		});
		document.querySelectorAll('[data-command]').forEach((button) => {
			button.addEventListener('click', () => runCommand(button.dataset.command));
		});
		document.querySelectorAll('[data-bulk-status-select]').forEach((select) => {
			select.addEventListener('change', () => {
				const status = select.value;
				select.value = '';
				if (status) {
					post('setTodosStatus', { todoIds: selectedPayload(), status });
				}
			});
		});
		updateBulkState();
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
			<script nonce="${nonce}" src="${mermaidScriptUri}"></script>
			<script nonce="${nonce}">
				const mermaid = globalThis.mermaid;
				const normalizeMermaidForRender = (source) => {
					if (!/^\\s*(flowchart|graph)\\b/im.test(source)) {
						return source;
					}
				return source.replace(/\\b([A-Za-z][\\w-]*)\\[([^\\]\\n]+)\\]/g, (match, nodeId, label) => {
					const trimmed = label.trim();
					if (!trimmed || trimmed.startsWith('"') || trimmed.startsWith("'") || trimmed.startsWith(String.fromCharCode(96)) || !/[\\s.()/,:+]/.test(trimmed)) {
						return match;
					}
					return nodeId + "[" + JSON.stringify(trimmed) + "]";
				});
			};

			const hashMermaidCode = (value) => {
				let hash = 2166136261;
				for (let index = 0; index < value.length; index++) {
					hash ^= value.charCodeAt(index);
					hash = Math.imul(hash, 16777619);
				}
				return (hash >>> 0).toString(36);
			};

			if (mermaid) {
				mermaid.initialize({
					startOnLoad: false,
					securityLevel: "strict",
					theme: "base",
					themeVariables: {
						background: "transparent",
						fontFamily: "var(--vscode-font-family)",
						primaryColor: "var(--vscode-editor-background)",
						primaryTextColor: "var(--vscode-editor-foreground)",
						primaryBorderColor: "var(--vscode-focusBorder)",
						lineColor: "var(--vscode-descriptionForeground)",
						textColor: "var(--vscode-editor-foreground)",
						mainBkg: "var(--vscode-editor-background)",
						nodeBorder: "var(--vscode-focusBorder)"
					}
				});

				for (const card of document.querySelectorAll('[data-mermaid-card]')) {
					const source = card.querySelector('[data-mermaid-source]')?.textContent || '';
					const target = card.querySelector('[data-mermaid-target]');
					const normalized = normalizeMermaidForRender(source);
					if (!target || normalized.trim().length < 4) {
						continue;
					}
					const fallbackHtml = target.innerHTML;
					mermaid.parse(normalized, { suppressErrors: true })
						.then((valid) => {
							if (!valid) {
								throw new Error('Invalid or incomplete Mermaid code');
							}
							return mermaid.render('codevibe-plan-mermaid-' + hashMermaidCode(normalized), normalized);
						})
						.then(({ svg }) => {
							target.innerHTML = svg;
						})
						.catch((error) => {
							console.warn('Plan Mermaid render failed:', error);
							target.innerHTML = fallbackHtml || '<div class="mermaid-error">Unable to render diagram.</div>';
						});
				}
			}

			document.querySelectorAll('[data-mermaid-action-select]').forEach((select) => {
				select.addEventListener('change', () => {
					const action = select.value;
					select.value = '';
					const source = select.closest('[data-mermaid-card]')?.querySelector('[data-mermaid-source]');
					if (action === 'copy') {
						navigator.clipboard.writeText(source?.textContent || '');
						return;
					}
					if (action === 'toggleSource') {
						if (source) {
							source.hidden = !source.hidden;
							const toggleOption = select.querySelector('[value="toggleSource"]');
							if (toggleOption) {
								toggleOption.textContent = source.hidden ? 'Show Source' : 'Hide Source';
							}
						}
					}
				});
			});
		</script>
</body>
</html>`;
	}
}

function renderPlanMarkdown(markdown: string): string {
	const blocks: string[] = [];
	let cursor = 0;
	const fencePattern = /```(\w+)?\n([\s\S]*?)```/g;
	let match: RegExpExecArray | null;
	while ((match = fencePattern.exec(markdown))) {
		blocks.push(renderMarkdownText(markdown.slice(cursor, match.index)));
		const language = (match[1] || "").toLowerCase();
		const code = match[2] || "";
		if (language === "mermaid") {
			blocks.push(renderMermaidBlock(code));
		} else {
			blocks.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
		}
		cursor = match.index + match[0].length;
	}
	blocks.push(renderMarkdownText(markdown.slice(cursor)));
	return blocks.join("");
}

function renderMarkdownText(markdown: string): string {
	const lines = markdown.split(/\r?\n/);
	const html: string[] = [];
	let inList = false;
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) {
			if (inList) {
				html.push("</ul>");
				inList = false;
			}
			continue;
		}
		const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
		if (heading) {
			if (inList) {
				html.push("</ul>");
				inList = false;
			}
			const level = Math.min(heading[1].length + 1, 4);
			html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
			continue;
		}
		const bullet = trimmed.match(/^[-*]\s+(?:\[[ xX]\]\s*)?(.+)$/);
		if (bullet) {
			if (!inList) {
				html.push("<ul>");
				inList = true;
			}
			html.push(`<li>${renderInlineMarkdown(bullet[1])}</li>`);
			continue;
		}
		if (inList) {
			html.push("</ul>");
			inList = false;
		}
		html.push(`<p>${renderInlineMarkdown(trimmed)}</p>`);
	}
	if (inList) {
		html.push("</ul>");
	}
	return html.join("\n");
}

function renderInlineMarkdown(value: string): string {
	return escapeHtml(value)
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/`([^`]+)`/g, "<code>$1</code>");
}

function renderMermaidBlock(source: string): string {
	return `<section class="plan-diagram" data-mermaid-card>
		<div class="diagram-header">
			<div class="diagram-title"><span class="codicon codicon-type-hierarchy-sub"></span><span>Plan diagram</span></div>
			<div class="diagram-actions">
				<label class="select-control">
					<span>Diagram</span>
					<select data-mermaid-action-select aria-label="Diagram action">
						<option value="">Diagram actions</option>
						<option value="copy">Copy Source</option>
						<option value="toggleSource">Show Source</option>
					</select>
				</label>
			</div>
		</div>
			<div class="mermaid-target" data-mermaid-target>${renderMermaidFallbackSvg(source)}</div>
			<pre class="mermaid-source" data-mermaid-source hidden>${escapeHtml(source)}</pre>
		</section>`;
}

function renderMermaidFallbackSvg(source: string): string {
	if (!/^\s*(flowchart|graph)\b/im.test(source)) {
		return `<pre><code>${escapeHtml(source)}</code></pre>`;
	}
	const nodes = new Map<string, string>();
	const edges: Array<{ from: string; to: string }> = [];
	for (const rawLine of source.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || /^(flowchart|graph)\b/i.test(line)) {
			continue;
		}
		const arrowIndex = line.indexOf("-->");
		if (arrowIndex < 0) {
			continue;
		}
		const from = parseMermaidNodeRef(line.slice(0, arrowIndex));
		const to = parseMermaidNodeRef(line.slice(arrowIndex + 3));
		if (!from || !to) {
			continue;
		}
		if (!nodes.has(from.id)) {
			nodes.set(from.id, from.label);
		}
		if (!nodes.has(to.id)) {
			nodes.set(to.id, to.label);
		}
		edges.push({ from: from.id, to: to.id });
	}
	if (!nodes.size) {
		return `<pre><code>${escapeHtml(source)}</code></pre>`;
	}
	const nodeIds = Array.from(nodes.keys());
	const nodeIndex = new Map(nodeIds.map((id, index) => [id, index]));
	const width = 760;
	const nodeWidth = 300;
	const nodeHeight = 46;
	const rowHeight = 82;
	const nodeX = 230;
	const topPad = 20;
	const height = topPad * 2 + nodeIds.length * rowHeight;
	const markerId = `codevibe-plan-arrow-${hashString(source)}`;
	const edgeSvg = edges
		.map(({ from, to }) => {
			const fromIndex = nodeIndex.get(from);
			const toIndex = nodeIndex.get(to);
			if (fromIndex == null || toIndex == null) {
				return "";
			}
			const startX = nodeX + nodeWidth / 2;
			const startY = topPad + fromIndex * rowHeight + nodeHeight;
			const endX = nodeX + nodeWidth / 2;
			const endY = topPad + toIndex * rowHeight;
			return `<path d="M ${startX} ${startY + 3} C ${startX} ${startY + 24}, ${endX} ${endY - 24}, ${endX} ${endY - 3}" fill="none" stroke="var(--vscode-descriptionForeground)" stroke-width="1.6" marker-end="url(#${markerId})" opacity="0.86" />`;
		})
		.join("");
	const nodeSvg = nodeIds
		.map((id, index) => {
			const label = nodes.get(id) || id;
			const y = topPad + index * rowHeight;
			const lines = wrapSvgLabel(label);
			const textY = y + nodeHeight / 2 - (lines.length - 1) * 8;
			return `<g>
				<rect x="${nodeX}" y="${y}" width="${nodeWidth}" height="${nodeHeight}" rx="6" fill="var(--vscode-editor-background)" stroke="var(--vscode-focusBorder)" stroke-width="1.4" />
				${lines.map((line, lineIndex) => `<text x="${nodeX + nodeWidth / 2}" y="${textY + lineIndex * 16}" text-anchor="middle" dominant-baseline="middle" fill="var(--vscode-editor-foreground)" font-family="var(--vscode-font-family)" font-size="12">${escapeHtml(line)}</text>`).join("")}
			</g>`;
		})
		.join("");
	return `<svg class="mermaid-fallback-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Rendered Mermaid flowchart fallback" xmlns="http://www.w3.org/2000/svg">
		<defs>
			<marker id="${markerId}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
				<path d="M 0 0 L 8 4 L 0 8 z" fill="var(--vscode-descriptionForeground)" />
			</marker>
		</defs>
		${edgeSvg}
		${nodeSvg}
	</svg>`;
}

function parseMermaidNodeRef(
	value: string,
): { id: string; label: string } | undefined {
	const match = value
		.trim()
		.match(/^([A-Za-z][\w-]*)(?:\[(?:"([^"]+)"|'([^']+)'|([^\]]+))\])?/);
	if (!match) {
		return undefined;
	}
	const id = match[1];
	return { id, label: (match[2] || match[3] || match[4] || id).trim() };
}

function wrapSvgLabel(label: string): string[] {
	const words = label.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word;
		if (candidate.length > 30 && current) {
			lines.push(current);
			current = word;
			continue;
		}
		current = candidate;
	}
	if (current) {
		lines.push(current);
	}
	return (lines.length ? lines : [label]).slice(0, 3);
}

function hashString(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

function getNonce(): string {
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	return Array.from(
		{ length: 32 },
		() => alphabet[Math.floor(Math.random() * alphabet.length)],
	).join("");
}

function sanitizeTodoIds(todoIds: unknown): string[] {
	return Array.isArray(todoIds) ? todoIds.map(String).filter(Boolean) : [];
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
	return escapeHtml(value).replace(/\s+/g, "-");
}

function escapeScriptJson(value: string): string {
	return JSON.stringify(value)
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e")
		.replace(/&/g, "\\u0026");
}
