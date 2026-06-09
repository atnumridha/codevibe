// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below

import assert from "node:assert"
import { DIFF_VIEW_URI_SCHEME } from "@hosts/vscode/VscodeDiffViewProvider"
import * as vscode from "vscode"
import { Logger } from "@/shared/services/Logger"
import { sendAccountButtonClickedEvent } from "./core/controller/ui/subscribeToAccountButtonClicked"
import { sendChatButtonClickedEvent } from "./core/controller/ui/subscribeToChatButtonClicked"
import { sendHistoryButtonClickedEvent } from "./core/controller/ui/subscribeToHistoryButtonClicked"
import { sendMcpButtonClickedEvent } from "./core/controller/ui/subscribeToMcpButtonClicked"
import { sendSettingsButtonClickedEvent } from "./core/controller/ui/subscribeToSettingsButtonClicked"
import { sendWorktreesButtonClickedEvent } from "./core/controller/ui/subscribeToWorktreesButtonClicked"
import { WebviewProvider } from "./core/webview"
import { createCodeVibeAPI } from "./exports"
import { initializeTestMode } from "./services/test/TestMode"
import "./utils/path" // necessary to have access to String.prototype.toPosix
import path from "node:path"
import type { ExtensionContext } from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { vscodeHostBridgeClient } from "@/hosts/vscode/hostbridge/client/host-grpc-client"
import { createStorageContext } from "@/shared/storage/storage-context"
import { getCodeVibeConfigurationValue } from "@/utils/codevibe-config"
import { readTextFromClipboard, writeTextToClipboard } from "@/utils/env"
import { initialize, tearDown } from "./common"
import { addToCline } from "./core/controller/commands/addToCline"
import { explainWithCline } from "./core/controller/commands/explainWithCline"
import { fixWithCodeVibe } from "./core/controller/commands/fixWithCline"
import { improveWithCline } from "./core/controller/commands/improveWithCline"
import { sendAddToInputEvent } from "./core/controller/ui/subscribeToAddToInput"
import { sendShowWebviewEvent } from "./core/controller/ui/subscribeToShowWebview"
import { HookDiscoveryCache } from "./core/hooks/HookDiscoveryCache"
import {
	cleanupMcpMarketplaceCatalogFromGlobalState,
	cleanupOldApiKey,
	migrateCustomInstructionsToGlobalRules,
	migrateTaskHistoryToFile,
	migrateWelcomeViewCompleted,
	migrateWorkspaceToGlobalStorage,
} from "./core/storage/state-migrations"
import { workspaceResolver } from "./core/workspace"
import { findMatchingNotebookCell, getContextForCommand, showWebview } from "./hosts/vscode/commandUtils"
import { abortCommitGeneration, generateCommitMsg } from "./hosts/vscode/commit-message-generator"
import { registerClineOutputChannel } from "./hosts/vscode/hostbridge/env/debugLog"
import {
	disposeVscodeCommentReviewController,
	getVscodeCommentReviewController,
} from "./hosts/vscode/review/VscodeCommentReviewController"
import { VscodeTerminalManager } from "./hosts/vscode/terminal/VscodeTerminalManager"
import { VscodeDiffViewProvider } from "./hosts/vscode/VscodeDiffViewProvider"
import { VscodeWebviewProvider } from "./hosts/vscode/VscodeWebviewProvider"
import { exportVSCodeStorageToSharedFiles } from "./hosts/vscode/vscode-to-file-migration"
import { ExtensionRegistryInfo } from "./registry"
import { AuthService } from "./services/auth/AuthService"
import { LogoutReason } from "./services/auth/types"
import { CursorNdjsonIngestServer, type CursorNdjsonIngestServerStatus } from "./services/automation/CursorNdjsonIngestServer"
import { telemetryService } from "./services/telemetry"
import { getCursorCompatibleUriPath, isCursorCompatibleUriPath } from "./services/uri/CursorUriRoutes"
import { getRawExtensionUriString } from "./services/uri/ExtensionUriString"
import { LG_TASK_URI_PATH, SharedUriHandler, TASK_URI_PATH } from "./services/uri/SharedUriHandler"
import { redactUriForLogging } from "./services/uri/UriRedaction"
import { ShowMessageType } from "./shared/proto/host/window"
import { fileExistsAtPath } from "./utils/fs"

const OPENAI_CODEX_EXTENSION_ID = "openai.chatgpt"
const OPENAI_CODEX_OPEN_SIDEBAR_COMMAND = "chatgpt.openSidebar"
const CODEVIBE_CHAT_PARTICIPANT_ID = "codevibe.agent"
const LEGACY_CODEVIBE_PANEL_VIEW_TYPE = "codevibe.agentPanel"

// This method is called when the VS Code extension is activated.
// NOTE: This is VS Code specific - services that should be registered
// for all-platform should be registered in common.ts.
export async function activate(context: vscode.ExtensionContext) {
	const activationStartTime = performance.now()

	// 1. Set up HostProvider for VSCode
	// IMPORTANT: This must be done before any service can be registered
	setupHostProvider(context)

	// 2. Clean up legacy data patterns within VSCode's native storage.
	// Moves workspace→global keys, task history→file, custom instructions→rules, etc.
	// Must run BEFORE the file export so we copy clean state.
	await cleanupLegacyVSCodeStorage(context)

	// 3. One-time export of VSCode's native storage to shared file-backed stores.
	// After this, all platforms (VSCode, CLI, JetBrains) read from ~/.cline/data/.
	const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
	const storageContext = createStorageContext({ workspacePath })
	await exportVSCodeStorageToSharedFiles(context, storageContext)

	// 4. Register services and perform common initialization
	// IMPORTANT: Must be done after host provider is setup and migrations are complete
	const webview = (await initialize(storageContext)) as VscodeWebviewProvider
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(VscodeWebviewProvider.SIDEBAR_ID, webview, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	)
	registerCodeVibeChatParticipant(context)
	await closeLegacyCodeVibePanels()
	scheduleLegacyCodeVibePanelCleanup(context)

	// 5. Register services and commands specific to VS Code
	// Initialize test mode and add disposables to context
	const testModeWatchers = await initializeTestMode(webview)
	context.subscriptions.push(...testModeWatchers)

	// Initialize hook discovery cache for performance optimization
	HookDiscoveryCache.getInstance().initialize(
		context as any, // Adapt VSCode ExtensionContext to generic interface
		(dir: string) => {
			try {
				const pattern = new vscode.RelativePattern(dir, "*")
				const watcher = vscode.workspace.createFileSystemWatcher(pattern)
				// Ensure watcher is disposed when extension is deactivated
				context.subscriptions.push(watcher)
				// Adapt VSCode FileSystemWatcher to generic interface
				return {
					onDidCreate: (listener: () => void) => watcher.onDidCreate(listener),
					onDidChange: (listener: () => void) => watcher.onDidChange(listener),
					onDidDelete: (listener: () => void) => watcher.onDidDelete(listener),
					dispose: () => watcher.dispose(),
				}
			} catch {
				return null
			}
		},
		(callback: () => void) => {
			// Adapt VSCode Disposable to generic interface
			const disposable = vscode.workspace.onDidChangeWorkspaceFolders(callback)
			context.subscriptions.push(disposable)
			return disposable
		},
	)

	// NOTE: Commands must be added to the internal registry before registering them with VSCode
	const { commands } = ExtensionRegistryInfo
	const cursorNdjsonIngestServer = new CursorNdjsonIngestServer(context.globalStorageUri.fsPath)
	context.subscriptions.push(cursorNdjsonIngestServer)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.PlusButton, async () => {
			const webview = await showPreferredCodeVibeSurface(false)
			await webview.controller.clearTask()
			await webview.controller.postStateToWebview()
			await sendChatButtonClickedEvent()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.McpButton, async () => {
			await showPreferredCodeVibeSurface(false)
			await sendMcpButtonClickedEvent()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.SettingsButton, async () => {
			await showPreferredCodeVibeSurface(false)
			await sendSettingsButtonClickedEvent()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.HistoryButton, async () => {
			await showPreferredCodeVibeSurface(false)
			await sendHistoryButtonClickedEvent()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.AccountButton, async () => {
			await showPreferredCodeVibeSurface(false)
			await sendAccountButtonClickedEvent()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.WorktreesButton, async () => {
			await showPreferredCodeVibeSurface(false)
			await sendWorktreesButtonClickedEvent()
		}),
	)

	/*
	We use the text document content provider API to show the left side for diff view by creating a
	virtual document for the original content. This makes it readonly so users know to edit the right
	side if they want to keep their changes.

	- This API allows you to create readonly documents in VSCode from arbitrary sources, and works by
	claiming an uri-scheme for which your provider then returns text contents. The scheme must be
	provided when registering a provider and cannot change afterwards.
	- Note how the provider doesn't create uris for virtual documents - its role is to provide contents
	 given such an uri. In return, content providers are wired into the open document logic so that
	 providers are always considered.
	https://code.visualstudio.com/api/extension-guides/virtual-documents
	*/
	const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
		provideTextDocumentContent(uri: vscode.Uri): string {
			return Buffer.from(uri.query, "base64").toString("utf-8")
		}
	})()
	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(DIFF_VIEW_URI_SCHEME, diffContentProvider))

	const handleUri = async (uri: vscode.Uri) => {
		const url = getRawExtensionUriString(uri)
		const uriPath = getUriPath(url)
		const isTaskUri = uriPath === TASK_URI_PATH || uriPath === LG_TASK_URI_PATH
		const isMcpAuthCallbackUri = /^\/mcp-auth\/callback\/[^/]+$/.test(uriPath ?? "")
		const cursorDeepLinksEnabled = getCodeVibeConfigurationValue<boolean>("cursorCompatibility.deepLinks.enabled", true)
		const isCursorCompatibleUri = cursorDeepLinksEnabled && uriPath ? isCursorCompatibleUriPath(uriPath) : false

		if (isTaskUri || isCursorCompatibleUri || isMcpAuthCallbackUri) {
			await openCodeVibeSurfaceForTaskUri()
		}

		let success = await SharedUriHandler.handleUri(url, {
			cursorCompatibleDeepLinksEnabled: cursorDeepLinksEnabled,
		})

		// Task deeplinks can race with first-time sidebar initialization.
		if (!success && (isTaskUri || isCursorCompatibleUri || isMcpAuthCallbackUri)) {
			await openCodeVibeSurfaceForTaskUri()
			success = await SharedUriHandler.handleUri(url, {
				cursorCompatibleDeepLinksEnabled: cursorDeepLinksEnabled,
			})
		}

		if (!success) {
			Logger.warn("Extension URI handler: Failed to process URI:", redactUriForLogging(uri.toString()))
		}
	}
	context.subscriptions.push(vscode.window.registerUriHandler({ handleUri }))

	const startCursorNdjsonIngestServer = async (forceAutoPort = false) => {
		const settings = getCursorNdjsonIngestSettings(forceAutoPort)
		if (!(await confirmCursorNdjsonBindAddress(settings.bindAddress))) {
			return undefined
		}
		const status = forceAutoPort
			? await cursorNdjsonIngestServer.reassignPort(settings)
			: await cursorNdjsonIngestServer.start(settings)
		await showCursorNdjsonStatus(
			status,
			forceAutoPort ? "Cursor NDJSON ingest server reassigned" : "Cursor NDJSON ingest server started",
		)
		return status
	}

	context.subscriptions.push(
		vscode.commands.registerCommand("cursor.ndjsonIngest.start", async () => {
			await startCursorNdjsonIngestServer(false)
		}),
		vscode.commands.registerCommand("cursor.ndjsonIngest.stop", async () => {
			const status = await cursorNdjsonIngestServer.stop()
			await showCursorNdjsonStatus(status, "Cursor NDJSON ingest server stopped")
		}),
		vscode.commands.registerCommand("cursor.ndjsonIngest.reassignPort", async () => {
			await startCursorNdjsonIngestServer(true)
		}),
		vscode.commands.registerCommand("cursor.ndjsonIngest.showStatus", async () => {
			await showCursorNdjsonStatus(cursorNdjsonIngestServer.getStatus(), "Cursor NDJSON ingest server status")
		}),
		vscode.commands.registerCommand("cursor.ndjsonIngest.copyCurl", async () => {
			let status = cursorNdjsonIngestServer.getStatus()
			if (!status.running) {
				status = (await startCursorNdjsonIngestServer(false)) ?? status
			}
			if (!status.running) {
				return
			}
			const command = cursorNdjsonIngestServer.buildCurlCommand()
			await vscode.env.clipboard.writeText(command)
			await vscode.window.showInformationMessage("Copied Cursor NDJSON ingest curl command.")
		}),
		vscode.commands.registerCommand("cursor-deeplink.debug.triggerDeeplink", async () => {
			const uri = await vscode.window.showInputBox({
				placeHolder: "cursor://createchat?prompt=Review%20this",
				prompt: "Enter a Cursor-compatible deeplink to route through CodeVibe.",
				ignoreFocusOut: true,
			})
			if (!uri?.trim()) {
				return
			}
			const success = await SharedUriHandler.handleUri(uri.trim(), {
				cursorCompatibleDeepLinksEnabled: getCodeVibeConfigurationValue<boolean>(
					"cursorCompatibility.deepLinks.enabled",
					true,
				),
			})
			if (!success) {
				await vscode.window.showWarningMessage("CodeVibe could not process that deeplink.")
			}
		}),
	)

	// Register size testing commands in development mode
	if (IS_DEV) {
		vscode.commands.executeCommand("setContext", "codevibe.isDevMode", IS_DEV)
		// Use dynamic import to avoid loading the module in production
		import("./dev/commands/tasks")
			.then((module) => {
				const devTaskCommands = module.registerTaskCommands(webview.controller)
				context.subscriptions.push(...devTaskCommands)
				Logger.log("[CodeVibe Dev] Dev mode activated & dev commands registered")
			})
			.catch((error) => {
				Logger.log("[CodeVibe Dev] Failed to register dev commands: " + error)
			})
	}

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.TerminalOutput, async () => {
			const terminal = vscode.window.activeTerminal
			if (!terminal) {
				return
			}

			// Save current clipboard content
			const tempCopyBuffer = await readTextFromClipboard()

			try {
				// Copy the *existing* terminal selection (without selecting all)
				await vscode.commands.executeCommand("workbench.action.terminal.copySelection")

				// Get copied content
				const terminalContents = (await readTextFromClipboard()).trim()

				// Restore original clipboard content
				await writeTextToClipboard(tempCopyBuffer)

				if (!terminalContents) {
					// No terminal content was copied (either nothing selected or some error)
					return
				}
				// Ensure the sidebar view is visible but preserve editor focus
				await showWebview(true)

				await sendAddToInputEvent(`Terminal output:\n\`\`\`\n${terminalContents}\n\`\`\``)

				Logger.log("addSelectedTerminalOutputToChat", terminalContents, terminal.name)
			} catch (error) {
				// Ensure clipboard is restored even if an error occurs
				await writeTextToClipboard(tempCopyBuffer)
				Logger.error("Error getting terminal contents:", error)
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: "Failed to get terminal contents",
				})
			}
		}),
	)

	// Register code action provider
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			"*",
			new (class implements vscode.CodeActionProvider {
				public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.Refactor]

				provideCodeActions(
					document: vscode.TextDocument,
					range: vscode.Range,
					context: vscode.CodeActionContext,
				): vscode.CodeAction[] {
					const CONTEXT_LINES_TO_EXPAND = 3
					const START_OF_LINE_CHAR_INDEX = 0
					const LINE_COUNT_ADJUSTMENT_FOR_ZERO_INDEXING = 1

					const actions: vscode.CodeAction[] = []
					const editor = vscode.window.activeTextEditor // Get active editor for selection check

					// Expand range to include surrounding 3 lines or use selection if broader
					const selection = editor?.selection
					let expandedRange = range
					if (
						editor &&
						selection &&
						!selection.isEmpty &&
						selection.contains(range.start) &&
						selection.contains(range.end)
					) {
						expandedRange = selection
					} else {
						expandedRange = new vscode.Range(
							Math.max(0, range.start.line - CONTEXT_LINES_TO_EXPAND),
							START_OF_LINE_CHAR_INDEX,
							Math.min(
								document.lineCount - LINE_COUNT_ADJUSTMENT_FOR_ZERO_INDEXING,
								range.end.line + CONTEXT_LINES_TO_EXPAND,
							),
							document.lineAt(
								Math.min(
									document.lineCount - LINE_COUNT_ADJUSTMENT_FOR_ZERO_INDEXING,
									range.end.line + CONTEXT_LINES_TO_EXPAND,
								),
							).text.length,
						)
					}

					// Add to CodeVibe (Always available)
					const addAction = new vscode.CodeAction("Add to CodeVibe", vscode.CodeActionKind.QuickFix)
					addAction.command = {
						command: commands.AddToChat,
						title: "Add to CodeVibe",
						arguments: [expandedRange, context.diagnostics],
					}
					actions.push(addAction)

					// Explain with CodeVibe (Always available)
					const explainAction = new vscode.CodeAction("Explain with CodeVibe", vscode.CodeActionKind.RefactorExtract) // Using a refactor kind
					explainAction.command = {
						command: commands.ExplainCode,
						title: "Explain with CodeVibe",
						arguments: [expandedRange],
					}
					actions.push(explainAction)

					// Improve with CodeVibe (Always available)
					const improveAction = new vscode.CodeAction("Improve with CodeVibe", vscode.CodeActionKind.RefactorRewrite) // Using a refactor kind
					improveAction.command = {
						command: commands.ImproveCode,
						title: "Improve with CodeVibe",
						arguments: [expandedRange],
					}
					actions.push(improveAction)

					// Fix with CodeVibe (Only if diagnostics exist)
					if (context.diagnostics.length > 0) {
						const fixAction = new vscode.CodeAction("Fix with CodeVibe", vscode.CodeActionKind.QuickFix)
						fixAction.isPreferred = true
						fixAction.command = {
							command: commands.FixWithCodeVibe,
							title: "Fix with CodeVibe",
							arguments: [expandedRange, context.diagnostics],
						}
						actions.push(fixAction)
					}
					return actions
				}
			})(),
			{
				providedCodeActionKinds: [
					vscode.CodeActionKind.QuickFix,
					vscode.CodeActionKind.RefactorExtract,
					vscode.CodeActionKind.RefactorRewrite,
				],
			},
		),
	)

	// Register the command handlers
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.AddToChat, async (range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) => {
			const context = await getContextForCommand(range, diagnostics)
			if (!context) {
				return
			}
			await addToCline(context.controller, context.commandContext)
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.FixWithCodeVibe,
			async (range: vscode.Range, diagnostics: vscode.Diagnostic[]) => {
				const context = await getContextForCommand(range, diagnostics)
				if (!context) {
					return
				}
				await fixWithCodeVibe(context.controller, context.commandContext)
			},
		),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.LegacyFixWithCline,
			async (range: vscode.Range, diagnostics: vscode.Diagnostic[]) => {
				const context = await getContextForCommand(range, diagnostics)
				if (!context) {
					return
				}
				await fixWithCodeVibe(context.controller, context.commandContext)
			},
		),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.ExplainCode, async (range: vscode.Range) => {
			const context = await getContextForCommand(range)
			if (!context) {
				return
			}
			await explainWithCline(context.controller, context.commandContext)
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.ImproveCode, async (range: vscode.Range) => {
			const context = await getContextForCommand(range)
			if (!context) {
				return
			}
			await improveWithCline(context.controller, context.commandContext)
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.FocusChatInput, async (preserveEditorFocus = false) => {
			const webview = await showPreferredCodeVibeSurface(preserveEditorFocus)
			await sendShowWebviewEvent(preserveEditorFocus)
			telemetryService.captureButtonClick("command_focusChatInput", webview.controller?.task?.ulid)
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.OpenLegacyWebview, async (preserveEditorFocus = false) => {
			const webview = await showCodeVibeSurface(preserveEditorFocus)

			// Send show webview event with preserveEditorFocus flag
			sendShowWebviewEvent(preserveEditorFocus)
			telemetryService.captureButtonClick("command_openLegacyWebview", webview.controller?.task?.ulid)
		}),
	)

	// Register Jupyter Notebook command handlers
	const NOTEBOOK_EDIT_INSTRUCTIONS = `Special considerations for using replace_in_file on *.ipynb files:
* Jupyter notebook files are JSON format with specific structure for source code cells
* Source code in cells is stored as JSON string arrays ending with explicit \\n characters and commas
* Always match the exact JSON format including quotes, commas, and escaped newlines.`

	// Helper to get notebook context for Jupyter commands
	async function getNotebookCommandContext(range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) {
		const activeNotebook = vscode.window.activeNotebookEditor
		if (!activeNotebook) {
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "No active Jupyter notebook found. Please open a .ipynb file first.",
			})
			return null
		}

		const ctx = await getContextForCommand(range, diagnostics)
		if (!ctx) {
			return null
		}

		const filePath = ctx.commandContext.filePath || ""
		let cellJson: string | null = null
		if (activeNotebook.notebook.cellCount > 0) {
			const cellIndex = activeNotebook.notebook.cellAt(activeNotebook.selection.start).index
			cellJson = await findMatchingNotebookCell(filePath, cellIndex)
		}

		return { ...ctx, cellJson }
	}

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.JupyterGenerateCell,
			async (range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) => {
				const userPrompt = await showJupyterPromptInput(
					"Generate Notebook Cell",
					"Enter your prompt for generating notebook cell (press Enter to confirm & Esc to cancel)",
				)
				if (!userPrompt) return

				const ctx = await getNotebookCommandContext(range, diagnostics)
				if (!ctx) return

				const notebookContext = `User prompt: ${userPrompt}
Insert a new Jupyter notebook cell above or below the current cell based on user prompt.
${NOTEBOOK_EDIT_INSTRUCTIONS}

Current Notebook Cell Context (JSON, sanitized of image data):
\`\`\`json
${ctx.cellJson || "{}"}
\`\`\``

				await addToCline(ctx.controller, ctx.commandContext, notebookContext)
			},
		),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.JupyterExplainCell,
			async (range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) => {
				const ctx = await getNotebookCommandContext(range, diagnostics)
				if (!ctx) return

				const notebookContext = ctx.cellJson
					? `\n\nCurrent Notebook Cell Context (JSON, sanitized of image data):\n\`\`\`json\n${ctx.cellJson}\n\`\`\``
					: undefined

				await explainWithCline(ctx.controller, ctx.commandContext, notebookContext)
			},
		),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand(
			commands.JupyterImproveCell,
			async (range?: vscode.Range, diagnostics?: vscode.Diagnostic[]) => {
				const userPrompt = await showJupyterPromptInput(
					"Improve Notebook Cell",
					"Enter your prompt for improving the current notebook cell (press Enter to confirm & Esc to cancel)",
				)
				if (!userPrompt) return

				const ctx = await getNotebookCommandContext(range, diagnostics)
				if (!ctx) return

				const notebookContext = `User prompt: ${userPrompt}
${NOTEBOOK_EDIT_INSTRUCTIONS}

Current Notebook Cell Context (JSON, sanitized of image data):
\`\`\`json
${ctx.cellJson || "{}"}
\`\`\``

				await improveWithCline(ctx.controller, ctx.commandContext, notebookContext)
			},
		),
	)

	// Register the openWalkthrough command handler
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.Walkthrough, async () => {
			await vscode.commands.executeCommand(
				"workbench.action.openWalkthrough",
				`${context.extension.id}#CodeVibeWalkthrough`,
			)
			telemetryService.captureButtonClick("command_openWalkthrough")
		}),
	)

	// Register the reconstructTaskHistory command handler
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.ReconstructTaskHistory, async () => {
			const { reconstructTaskHistory } = await import("./core/commands/reconstructTaskHistory")
			await reconstructTaskHistory()
			telemetryService.captureButtonClick("command_reconstructTaskHistory")
		}),
	)

	// Register the generateGitCommitMessage command handler
	context.subscriptions.push(
		vscode.commands.registerCommand(commands.GenerateCommit, async (scm) => {
			generateCommitMsg(webview.controller, scm)
		}),
		vscode.commands.registerCommand(commands.AbortCommit, () => {
			abortCommitGeneration()
		}),
	)

	// Listen for secrets changes (e.g., cross-window login/logout sync)
	const unsubSecrets = storageContext.secrets.onDidChange((event) => {
		if (event.key === "cline:clineAccountId") {
			const secretValue = storageContext.secrets.get<string>(event.key)
			const activeWebview = WebviewProvider.getVisibleInstance()
			const controller = activeWebview?.controller

			const authService = AuthService.getInstance(controller)
			if (secretValue) {
				// Secret was added or updated - restore auth info (login from another window)
				authService?.restoreRefreshTokenAndRetrieveAuthInfo()
			} else {
				// Secret was removed - handle logout for all windows
				authService?.handleDeauth(LogoutReason.CROSS_WINDOW_SYNC)
			}
		}
	})
	context.subscriptions.push({ dispose: unsubSecrets })

	Logger.log(`[CodeVibe] extension activated in ${performance.now() - activationStartTime} ms`)

	return createCodeVibeAPI(webview.controller)
}

async function showJupyterPromptInput(title: string, placeholder: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		const quickPick = vscode.window.createQuickPick()
		quickPick.title = title
		quickPick.placeholder = placeholder
		quickPick.ignoreFocusOut = true

		// Allow free text input
		quickPick.canSelectMany = false

		let userInput = ""

		quickPick.onDidChangeValue((value) => {
			userInput = value
			// Update items to show the current input
			if (value) {
				quickPick.items = [
					{
						label: "$(check) Use this prompt",
						detail: value,
						alwaysShow: true,
					},
				]
			} else {
				quickPick.items = []
			}
		})

		quickPick.onDidAccept(() => {
			if (userInput) {
				resolve(userInput)
				quickPick.hide()
			}
		})

		quickPick.onDidHide(() => {
			if (!userInput) {
				resolve(undefined)
			}
			quickPick.dispose()
		})

		quickPick.show()
	})
}

function setupHostProvider(context: ExtensionContext) {
	const outputChannel = registerClineOutputChannel(context)
	outputChannel.appendLine("[CodeVibe] Setting up VS Code host...")

	const createWebview = () => new VscodeWebviewProvider(context)
	const createDiffView = () => new VscodeDiffViewProvider()
	const createCommentReview = () => getVscodeCommentReviewController()
	const createTerminalManager = () => new VscodeTerminalManager()

	const getCallbackUrl = async (path: string, _preferredPort?: number) => {
		const scheme = vscode.env.uriScheme || "vscode"
		const callbackUri = vscode.Uri.parse(`${scheme}://${context.extension.id}${path}`)

		if (vscode.env.uiKind === vscode.UIKind.Web) {
			// In VS Code Web (Codespaces, code serve-web), vscode:// URIs redirect to the
			// desktop app instead of staying in the browser. Use asExternalUri to convert
			// to a web-reachable HTTPS URL that routes back to the extension's URI handler.
			const externalUri = await vscode.env.asExternalUri(callbackUri)
			return externalUri.toString(true)
		}

		// In regular desktop VS Code, use the vscode:// URI protocol handler directly.
		return callbackUri.toString(true)
	}
	HostProvider.initialize(
		createWebview,
		createDiffView,
		createCommentReview,
		createTerminalManager,
		vscodeHostBridgeClient,
		() => {}, // No-op logger, logging is handled via HostProvider.env.debugLog
		getCallbackUrl,
		getBinaryLocation,
		context.extensionUri.fsPath,
		context.globalStorageUri.fsPath,
	)
}

function getUriPath(url: string): string | undefined {
	try {
		return getCursorCompatibleUriPath(new URL(url))
	} catch {
		return undefined
	}
}

function getCursorNdjsonIngestSettings(forceAutoPort: boolean): { port: number; bindAddress: string } {
	const config = vscode.workspace.getConfiguration("ndjson")
	const configuredPort = config.get<number>("port", 0)
	return {
		port: forceAutoPort ? 0 : configuredPort,
		bindAddress: config.get<string>("bindAddress", "127.0.0.1"),
	}
}

function isLoopbackBindAddress(bindAddress: string): boolean {
	const normalized = bindAddress.trim().toLowerCase()
	return normalized === "localhost" || normalized === "::1" || normalized === "[::1]" || normalized.startsWith("127.")
}

async function confirmCursorNdjsonBindAddress(bindAddress: string): Promise<boolean> {
	if (isLoopbackBindAddress(bindAddress)) {
		return true
	}
	const choice = await vscode.window.showWarningMessage(
		`Cursor NDJSON ingest is configured to bind to ${bindAddress}. This can expose the ingest endpoint beyond this machine.`,
		{ modal: true },
		"Start Server",
	)
	return choice === "Start Server"
}

async function showCursorNdjsonStatus(status: CursorNdjsonIngestServerStatus, title: string): Promise<void> {
	const detail = status.running && status.url ? `${status.url}/ingest` : "Not running"
	await vscode.window.showInformationMessage(`${title}: ${detail}`)
}

type NativeChatApi = {
	createChatParticipant?: (
		id: string,
		handler: (request: unknown, context: unknown, stream: unknown, token: vscode.CancellationToken) => unknown,
	) => vscode.Disposable & { iconPath?: vscode.Uri }
}

type NativeChatRequest = {
	prompt?: unknown
	command?: unknown
}

type NativeChatResponseStream = {
	progress?: (message: string) => void
	markdown?: (message: string) => void
}

function buildCodeVibeNativeChatTaskText(request: NativeChatRequest): string {
	const prompt = typeof request.prompt === "string" ? request.prompt.trim() : ""
	const command = typeof request.command === "string" ? request.command.trim().toLowerCase() : ""
	switch (command) {
		case "plan":
			return prompt
				? `Plan this task first before editing.\n\n${prompt}`
				: "Plan the next CodeVibe task first before editing."
		case "review":
			return prompt
				? `Review this request and prioritize bugs, risks, regressions, and missing tests.\n\n${prompt}`
				: "Review the current workspace and prioritize bugs, risks, regressions, and missing tests."
		default:
			return prompt
	}
}

function registerCodeVibeChatParticipant(context: vscode.ExtensionContext): void {
	const chatApi = (vscode as typeof vscode & { chat?: NativeChatApi }).chat
	if (!chatApi?.createChatParticipant) {
		return
	}

	try {
		const participant = chatApi.createChatParticipant(
			CODEVIBE_CHAT_PARTICIPANT_ID,
			async (request, _chatContext, stream, token) => {
				const chatRequest = request as NativeChatRequest
				const responseStream = stream as NativeChatResponseStream
				const taskText = buildCodeVibeNativeChatTaskText(chatRequest)

				responseStream.progress?.("Opening CodeVibe Agent...")
				if (token.isCancellationRequested) {
					return { metadata: { routedTo: CODEVIBE_CHAT_PARTICIPANT_ID, cancelled: true } }
				}

				await showPreferredCodeVibeSurface(false, { allowOpenAiCodexSidebar: false })
				await sendShowWebviewEvent(false)
				if (taskText) {
					await sendAddToInputEvent(taskText)
					responseStream.markdown?.(
						"Opened CodeVibe Agent and moved this prompt into the task box. Start the task there to use CodeVibe's planner, tools, diffs, terminal approvals, MCP, and browser automation.",
					)
				} else {
					responseStream.markdown?.(
						"Opened CodeVibe Agent. Start a task there to use CodeVibe's planner, tools, diffs, terminal approvals, MCP, and browser automation.",
					)
				}

				return { metadata: { routedTo: CODEVIBE_CHAT_PARTICIPANT_ID } }
			},
		)
		participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "icon.png")
		context.subscriptions.push(participant)
	} catch (error) {
		Logger.warn(
			`Failed to register CodeVibe native chat participant: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
}

async function openCodeVibeSurfaceForTaskUri(): Promise<void> {
	await showPreferredCodeVibeSurface(true, { allowLegacyFallback: false })
}

async function showCodeVibeSurface(preserveEditorFocus: boolean): Promise<VscodeWebviewProvider> {
	const webview = WebviewProvider.getInstance() as VscodeWebviewProvider
	await webview.showPanel(preserveEditorFocus)
	return webview
}

async function showPreferredCodeVibeSurface(
	preserveEditorFocus: boolean,
	options: { allowLegacyFallback?: boolean; allowOpenAiCodexSidebar?: boolean } = {},
): Promise<VscodeWebviewProvider> {
	const webview = WebviewProvider.getInstance() as VscodeWebviewProvider
	const allowLegacyFallback = options.allowLegacyFallback ?? true
	const allowOpenAiCodexSidebar = options.allowOpenAiCodexSidebar ?? true

	await closeLegacyCodeVibePanels()

	if (allowOpenAiCodexSidebar && shouldPreferOpenAiCodexSidebar() && (await openOpenAiCodexSidebar())) {
		return webview
	}

	if (!allowLegacyFallback) {
		return webview
	}

	await webview.show(preserveEditorFocus)
	return webview
}

function shouldPreferOpenAiCodexSidebar(): boolean {
	return getCodeVibeConfigurationValue<boolean>("ui.preferOpenAiCodexSidebar", false)
}

async function openOpenAiCodexSidebar(): Promise<boolean> {
	const codexExtension = vscode.extensions.getExtension(OPENAI_CODEX_EXTENSION_ID)
	if (!codexExtension) {
		return false
	}

	try {
		if (!codexExtension.isActive) {
			await codexExtension.activate()
		}
		await vscode.commands.executeCommand(OPENAI_CODEX_OPEN_SIDEBAR_COMMAND)
		return true
	} catch (error) {
		Logger.warn(`Failed to open OpenAI Codex sidebar: ${error instanceof Error ? error.message : String(error)}`)
		return false
	}
}

function isLegacyCodeVibePanelTab(tab: vscode.Tab): boolean {
	const input = tab.input as { viewType?: string } | undefined
	return input?.viewType === LEGACY_CODEVIBE_PANEL_VIEW_TYPE
}

async function closeLegacyCodeVibePanels(): Promise<void> {
	try {
		const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter(isLegacyCodeVibePanelTab)
		if (tabs.length > 0) {
			await vscode.window.tabGroups.close(tabs)
		}
	} catch (error) {
		Logger.warn(`Failed to close restored CodeVibe legacy panels: ${error instanceof Error ? error.message : String(error)}`)
	}

	try {
		;(WebviewProvider.getInstance() as VscodeWebviewProvider).closePanel()
	} catch {
		// The provider is not initialized during early activation paths.
	}
}

function scheduleLegacyCodeVibePanelCleanup(context: vscode.ExtensionContext): void {
	for (const delayMs of [500, 2_000, 5_000]) {
		const timer = setTimeout(() => {
			closeLegacyCodeVibePanels().catch((error) => {
				Logger.warn(
					`Failed to close restored CodeVibe legacy panel after layout restore: ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
			})
		}, delayMs)
		context.subscriptions.push({ dispose: () => clearTimeout(timer) })
	}
}

async function getBinaryLocation(name: string): Promise<string> {
	// The only binary currently supported is the rg binary from the VSCode installation.
	if (!name.startsWith("rg")) {
		throw new Error(`Binary '${name}' is not supported`)
	}

	const checkPath = async (pkgFolder: string) => {
		const fullPathResult = workspaceResolver.resolveWorkspacePath(
			vscode.env.appRoot,
			path.join(pkgFolder, name),
			"Services.ripgrep.getBinPath",
		)
		const fullPath = typeof fullPathResult === "string" ? fullPathResult : fullPathResult.absolutePath
		return (await fileExistsAtPath(fullPath)) ? fullPath : undefined
	}

	// VS Code 1.122.0 (microsoft/vscode#317978 et al.) migrated from @vscode/ripgrep
	// to @vscode/ripgrep-universal, which ships per-platform/arch subdirectories.
	// Probe the new layout first; fall back to the legacy paths for ≤1.121.x.
	const platformArch = `${process.platform}-${process.arch}`
	const binPath =
		(await checkPath(`node_modules/@vscode/ripgrep-universal/bin/${platformArch}/`)) ||
		(await checkPath(`node_modules.asar.unpacked/@vscode/ripgrep-universal/bin/${platformArch}/`)) ||
		(await checkPath("node_modules/@vscode/ripgrep/bin/")) ||
		(await checkPath("node_modules/vscode-ripgrep/bin")) ||
		(await checkPath("node_modules.asar.unpacked/vscode-ripgrep/bin/")) ||
		(await checkPath("node_modules.asar.unpacked/@vscode/ripgrep/bin/"))
	if (!binPath) {
		throw new Error("Could not find ripgrep binary")
	}
	return binPath
}

// This method is called when your extension is deactivated
export async function deactivate() {
	// Dispose Non-VSCode-specific services
	tearDown()

	// VSCode-specific services
	disposeVscodeCommentReviewController()
}

// TODO: Find a solution for automatically removing DEV related content from production builds.
//  This type of code is fine in production to keep. We just will want to remove it from production builds
//  to bring down built asset sizes.
//
// This is a workaround to reload the extension when the source code changes
// since vscode doesn't support hot reload for extensions
const IS_DEV = process.env.IS_DEV === "true"
const DEV_WORKSPACE_FOLDER = process.env.DEV_WORKSPACE_FOLDER

// Set up development mode file watcher
if (IS_DEV) {
	assert(DEV_WORKSPACE_FOLDER, "DEV_WORKSPACE_FOLDER must be set in development")
	const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(DEV_WORKSPACE_FOLDER, "src/**/*"))

	watcher.onDidChange(({ scheme, path }) => {
		Logger.info(`${scheme} ${path} changed. Reloading VSCode...`)

		vscode.commands.executeCommand("workbench.action.reloadWindow")
	})
}

// VSCode-specific storage migrations
async function cleanupLegacyVSCodeStorage(context: ExtensionContext): Promise<void> {
	try {
		await cleanupOldApiKey(context)
		// Migrate is not done if the new storage does not have the lastShownAnnouncementId flag
		const hasMigrated = context.globalState.get("lastShownAnnouncementId")
		if (hasMigrated !== undefined) {
			return
		}

		Logger.info("[VS Code Storage Migrations] Starting")

		// Migrate custom instructions to global Cline rules (one-time cleanup)
		await migrateCustomInstructionsToGlobalRules(context)

		// Migrate welcomeViewCompleted setting based on existing API keys (one-time cleanup)
		await migrateWelcomeViewCompleted(context)

		// Migrate workspace storage values back to global storage (reverting previous migration)
		await migrateWorkspaceToGlobalStorage(context)

		// Ensure taskHistory.json exists and migrate legacy state (runs once)
		await migrateTaskHistoryToFile(context)

		// Clean up MCP marketplace catalog from global state (moved to disk cache)
		await cleanupMcpMarketplaceCatalogFromGlobalState(context)

		// lastShownAnnouncementId will be set when announcement is shown
		// after activation so we don't need to set it here.

		Logger.info("[VS Code Storage Migrations] Completed")
	} catch (error) {
		Logger.warn("[VS Code Storage Migrations] Failed" + (error instanceof Error ? `: ${error.message}` : ""))
	}
}
