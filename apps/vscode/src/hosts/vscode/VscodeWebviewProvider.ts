import { sendShowWebviewEvent } from "@core/controller/ui/subscribeToShowWebview"
import { WebviewProvider } from "@core/webview"
import * as vscode from "vscode"
import { handleGrpcRequest, handleGrpcRequestCancel } from "@/core/controller/grpc-handler"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import type { ExtensionMessage } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { WebviewMessage } from "@/shared/WebviewMessage"

/*
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/blob/main/default/weather-webview/src/providers/WeatherViewProvider.ts
https://github.com/KumarVariable/vscode-extension-sidebar-html/blob/master/src/customSidebarViewProvider.ts
*/

export class VscodeWebviewProvider extends WebviewProvider implements vscode.WebviewViewProvider {
	// Used in package.json as the view's id. This value cannot be changed due to how vscode caches
	// views based on their id, and updating the id would break existing instances of the extension.
	public static readonly SIDEBAR_ID = ExtensionRegistryInfo.views.Sidebar

	private webview?: vscode.WebviewView
	private panel?: vscode.WebviewPanel
	private disposables: vscode.Disposable[] = []
	private panelDisposables: vscode.Disposable[] = []

	override getWebviewUrl(path: string) {
		const webview = this.panel?.webview ?? this.webview?.webview
		if (!webview) {
			throw new Error("Webview not initialized")
		}
		const uri = webview.asWebviewUri(vscode.Uri.file(path))
		return uri.toString()
	}

	override getCspSource() {
		const webview = this.panel?.webview ?? this.webview?.webview
		if (!webview) {
			throw new Error("Webview not initialized")
		}
		return webview.cspSource
	}

	override isVisible() {
		return this.webview?.visible || this.panel?.visible || false
	}

	public getWebview(): vscode.WebviewView | undefined {
		return this.webview
	}

	public closePanel(): void {
		this.panel?.dispose()
		this.panel = undefined
	}

	public async show(preserveEditorFocus = false): Promise<void> {
		await closeCompetingAgentSurfaces()
		await this.showPanel(preserveEditorFocus)
	}

	public async showPanel(preserveEditorFocus = false): Promise<void> {
		if (this.panel) {
			await closeCompetingAgentSurfaces()
			this.panel.reveal(this.panel.viewColumn, preserveEditorFocus)
			return
		}

		await closeCompetingAgentSurfaces(this.webview?.visible)

		const viewColumn = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One
		this.panel = vscode.window.createWebviewPanel(ExtensionRegistryInfo.views.Panel, "CodeVibe", viewColumn, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.file(HostProvider.get().extensionFsPath)],
		})

		this.panel.webview.html =
			this.context.extensionMode === vscode.ExtensionMode.Development
				? await this.getHMRHtmlContent()
				: this.getHtmlContent()

		this.setWebviewMessageListener(this.panel.webview, this.panelDisposables)
		this.registerConfigurationListener(this.panelDisposables)
		this.registerCursorSandboxWatcher(this.panelDisposables)

		this.panel.onDidDispose(
			() => {
				while (this.panelDisposables.length) {
					this.panelDisposables.pop()?.dispose()
				}
				this.panel = undefined
			},
			null,
			this.panelDisposables,
		)

		Logger.log("[VscodeWebviewProvider] Webview panel opened")
	}

	/**
	 * Initializes and sets up the webview when it's first created.
	 *
	 * @param webviewView - The sidebar webview view instance to be resolved
	 * @returns A promise that resolves when the webview has been fully initialized
	 */
	public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
		this.webview = webviewView

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,
			localResourceRoots: [vscode.Uri.file(HostProvider.get().extensionFsPath)],
		}

		webviewView.webview.html =
			this.context.extensionMode === vscode.ExtensionMode.Development
				? await this.getHMRHtmlContent()
				: this.getHtmlContent()

		// Sets up an event listener to listen for messages passed from the webview view context
		// and executes code based on the message that is received
		this.setWebviewMessageListener(webviewView.webview)

		// Logs show up in bottom panel > Debug Console
		//Logger.log("registering listener")

		// Listen for when the sidebar becomes visible
		// https://github.com/microsoft/vscode-discussions/discussions/840

		// onDidChangeVisibility is only available on the sidebar webview
		// Otherwise WebviewView and WebviewPanel have all the same properties except for this visibility listener
		// WebviewPanel is not currently used in the extension
		webviewView.onDidChangeVisibility(
			async () => {
				if (this.webview?.visible) {
					// View becoming visible should not steal editor focus.
					await sendShowWebviewEvent(true)
				}
			},
			null,
			this.disposables,
		)

		// Listen for when the view is disposed
		// This happens when the user closes the view or when the view is closed programmatically
		webviewView.onDidDispose(
			async () => {
				await this.dispose()
			},
			null,
			this.disposables,
		)

		this.registerConfigurationListener(this.disposables)
		this.registerCursorSandboxWatcher(this.disposables)

		// if the extension is starting a new session, clear previous task state
		this.controller.clearTask()

		Logger.log("[VscodeWebviewProvider] Webview view resolved")

		// Title setting logic removed to allow VSCode to use the container title primarily.
	}

	/**
	 * Sets up an event listener to listen for messages passed from the webview context and
	 * executes code based on the message that is received.
	 *
	 * IMPORTANT: When passing methods as callbacks in JavaScript/TypeScript, the method's
	 * 'this' context can be lost. This happens because the method is passed as a
	 * standalone function reference, detached from its original object.
	 *
	 * The Problem:
	 * Doing: webview.onDidReceiveMessage(this.controller.handleWebviewMessage)
	 * Would cause 'this' inside handleWebviewMessage to be undefined or wrong,
	 * leading to "TypeError: this.setUserInfo is not a function"
	 *
	 * The Solution:
	 * We wrap the method call in an arrow function, which:
	 * 1. Preserves the lexical scope's 'this' binding
	 * 2. Ensures handleWebviewMessage is called as a method on the controller instance
	 * 3. Maintains access to all controller methods and properties
	 *
	 * Alternative solutions could use .bind() or making handleWebviewMessage an arrow
	 * function property, but this approach is clean and explicit.
	 *
	 * @param webview The webview instance to attach the message listener to
	 */
	private registerConfigurationListener(disposables: vscode.Disposable[]) {
		vscode.workspace.onDidChangeConfiguration(
			async (e) => {
				if (
					e &&
					(e.affectsConfiguration("codevibe.compatibility.enabled") ||
						e.affectsConfiguration("codevibe.compatibility.deepLinks.enabled") ||
						e.affectsConfiguration("codevibe.compatibility.retrievalIndexing.privacyGate") ||
						e.affectsConfiguration("codevibe.compatibility.sandboxPolicy") ||
						e.affectsConfiguration("codevibe.compatibility.safeBrowserEvaluate.enabled") ||
						e.affectsConfiguration("codevibe.openAiCodex.authSource") ||
						e.affectsConfiguration("codevibe.cursorCompatibility.enabled") ||
						e.affectsConfiguration("codevibe.cursorCompatibility.deepLinks.enabled") ||
						e.affectsConfiguration("codevibe.cursorCompatibility.retrievalIndexing.privacyGate") ||
						e.affectsConfiguration("codevibe.cursorCompatibility.sandboxPolicy") ||
						e.affectsConfiguration("codevibe.cursorCompatibility.safeBrowserEvaluate.enabled") ||
						e.affectsConfiguration("mcpMarketplace.enabled"))
				) {
					// Update state when marketplace tab setting changes
					await this.controller.postStateToWebview()
				}
			},
			null,
			disposables,
		)
	}

	private registerCursorSandboxWatcher(disposables: vscode.Disposable[]) {
		const watcher = vscode.workspace.createFileSystemWatcher("**/.cursor/sandbox.json")
		const refreshState = async () => {
			try {
				await this.controller.postStateToWebview()
			} catch (error) {
				Logger.warn(
					`Failed to refresh CodeVibe sandbox status after .cursor/sandbox.json changed: ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
			}
		}

		watcher.onDidCreate(refreshState, null, disposables)
		watcher.onDidChange(refreshState, null, disposables)
		watcher.onDidDelete(refreshState, null, disposables)
		disposables.push(watcher)
	}

	private setWebviewMessageListener(webview: vscode.Webview, disposables = this.disposables) {
		webview.onDidReceiveMessage(
			(message) => {
				this.handleWebviewMessage(message)
			},
			null,
			disposables,
		)
	}

	/**
	 * Sets up an event listener to listen for messages passed from the webview context and
	 * executes code based on the message that is received.
	 *
	 * @param webview A reference to the extension webview
	 */
	async handleWebviewMessage(message: WebviewMessage) {
		const postMessageToWebview = (response: ExtensionMessage) => this.postMessageToWebview(response)

		switch (message.type) {
			case "grpc_request": {
				if (message.grpc_request) {
					await handleGrpcRequest(this.controller, postMessageToWebview, message.grpc_request)
				}
				break
			}
			case "grpc_request_cancel": {
				if (message.grpc_request_cancel) {
					await handleGrpcRequestCancel(postMessageToWebview, message.grpc_request_cancel)
				}
				break
			}
			default: {
				Logger.error("Received unhandled WebviewMessage type:", JSON.stringify(message))
			}
		}
	}

	/**
	 * Sends a message from the extension to the webview.
	 *
	 * @param message - The message to send to the webview
	 * @returns A thenable that resolves to a boolean indicating success, or undefined if the webview is not available
	 */
	private async postMessageToWebview(message: ExtensionMessage): Promise<boolean | undefined> {
		return (this.panel?.webview ?? this.webview?.webview)?.postMessage(message)
	}

	override async dispose() {
		// WebviewView doesn't have a dispose method, it's managed by VSCode
		// We just need to clean up our disposables
		this.panel?.dispose()
		while (this.disposables.length) {
			const x = this.disposables.pop()
			if (x) {
				x.dispose()
			}
		}
		while (this.panelDisposables.length) {
			this.panelDisposables.pop()?.dispose()
		}
		super.dispose()
	}
}

async function closeCompetingAgentSurfaces(closeSidebar = false): Promise<void> {
	const commands = ["workbench.action.closeAuxiliaryBar"]
	if (closeSidebar) {
		commands.push("workbench.action.closeSidebar")
	}

	for (const command of commands) {
		await vscode.commands.executeCommand(command).then(
			() => undefined,
			() => undefined,
		)
	}
}
