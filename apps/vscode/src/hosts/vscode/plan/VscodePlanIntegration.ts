import { getPlanStorageService, type PlanRegistryRecord } from "@core/plan/PlanStorageService"
import { buildLocalPlanExecutionMessage, type PlanBuildMode } from "@shared/plan-build"
import { getWorkspacePath } from "@utils/path"
import * as path from "node:path"
import * as vscode from "vscode"
import type { Controller } from "@/core/controller"
import { ExtensionRegistryInfo } from "@/registry"
import { Logger } from "@/shared/services/Logger"

const PLAN_VIEW_ID = `${ExtensionRegistryInfo.views.AgentContainer}-plans`

type PlanCommandTarget = PlanTreeItem | vscode.Uri | string | undefined

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
	const document = await vscode.workspace.openTextDocument(vscode.Uri.file(planPath))
	await vscode.window.showTextDocument(document, {
		preview: false,
		viewColumn: vscode.ViewColumn.Active,
	})
}

async function buildPlanFromNativeCommand(
	controller: Controller | undefined,
	planPath: string | undefined,
	requestedMode: Exclude<PlanBuildMode, "project">,
	provider: VscodePlanTreeProvider,
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
