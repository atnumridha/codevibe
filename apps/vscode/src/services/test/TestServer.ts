import { resolveCursorSandboxPolicy, type CursorSandboxRuntimePolicy } from "@core/config/cursor-sandbox"
import { sendStateUpdate, setE2EInitialStateOverride } from "@core/controller/state/subscribeToState"
import { CommandPermissionController } from "@core/permissions"
import { COMMAND_PERMISSIONS_ENV_VAR, LEGACY_COMMAND_PERMISSIONS_ENV_VAR } from "@core/permissions/types"
import { getPlanStorageService } from "@core/plan/PlanStorageService"
import { getSavedApiConversationHistory, getSavedClineMessages } from "@core/storage/disk"
import { getDefaultTerminalRunMode, resolveInlineTerminalRequest } from "@core/task/tools/handlers/ExecuteCommandToolHandler"
import { WebviewProvider } from "@core/webview"
import { searchWorkspaceText } from "@hosts/vscode/hostbridge/workspace/searchWorkspaceText"
import { AutoApprovalSettings, DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import type { BrowserActionResult, ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import { HistoryItem } from "@shared/HistoryItem"
import { DEFAULT_API_PROVIDER, openAiCodexDefaultModelId, openAiCodexModels, type ApiProvider, type ModelInfo } from "@shared/api"
import { SearchWorkspaceTextRequest } from "@shared/proto/host/workspace"
import { execa } from "execa"
import * as fs from "fs"
import * as http from "http"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { Controller } from "@/core/controller"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { SharedUriHandler } from "@/services/uri/SharedUriHandler"
import { Logger } from "@/shared/services/Logger"
import { getCwd } from "@/utils/path"
import { calculateToolSuccessRate, getFileChanges, initializeGitRepository, validateWorkspacePath } from "./GitHelper"

/**
 * Creates a tracker to monitor tool calls and failures during task execution
 * @returns Object tracking tool calls and failures
 */
function createToolCallTracker(): {
	toolCalls: Record<string, number>
	toolFailures: Record<string, number>
} {
	const tracker = {
		toolCalls: {} as Record<string, number>,
		toolFailures: {} as Record<string, number>,
	}
	return tracker
}

// Task completion tracking
let _taskCompletionResolver: (() => void) | null = null

// Function to create a new task completion promise
function createTaskCompletionTracker(): Promise<void> {
	// Create a new promise that will resolve when the task is completed
	return new Promise<void>((resolve) => {
		_taskCompletionResolver = resolve
	})
}

let testServer: http.Server | undefined
let messageCatcherDisposable: vscode.Disposable | undefined

export type TestServerNativeAgentDiagnostics = {
	ready?: boolean
	diagnostics: unknown
}

export type TestServerNativeAgentRequestInput = {
	prompt?: string
	command?: string
}

export type TestServerNativeAgentRequestResult = {
	taskText?: string
	progress: string[]
	markdown: string[]
	result?: unknown
	currentTaskItem?: Pick<HistoryItem, "id" | "task" | "ts">
}

export type TestServerHooks = {
	getNativeAgentDiagnostics?: () => TestServerNativeAgentDiagnostics
	openNativeAgentSession?: (position: "sidebar" | "editor") => Promise<unknown>
	invokeNativeAgentRequest?: (
		input: TestServerNativeAgentRequestInput,
	) => Promise<TestServerNativeAgentRequestResult>
}

const E2E_CLINE_TEST_API_KEY = "test-personal-token"
const E2E_CLINE_TEST_ACCOUNT_ID = "test-member-789"
const E2E_CLINE_TEST_MODEL_ID = "z-ai/glm-5"
const E2E_CLINE_TEST_MODEL_INFO = {
	name: E2E_CLINE_TEST_MODEL_ID,
	maxTokens: 8_192,
	contextWindow: 131_072,
	supportsPromptCache: false,
	inputPrice: 0,
	outputPrice: 0,
	description: "Free model for e2e onboarding",
} satisfies ModelInfo
const E2E_OPENAI_CODEX_ACCOUNT_ID = "acct_codevibe_e2e_codex"
const E2E_OPENAI_CODEX_EMAIL = "codex-e2e@example.invalid"
const E2E_OPENAI_CODEX_INSTALLATION_ID = "install_codevibe_e2e"
const E2E_BROWSER_AUTOMATION_URL = "http://127.0.0.1:4317/codie-browser-e2e"
const E2E_BROWSER_AUTOMATION_SCREENSHOT =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
const E2E_SEEDED_TASK_HISTORY: HistoryItem[] = [
	"Seeded review task",
	"Seeded planning task",
	"Seeded hardening task",
].map((task, index) => ({
	id: `e2e-seeded-${index + 1}`,
	ts: 1_700_000_000_000 - index,
	task,
	tokensIn: 0,
	tokensOut: 0,
	totalCost: 0,
	modelId: E2E_CLINE_TEST_MODEL_ID,
}))

function encodeBase64UrlJson(value: unknown): string {
	return Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
}

function createE2EOpenAiCodexJwt(claims: Record<string, unknown>): string {
	return `${encodeBase64UrlJson({ alg: "none", typ: "JWT" })}.${encodeBase64UrlJson(claims)}.signature`
}

function summarizeVisibleApprovalSandbox(
	policy: CursorSandboxRuntimePolicy,
): NonNullable<ExtensionState["compatibilityStatus"]>["sandboxRuntime"] {
	return {
		status: policy.status,
		effectiveAccess: policy.effectiveAccess,
		configSource: policy.configSource ?? (policy.source === "cursor-sandbox" ? "cursorCompatibility" : "codie"),
		configPath: policy.configPath,
		workspaceRoot: policy.workspaceRoot,
		error: policy.error,
		readablePathCount: policy.readablePaths.length,
		writablePathCount: policy.writablePaths.length,
		networkDefault: policy.networkPolicy.default,
		networkAllowCount: policy.networkPolicy.allow.length,
		networkDenyCount: policy.networkPolicy.deny?.length ?? 0,
		networkStrict: policy.networkPolicyStrict ?? false,
		blockGitWrites: policy.blockGitWrites,
		allowTerminalAutoApprove: policy.allowTerminalAutoApprove,
	}
}

async function createVisibleCommandApprovalSeed(controller: Controller, command: string) {
	let sandboxRoot: string | undefined
	try {
		sandboxRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codevibe-e2e-visible-approval-"))
		const cursorConfigDir = path.join(sandboxRoot, ".cursor")
		const cursorConfigPath = path.join(cursorConfigDir, "sandbox.json")
		await fs.promises.mkdir(cursorConfigDir, { recursive: true })
		await fs.promises.writeFile(
			cursorConfigPath,
			`${JSON.stringify(
				{
					type: "workspace_readonly",
					blockGitWrites: true,
					networkPolicy: { default: "deny", allow: [] },
				},
				null,
				2,
			)}\n`,
			"utf8",
		)
		const sandboxPolicy = await resolveCursorSandboxPolicy({
			workspaceRoot: sandboxRoot,
			policySetting: "workspace",
		})
		if (!sandboxPolicy) {
			throw new Error("Expected visible approval sandbox policy to load from .cursor/sandbox.json")
		}

		await controller.clearTask()
		controller.stateManager.setGlobalState("welcomeViewCompleted", true)
		controller.stateManager.setGlobalState("isNewUser", false)

		const baseState = await controller.getStateToPostToWebview()
		const taskTs = Date.now()
		const taskItem: HistoryItem = {
			id: `e2e-visible-approval-${taskTs}`,
			ts: taskTs,
			task: "Installed visible terminal approval",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
		}
		const clineMessages: ClineMessage[] = [
			{
				type: "say",
				say: "task",
				text: "Installed visible terminal approval",
				ts: taskTs,
			},
			{
				type: "ask",
				ask: "command",
				text: `${command}${COMMAND_REQ_APP_STRING}`,
				ts: taskTs + 1,
			},
		]
		const seededState: ExtensionState = {
			...baseState,
			currentTaskItem: taskItem,
			taskHistory: [taskItem, ...(baseState.taskHistory ?? []).filter((item) => item.id !== taskItem.id)],
			clineMessages,
			isNewUser: false,
			welcomeViewCompleted: true,
			mode: "act",
			compatibilityStatus: {
				...(baseState.compatibilityStatus ?? {
					enabled: true,
					deepLinksEnabled: true,
					retrievalIndexingPrivacyGate: true,
					sandboxPolicy: "workspace",
					safeBrowserEvaluateEnabled: false,
					effectiveBrowserEvaluateEnabled: false,
					openAiCodexAuthSource: "auto",
					openAiCodexAuthenticated: false,
				}),
				sandboxPolicy: "workspace",
				sandboxRuntime: summarizeVisibleApprovalSandbox(sandboxPolicy),
			},
		}

		return { clineMessages, command, seededState, taskItem }
	} finally {
		if (sandboxRoot) {
			await fs.promises.rm(sandboxRoot, { recursive: true, force: true }).catch(() => undefined)
		}
	}
}

function createBrowserAutomationResult(overrides: Partial<BrowserActionResult> = {}): string {
	return JSON.stringify({
		currentUrl: E2E_BROWSER_AUTOMATION_URL,
		currentMousePosition: "120,140",
		screenshot: E2E_BROWSER_AUTOMATION_SCREENSHOT,
		logs: "[console] Codie installed browser automation snapshot",
		title: "Codie Browser Automation E2E",
		text: "Codie browser automation snapshot ready",
		nodes: [
			{
				ref: "button-run-search",
				role: "button",
				name: "Run search",
				text: "Run search",
			},
		],
		...overrides,
	} satisfies BrowserActionResult)
}

async function createVisibleBrowserAutomationSeed(controller: Controller) {
	await controller.clearTask()
	controller.stateManager.setGlobalState("welcomeViewCompleted", true)
	controller.stateManager.setGlobalState("isNewUser", false)
	controller.stateManager.setGlobalState("mode", "act")

	const baseState = await controller.getStateToPostToWebview()
	const taskTs = Date.now()
	const taskItem: HistoryItem = {
		id: `e2e-browser-automation-${taskTs}`,
		ts: taskTs,
		task: "Installed browser automation transcript",
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
	}
	const clineMessages: ClineMessage[] = [
		{
			type: "say",
			say: "task",
			text: "Installed browser automation transcript",
			ts: taskTs,
		},
		{
			type: "ask",
			ask: "browser_action_launch",
			text: E2E_BROWSER_AUTOMATION_URL,
			ts: taskTs + 1,
		},
		{
			type: "say",
			say: "browser_action_result",
			text: "",
			ts: taskTs + 2,
		},
		{
			type: "say",
			say: "browser_action_result",
			text: createBrowserAutomationResult({
				logs: "[console] initial DOM snapshot captured",
				text: "Snapshot ready with Run search button",
			}),
			ts: taskTs + 3,
		},
		{
			type: "say",
			say: "browser_action",
			text: JSON.stringify({ action: "click", coordinate: "120,140" }),
			ts: taskTs + 4,
		},
		{
			type: "say",
			say: "browser_action_result",
			text: createBrowserAutomationResult({
				currentMousePosition: "120,140",
				logs: "[console] clicked Run search",
				text: "Run search clicked",
			}),
			ts: taskTs + 5,
		},
		{
			type: "say",
			say: "browser_action",
			text: JSON.stringify({ action: "type", text: "Codie browser parity" }),
			ts: taskTs + 6,
		},
		{
			type: "say",
			say: "browser_action_result",
			text: createBrowserAutomationResult({
				currentMousePosition: "220,180",
				logs: "[console] typed Codie browser parity",
				text: "Typed Codie browser parity",
			}),
			ts: taskTs + 7,
		},
		{
			type: "say",
			say: "browser_action",
			text: JSON.stringify({ action: "close" }),
			ts: taskTs + 8,
		},
		{
			type: "say",
			say: "text",
			text: "Browser automation evidence captured locally.",
			ts: taskTs + 9,
		},
	]
	const seededState: ExtensionState = {
		...baseState,
		currentTaskItem: taskItem,
		taskHistory: [taskItem, ...(baseState.taskHistory ?? []).filter((item) => item.id !== taskItem.id)],
		clineMessages,
		isNewUser: false,
		welcomeViewCompleted: true,
		mode: "act",
		compatibilityStatus: {
			...(baseState.compatibilityStatus ?? {
				enabled: true,
				deepLinksEnabled: true,
				retrievalIndexingPrivacyGate: true,
				sandboxPolicy: "workspace",
				sandboxRuntime: {
					status: "missing",
					effectiveAccess: "disabled",
					configSource: "none",
					readablePathCount: 0,
					writablePathCount: 0,
					networkDefault: "deny",
					networkAllowCount: 0,
					networkDenyCount: 0,
					networkStrict: false,
					blockGitWrites: false,
					allowTerminalAutoApprove: false,
				},
				safeBrowserEvaluateEnabled: false,
				effectiveBrowserEvaluateEnabled: false,
				openAiCodexAuthSource: "auto",
				openAiCodexAuthenticated: false,
			}),
			safeBrowserEvaluateEnabled: false,
			effectiveBrowserEvaluateEnabled: false,
		},
	}

	return {
		actions: ["launch", "snapshot", "screenshot", "click", "type", "close"],
		clineMessages,
		seededState,
		taskItem,
		url: E2E_BROWSER_AUTOMATION_URL,
	}
}

async function createVisiblePlanBuildSeed(controller: Controller) {
	await controller.clearTask()
	controller.stateManager.setGlobalState("welcomeViewCompleted", true)
	controller.stateManager.setGlobalState("isNewUser", false)
	controller.stateManager.setGlobalState("mode", "plan")

	const baseState = await controller.getStateToPostToWebview()
	const taskTs = Date.now()
	const taskItem: HistoryItem = {
		id: `e2e-plan-build-${taskTs}`,
		ts: taskTs,
		task: "Installed plan build materialization",
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
	}
	const response =
		"## Build Button Materializes\n\nClicking Build Locally must create a local .plan.md before switching to Act mode.\n\n- [ ] Create the plan file\n- [ ] Start local Act mode"
	const clineMessages: ClineMessage[] = [
		{
			type: "say",
			say: "task",
			text: "Installed plan build materialization",
			ts: taskTs,
		},
		{
			type: "ask",
			ask: "plan_mode_respond",
			text: JSON.stringify({ response }),
			ts: taskTs + 1,
		},
	]
	const seededState: ExtensionState = {
		...baseState,
		currentTaskItem: taskItem,
		taskHistory: [taskItem, ...(baseState.taskHistory ?? []).filter((item) => item.id !== taskItem.id)],
		clineMessages,
		isNewUser: false,
		welcomeViewCompleted: true,
		mode: "plan",
	}

	return { clineMessages, response, seededState, taskItem }
}

/**
 * Updates the auto approval settings to enable all actions
 * @param context The VSCode extension context
 * @param controller The webview provider instance
 */
async function updateAutoApprovalSettings(controller?: Controller) {
	try {
		const autoApprovalSettings = controller?.stateManager.getGlobalSettingsKey("autoApprovalSettings")

		// Enable all actions
		const updatedSettings: AutoApprovalSettings = {
			...(autoApprovalSettings || DEFAULT_AUTO_APPROVAL_SETTINGS),
			actions: {
				readFiles: true,
				readFilesExternally: true,
				editFiles: true,
				editFilesExternally: true,
				executeSafeCommands: true,
				executeAllCommands: true,
				useBrowser: false, // Keep browser disabled for tests
				useMcp: false, // Keep MCP disabled for tests
			},
		}

		controller?.stateManager.setGlobalState("autoApprovalSettings", updatedSettings)
		Logger.log("Auto approval settings updated for test mode")

		// Update the webview with the new state
		if (controller) {
			await controller.postStateToWebview()
		}
	} catch (error) {
		Logger.log(`Error updating auto approval settings: ${error}`)
	}
}

async function revealLegacyWebviewForTest(): Promise<boolean> {
	const webviewProvider = WebviewProvider.getInstance() as WebviewProvider & {
		show?: (preserveEditorFocus?: boolean) => Promise<void>
		showPanel?: (preserveEditorFocus?: boolean) => Promise<void>
	}

	await vscode.commands
		.executeCommand("workbench.view.extension.codevibe-agent")
		.then(
			() => undefined,
			() => undefined,
		)
	await vscode.commands.executeCommand("codevibe-agent-chat.focus").then(
		() => undefined,
		() => undefined,
	)
	await new Promise((resolve) => setTimeout(resolve, 500))
	if (webviewProvider.isVisible()) {
		return true
	}

	if (typeof webviewProvider.showPanel === "function") {
		await webviewProvider.showPanel(false)
	} else if (typeof webviewProvider.show === "function") {
		await webviewProvider.show(false)
	} else {
		await vscode.commands.executeCommand(ExtensionRegistryInfo.commands.OpenLegacyWebview)
	}

	await new Promise((resolve) => setTimeout(resolve, 500))
	return webviewProvider.isVisible()
}

/**
 * Creates and starts an HTTP server for test automation
 * @param webviewProvider The webview provider instance to use for message catching
 * @returns The created HTTP server instance
 */
export async function createTestServer(controller: Controller, hooks: TestServerHooks = {}): Promise<http.Server> {
	Logger.log("[createTestServer] Opening CodeVibe surface...")
	revealLegacyWebviewForTest().catch((error) => {
		Logger.warn(`Failed to eagerly open CodeVibe surface for tests: ${error}`)
	})

	// Update auto approval settings is available
	await updateAutoApprovalSettings(controller)

	const PORT = 9876

	testServer = http.createServer((req, res) => {
		// Set CORS headers
		res.setHeader("Access-Control-Allow-Origin", "*")
		res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
		res.setHeader("Access-Control-Allow-Headers", "Content-Type")

		// Handle preflight requests
		if (req.method === "OPTIONS") {
			res.writeHead(204)
			res.end()
			return
		}

		const readRequestBody = (): Promise<string> => {
			return new Promise((resolve) => {
				let body = ""
				req.on("data", (chunk) => {
					body += chunk.toString()
				})
				req.on("end", () => resolve(body))
			})
		}

		// Handle shutdown request
		if (req.method === "POST" && req.url === "/shutdown") {
			res.writeHead(200)
			res.end(JSON.stringify({ success: true, message: "Server shutting down" }))

			// Shut down the server after sending the response
			setTimeout(() => {
				shutdownTestServer()
			}, 100)

			return
		}

		if (req.method === "POST" && req.url === "/open-legacy-webview") {
			;(async () => {
				try {
					const visible = await revealLegacyWebviewForTest()
					res.writeHead(200, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ success: true, visible }))
				} catch (error) {
					res.writeHead(500)
					res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
				}
			})()
			return
		}

		if (req.method === "POST" && req.url === "/seed-signed-in") {
			;(async () => {
				try {
					await controller.clearTask()
					const apiConfiguration = controller.stateManager.getApiConfiguration()
					const testProvider: ApiProvider = "cline"
					controller.stateManager.setSecret("clineAccountId", E2E_CLINE_TEST_ACCOUNT_ID)
					controller.stateManager.setSecret("clineApiKey", E2E_CLINE_TEST_API_KEY)
					controller.stateManager.setApiConfiguration({
						...apiConfiguration,
						clineAccountId: E2E_CLINE_TEST_ACCOUNT_ID,
						clineApiKey: E2E_CLINE_TEST_API_KEY,
						planModeApiProvider: testProvider,
						actModeApiProvider: testProvider,
						planModeClineModelId: E2E_CLINE_TEST_MODEL_ID,
						actModeClineModelId: E2E_CLINE_TEST_MODEL_ID,
						planModeClineModelInfo: E2E_CLINE_TEST_MODEL_INFO,
						actModeClineModelInfo: E2E_CLINE_TEST_MODEL_INFO,
					})
					controller.stateManager.setSessionOverride("planModeApiProvider", testProvider)
					controller.stateManager.setSessionOverride("actModeApiProvider", testProvider)
					controller.stateManager.setGlobalState("welcomeViewCompleted", true)
					controller.stateManager.setGlobalState("isNewUser", false)
					controller.stateManager.setGlobalState("taskHistory", E2E_SEEDED_TASK_HISTORY)
					await controller.postStateToWebview()
					res.writeHead(200, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ success: true }))
				} catch (error) {
					res.writeHead(500)
					res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
				}
			})()
			return
		}

		if (req.method === "POST" && req.url === "/seed-visible-command-approval") {
			readRequestBody()
				.then(async (body) => {
					try {
						const parsed = body ? JSON.parse(body) : {}
						const command = typeof parsed.command === "string" ? parsed.command : "git status --short"
						const { clineMessages, seededState, taskItem } = await createVisibleCommandApprovalSeed(
							controller,
							command,
						)

						await sendStateUpdate(seededState)
						await new Promise((resolve) => setTimeout(resolve, 250))
						await sendStateUpdate(seededState)

						res.writeHead(200, { "Content-Type": "application/json" })
						res.end(
							JSON.stringify({
								success: true,
								command,
								taskId: taskItem.id,
								messageCount: clineMessages.length,
								sandboxRuntime: seededState.compatibilityStatus?.sandboxRuntime,
							}),
						)
					} catch (error) {
						res.writeHead(500, { "Content-Type": "application/json" })
						res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }))
					}
				})
				.catch((error) => {
					res.writeHead(400, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ success: false, error: `Invalid JSON: ${error}` }))
				})
			return
		}

		if (req.method === "POST" && req.url === "/seed-browser-automation") {
			;(async () => {
				try {
					const { actions, clineMessages, seededState, taskItem, url } =
						await createVisibleBrowserAutomationSeed(controller)

					await sendStateUpdate(seededState)
					await new Promise((resolve) => setTimeout(resolve, 250))
					await sendStateUpdate(seededState)

					res.writeHead(200, { "Content-Type": "application/json" })
					res.end(
						JSON.stringify({
							success: true,
							actions,
							hasScreenshot: true,
							messageCount: clineMessages.length,
							taskId: taskItem.id,
							url,
						}),
					)
				} catch (error) {
					res.writeHead(500, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }))
				}
			})()
			return
		}

		if (req.method === "POST" && req.url === "/seed-plan-build-without-file") {
			;(async () => {
				try {
					const { clineMessages, response, seededState, taskItem } = await createVisiblePlanBuildSeed(controller)

					setE2EInitialStateOverride(seededState)
					await revealLegacyWebviewForTest()
					await sendStateUpdate(seededState)
					await new Promise((resolve) => setTimeout(resolve, 250))
					await sendStateUpdate(seededState)

					res.writeHead(200, { "Content-Type": "application/json" })
					res.end(
						JSON.stringify({
							success: true,
							messageCount: clineMessages.length,
							response,
							taskId: taskItem.id,
						}),
					)
				} catch (error) {
					res.writeHead(500, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }))
				}
			})()
			return
		}

		if (req.method === "POST" && req.url === "/open-file") {
			readRequestBody()
				.then(async (body) => {
					const { fileName } = JSON.parse(body)
					if (!fileName || typeof fileName !== "string") {
						res.writeHead(400)
						res.end(JSON.stringify({ error: "Missing fileName parameter" }))
						return
					}

					const workspaceRoots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? []
					const candidatePaths = path.isAbsolute(fileName)
						? [fileName]
						: workspaceRoots.map((workspaceRoot) => path.join(workspaceRoot, fileName))
					const filePath = candidatePaths.find((candidate) => fs.existsSync(candidate))

					if (!filePath) {
						res.writeHead(404)
						res.end(JSON.stringify({ error: "File not found", candidates: candidatePaths }))
						return
					}

					const webviewProvider = WebviewProvider.getInstance()
					;(webviewProvider as unknown as { closePanel?: () => void })?.closePanel?.()
					const editor = await vscode.window.showTextDocument(vscode.Uri.file(filePath), {
						preview: false,
						preserveFocus: false,
						viewColumn: vscode.ViewColumn.One,
					})
					const lastLineIndex = Math.max(editor.document.lineCount - 1, 0)
					const lastLine = editor.document.lineAt(lastLineIndex)
					const selection = new vscode.Selection(0, 0, lastLineIndex, lastLine.text.length)
					editor.selection = selection
					editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
					res.writeHead(200, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ success: true, filePath }))
				})
				.catch((error) => {
					res.writeHead(500)
					res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
				})
			return
		}

		if (req.method === "POST" && req.url === "/state/openai-codex/evaluate") {
			;(async () => {
			const previousCodexHome = process.env.CODEX_HOME
			const tempWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codevibe-e2e-codex-workspace-"))
			const codexHome = path.join(tempWorkspaceRoot, ".codex")
			const expiresAtSeconds = Math.floor(Date.now() / 1000) + 60 * 60
			let oauthManagerForCleanup: { clearCredentials: () => Promise<void> } | undefined
			const accessToken = createE2EOpenAiCodexJwt({
				exp: expiresAtSeconds,
				email: E2E_OPENAI_CODEX_EMAIL,
				"https://api.openai.com/auth": {
					chatgpt_account_id: E2E_OPENAI_CODEX_ACCOUNT_ID,
				},
				chatgpt_account_id: E2E_OPENAI_CODEX_ACCOUNT_ID,
			})
			const refreshToken = "refresh_codevibe_e2e_codex"

			try {
				fs.mkdirSync(codexHome, { recursive: true })
				fs.writeFileSync(
					path.join(codexHome, "auth.json"),
					JSON.stringify(
						{
							auth_mode: "chatgpt",
							tokens: {
								access_token: accessToken,
								refresh_token: refreshToken,
								account_id: E2E_OPENAI_CODEX_ACCOUNT_ID,
							},
						},
						null,
						2,
					),
					"utf8",
				)
				fs.writeFileSync(path.join(codexHome, "installation_id"), E2E_OPENAI_CODEX_INSTALLATION_ID, "utf8")
				fs.writeFileSync(
					path.join(codexHome, "models_cache.json"),
					JSON.stringify({ client_version: "0.136.0-e2e" }, null, 2),
					"utf8",
				)

				process.env.CODEX_HOME = codexHome
				const { openAiCodexOAuthManager } = await import("@/integrations/openai-codex/oauth")
				oauthManagerForCleanup = openAiCodexOAuthManager
				await openAiCodexOAuthManager.clearCredentials()

				const currentApiConfiguration = controller.stateManager.getApiConfiguration()
				controller.stateManager.setApiConfiguration({
					...currentApiConfiguration,
					planModeApiProvider: DEFAULT_API_PROVIDER,
					actModeApiProvider: DEFAULT_API_PROVIDER,
					planModeApiModelId: openAiCodexDefaultModelId,
					actModeApiModelId: openAiCodexDefaultModelId,
				})
				controller.stateManager.setSessionOverride("planModeApiProvider", DEFAULT_API_PROVIDER)
				controller.stateManager.setSessionOverride("actModeApiProvider", DEFAULT_API_PROVIDER)

				const state = await controller.getStateToPostToWebview({
					skipOpenAiCodexBackendModelsRefresh: true,
				})
				const credentials = openAiCodexOAuthManager.getCredentials()
				const payload = {
					success: true,
					defaultApiProvider: DEFAULT_API_PROVIDER,
					apiConfiguration: {
						planModeApiProvider: state.apiConfiguration?.planModeApiProvider,
						actModeApiProvider: state.apiConfiguration?.actModeApiProvider,
						planModeApiModelId: state.apiConfiguration?.planModeApiModelId,
						actModeApiModelId: state.apiConfiguration?.actModeApiModelId,
					},
					openAiCodexIsAuthenticated: state.openAiCodexIsAuthenticated,
					compatibilityStatus: {
						openAiCodexAuthSource: state.compatibilityStatus?.openAiCodexAuthSource,
						openAiCodexAuthenticated: state.compatibilityStatus?.openAiCodexAuthenticated,
					},
					credentials: credentials
						? {
								tokenSource: credentials.tokenSource,
								authMode: credentials.authMode,
								email: credentials.email,
								accountId: credentials.accountId,
								installationId: credentials.installationId,
								clientVersion: credentials.clientVersion,
								hasAccessToken: Boolean(credentials.access_token),
								hasRefreshToken: Boolean(credentials.refresh_token),
							}
						: undefined,
					models: {
						defaultModelId: openAiCodexDefaultModelId,
						bundledModelCount: Object.keys(openAiCodexModels).length,
						includesDefaultModel: Boolean(openAiCodexModels[openAiCodexDefaultModelId]),
					},
					authJsonRelativePath: ".codex/auth.json",
				}
				const serializedPayload = JSON.stringify(payload)

				await openAiCodexOAuthManager.clearCredentials()
				res.writeHead(200, { "Content-Type": "application/json" })
				res.end(
					JSON.stringify({
						...payload,
						secretLeakInPayload:
							serializedPayload.includes(accessToken) || serializedPayload.includes(refreshToken),
					}),
				)
			} catch (error) {
				res.writeHead(500, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }))
			} finally {
				if (previousCodexHome === undefined) {
					delete process.env.CODEX_HOME
				} else {
					process.env.CODEX_HOME = previousCodexHome
				}
				fs.rmSync(tempWorkspaceRoot, { recursive: true, force: true })
				await oauthManagerForCleanup?.clearCredentials().catch(() => undefined)
			}
			})().catch((error) => {
				if (!res.headersSent) {
					res.writeHead(500, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }))
				}
			})
			return
		}

		if (req.method === "POST" && req.url === "/native-agent/diagnostics") {
			try {
				if (!hooks.getNativeAgentDiagnostics) {
					res.writeHead(404, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ success: false, error: "Native agent diagnostics hook is not registered" }))
					return
				}

				const diagnosticsResult = hooks.getNativeAgentDiagnostics()
				const diagnosticsPayload =
					diagnosticsResult &&
					typeof diagnosticsResult === "object" &&
					"diagnostics" in diagnosticsResult
						? diagnosticsResult
						: { diagnostics: diagnosticsResult }
				res.writeHead(200, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ success: true, ...diagnosticsPayload }))
			} catch (error) {
				res.writeHead(500, { "Content-Type": "application/json" })
				res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }))
			}
			return
		}

		if (req.method === "POST" && req.url === "/native-agent/open") {
			readRequestBody()
				.then(async (body) => {
					try {
						if (!hooks.openNativeAgentSession) {
							res.writeHead(404, { "Content-Type": "application/json" })
							res.end(JSON.stringify({ success: false, error: "Native agent open hook is not registered" }))
							return
						}

						const parsed = body ? JSON.parse(body) : {}
						const position = parsed.position === "editor" ? "editor" : "sidebar"
						const result = await hooks.openNativeAgentSession(position)
						res.writeHead(200, { "Content-Type": "application/json" })
						res.end(JSON.stringify({ success: true, result }))
					} catch (error) {
						res.writeHead(500, { "Content-Type": "application/json" })
						res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }))
					}
				})
				.catch((error) => {
					res.writeHead(400, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ success: false, error: `Invalid JSON: ${error}` }))
				})
			return
		}

		if (req.method === "POST" && req.url === "/workspace/search-text") {
			readRequestBody()
				.then(async (body) => {
					const searchRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codevibe-e2e-search-"))
					const nativeWorkspace = vscode.workspace as typeof vscode.workspace & {
						findTextInFiles?: (...args: any[]) => PromiseLike<unknown>
						findFiles?: (...args: any[]) => PromiseLike<vscode.Uri[]>
					}
					const workspaceFs = vscode.workspace.fs as typeof vscode.workspace.fs & {
						readFile?: (...args: any[]) => PromiseLike<Uint8Array>
					}
					const originalFindTextInFiles = nativeWorkspace.findTextInFiles
					const originalFindFiles = nativeWorkspace.findFiles
					const originalReadFile = workspaceFs.readFile
					let nativeFindTextInFilesCalls = 0
					let fallbackFindFilesCalls = 0
					let fallbackReadFileCalls = 0

					try {
						const parsed = body ? JSON.parse(body) : {}
						const files = Array.isArray(parsed.files) && parsed.files.length > 0 ? parsed.files : []
						const corpus =
							files.length > 0
								? files
								: [
										{
											relativePath: "src/search-target.ts",
											content:
												"const before = false\nexport const installedSearchNeedle = true\nconst after = true\n",
										},
										{
											relativePath: "src/no-match.ts",
											content: "export const nearby = false\n",
										},
									]

						for (const file of corpus) {
							const relativePath =
								typeof file?.relativePath === "string" && file.relativePath.trim()
									? path.normalize(file.relativePath)
									: undefined
							if (!relativePath || path.isAbsolute(relativePath) || relativePath.startsWith("..")) {
								throw new Error(`Invalid relativePath for search corpus: ${String(file?.relativePath)}`)
							}
							const filePath = path.join(searchRoot, relativePath)
							await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
							await fs.promises.writeFile(filePath, typeof file.content === "string" ? file.content : "", "utf8")
						}

						if (originalFindTextInFiles) {
							nativeWorkspace.findTextInFiles = (...args: any[]) => {
								nativeFindTextInFilesCalls++
								return originalFindTextInFiles.apply(vscode.workspace, args)
							}
						}
						if (originalFindFiles) {
							nativeWorkspace.findFiles = (...args: any[]) => {
								fallbackFindFilesCalls++
								return originalFindFiles.apply(vscode.workspace, args)
							}
						}
						if (originalReadFile) {
							workspaceFs.readFile = (...args: any[]) => {
								fallbackReadFileCalls++
								return originalReadFile.apply(vscode.workspace.fs, args)
							}
						}

						const searchResponse = await searchWorkspaceText(
							SearchWorkspaceTextRequest.create({
								regex: typeof parsed.regex === "string" ? parsed.regex : "installedSearchNeedle",
								filePattern: typeof parsed.filePattern === "string" ? parsed.filePattern : "*.ts",
								workspacePath: searchRoot,
								directoryPath: searchRoot,
								maxResults: Number.isFinite(Number(parsed.maxResults)) ? Number(parsed.maxResults) : 10,
								includeIgnored: parsed.includeIgnored === true,
							}),
						)

						res.writeHead(200, { "Content-Type": "application/json" })
						res.end(
							JSON.stringify({
								success: true,
								nativeTextSearchAvailable: typeof originalFindTextInFiles === "function",
								nativeFindTextInFilesCalls,
								fallbackFindFilesCalls,
								fallbackReadFileCalls,
								matches: searchResponse.matches,
								limitHit: searchResponse.limitHit,
							}),
						)
					} catch (error) {
						res.writeHead(500, { "Content-Type": "application/json" })
						res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }))
					} finally {
						if (originalFindTextInFiles) {
							nativeWorkspace.findTextInFiles = originalFindTextInFiles
						}
						if (originalFindFiles) {
							nativeWorkspace.findFiles = originalFindFiles
						}
						if (originalReadFile) {
							workspaceFs.readFile = originalReadFile
						}
						await fs.promises.rm(searchRoot, { recursive: true, force: true }).catch(() => undefined)
					}
				})
				.catch((error) => {
					res.writeHead(400, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ success: false, error: `Invalid JSON: ${error}` }))
				})
			return
		}

		if (req.method === "POST" && req.url === "/native-agent/request") {
			readRequestBody()
				.then(async (body) => {
					try {
						if (!hooks.invokeNativeAgentRequest) {
							res.writeHead(404, { "Content-Type": "application/json" })
							res.end(JSON.stringify({ success: false, error: "Native agent request hook is not registered" }))
							return
						}

						const parsed = body ? JSON.parse(body) : {}
						const input: TestServerNativeAgentRequestInput = {
							command: typeof parsed.command === "string" ? parsed.command : undefined,
							prompt: typeof parsed.prompt === "string" ? parsed.prompt : undefined,
						}
						const result = await hooks.invokeNativeAgentRequest(input)
						res.writeHead(200, { "Content-Type": "application/json" })
						res.end(JSON.stringify({ success: true, ...result }))
					} catch (error) {
						res.writeHead(500, { "Content-Type": "application/json" })
						res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }))
					}
				})
				.catch((error) => {
					res.writeHead(400, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ success: false, error: `Invalid JSON: ${error}` }))
				})
			return
		}

		if (req.method === "POST" && req.url === "/plans/create") {
			readRequestBody()
				.then(async (body) => {
					try {
						const parsed = body ? JSON.parse(body) : {}
						const response = typeof parsed.response === "string" ? parsed.response : "## E2E Plan\n\nCreated by test mode."
						const taskProgress = typeof parsed.taskProgress === "string" ? parsed.taskProgress : "- [ ] Inspect\n- [ ] Verify"
						const composerId = typeof parsed.composerId === "string" ? parsed.composerId : `e2e-plan-${Date.now()}`
						const workspacePath = await getCwd()
						const plan = await getPlanStorageService().createOrUpdatePlanForComposer({
							composerId,
							response,
							taskProgress,
							workspacePath,
						})
						res.writeHead(200, { "Content-Type": "application/json" })
						res.end(
							JSON.stringify({
								success: true,
								plan: {
									planId: plan.planId,
									planPath: plan.planPath,
									status: plan.status,
									buildStatus: plan.buildStatus,
									todoCount: plan.todoCount,
									completedTodoCount: plan.completedTodoCount,
									metadata: plan.metadata,
									body: plan.body,
								},
							}),
						)
					} catch (error) {
						res.writeHead(500, { "Content-Type": "application/json" })
						res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }))
					}
				})
				.catch((error) => {
					res.writeHead(400, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ success: false, error: `Invalid JSON: ${error}` }))
				})
			return
		}

			if (req.method === "POST" && req.url === "/plans/open-latest") {
				;(async () => {
					try {
						await vscode.commands.executeCommand(ExtensionRegistryInfo.commands.PlansOpenLatest)
						const latestPlan = (await getPlanStorageService().listPlans(await getCwd()))[0]
						const findPlanEditorTab = () => {
							for (const group of vscode.window.tabGroups.all) {
								for (const tab of group.tabs) {
									const input = tab.input as { uri?: vscode.Uri; viewType?: string } | undefined
									if (
										input?.viewType === "codevibe.planEditor" &&
										(!latestPlan?.uri || input.uri?.fsPath === latestPlan.uri)
									) {
										return { tab, input }
									}
								}
							}
							return undefined
						}
						let planEditorTab = findPlanEditorTab()
						const startedAt = Date.now()
						while (!planEditorTab && Date.now() - startedAt < 5_000) {
							await new Promise((resolve) => setTimeout(resolve, 250))
							planEditorTab = findPlanEditorTab()
						}
						const actualActiveTab = vscode.window.tabGroups.activeTabGroup.activeTab
						const activeTab = planEditorTab?.tab ?? actualActiveTab
						const input =
							planEditorTab?.input ?? (actualActiveTab?.input as { uri?: vscode.Uri; viewType?: string } | undefined)
						const editorAssociations =
							vscode.workspace.getConfiguration("workbench").get<Record<string, string>>("editorAssociations") ?? {}
					const packageJson = vscode.extensions.getExtension(ExtensionRegistryInfo.id)?.packageJSON as
						| { contributes?: { configurationDefaults?: { "workbench.editorAssociations"?: Record<string, string> } } }
						| undefined
					const manifestPlanEditorAssociation =
						packageJson?.contributes?.configurationDefaults?.["workbench.editorAssociations"]?.["*.plan.md"]
					const planText = latestPlan?.uri ? await fs.promises.readFile(latestPlan.uri, "utf8").catch(() => "") : ""
					const hasMermaid = /```mermaid\b/i.test(planText)
					const hasFrontmatterTodos = /^---[\s\S]*\ntodos:/m.test(planText)
					res.writeHead(200, { "Content-Type": "application/json" })
					res.end(
						JSON.stringify({
							success: true,
							latestPlan,
							activeTab: activeTab
								? {
										label: activeTab.label,
										inputUri: input?.uri?.fsPath,
										inputViewType: input?.viewType,
									}
								: undefined,
							planEditor: {
								editorAssociation: editorAssociations["*.plan.md"] || manifestPlanEditorAssociation,
								usesCustomEditor: input?.viewType === "codevibe.planEditor",
								renderedCanvasExpected: input?.viewType === "codevibe.planEditor",
								hasLocalBuildActions: true,
								hasBuildSelectedAction: true,
								hasParallelBuildAction: true,
								hasCloudBuildAction: false,
								hasMermaid,
								hasFrontmatterTodos,
							},
						}),
					)
				} catch (error) {
					res.writeHead(500, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }))
				}
			})()
			return
		}

		if (req.method === "POST" && req.url === "/compatibility/deeplinks/evaluate") {
			;(async () => {
				const originalWindowDescriptor = Object.getOwnPropertyDescriptor(HostProvider, "window")
				const messageLog: Array<{
					type?: string | number
					message?: string
					items?: string[]
					detail?: string
					selectedOption?: string
				}> = []
				const openSettingsCalls: unknown[] = []
				const openFileCalls: unknown[] = []
				const calls = {
					tasks: [] as Array<{ preview: string; hasCompatibleContext: boolean }>,
					mcpAdds: [] as Array<{ serverName: string; type?: unknown; hasUrl: boolean; hasSecretConfig: boolean }>,
					oauthInitiations: [] as string[],
					oauthCallbacks: [] as Array<{ serverHash: string; code: string; state: string }>,
					backgroundLaunches: [] as Array<{
						prompt?: string
						repository?: string
						requestedBranch?: string
						hasRoutePrompt: boolean
					}>,
					automationIngests: [] as Array<{ eventCount: number; strict?: boolean; hasRoutePrompt: boolean }>,
					pluginAdds: [] as Array<{ sourceParam?: string; force?: boolean; detailMentionsReplace: boolean }>,
					prReviewTasks: 0,
					postStateCalls: 0,
				}

				const selectedOptionFor = (message: string | undefined, items: string[] = []): string | undefined => {
					if (items.includes("Install")) {
						return "Install"
					}
					if (items.includes("Authenticate")) {
						return "Authenticate"
					}
					if (items.includes("Launch and Create Worktree")) {
						return "Launch and Create Worktree"
					}
					if (items.includes("Ingest Events")) {
						return "Ingest Events"
					}
					if (items.includes("Install Plugin")) {
						return "Install Plugin"
					}
					if (items.includes("Start Review")) {
						return "Start Review"
					}
					if (items.includes("Create Task")) {
						return "Create Task"
					}
					if (items.includes("OK")) {
						return "OK"
					}
					if (message?.startsWith("Create or open rule")) {
						return undefined
					}
					return undefined
				}

				const fakeWindow = {
					showMessage: async (request: {
						type?: string | number
						message?: string
						options?: { items?: string[]; detail?: string }
					}) => {
						const items = request.options?.items ?? []
						const selectedOption = selectedOptionFor(request.message, items)
						messageLog.push({
							type: request.type,
							message: request.message,
							items,
							detail: request.options?.detail,
							selectedOption,
						})
						return { selectedOption }
					},
					openSettings: async (request: unknown) => {
						openSettingsCalls.push(request)
					},
					openFile: async (request: unknown) => {
						openFileCalls.push(request)
					},
				}

				Object.defineProperty(HostProvider, "window", {
					configurable: true,
					get: () => fakeWindow,
				})

				try {
					const controllerStub = {
						handleOpenRouterCallback: async () => undefined,
						handleRequestyCallback: async () => undefined,
						handleAuthCallback: async () => undefined,
						handleOcaAuthCallback: async () => undefined,
						handleHicapCallback: async () => undefined,
						handleTaskCreation: async (prompt: string) => {
							if (prompt.includes("Codie's review workflow")) {
								calls.prReviewTasks += 1
							}
							calls.tasks.push({
								preview: prompt.slice(0, 160),
								hasCompatibleContext: prompt.includes("Compatible route context"),
							})
						},
						handleMcpOAuthCallback: async (serverHash: string, code: string, state: string) => {
							calls.oauthCallbacks.push({ serverHash, code, state })
						},
						handleCursorAutomationIngest: async (request: unknown) => {
							const typed = request as {
								strict?: boolean
								validation?: { events?: unknown[] }
								routePrompt?: string
							}
							calls.automationIngests.push({
								eventCount: typed.validation?.events?.length ?? 0,
								strict: typed.strict,
								hasRoutePrompt: typed.routePrompt?.includes("automation NDJSON ingest deeplink") === true,
							})
						},
						handleCursorBackgroundAgentLaunch: async (request: unknown) => {
							const typed = request as {
								prompt?: string
								repository?: string
								requestedBranch?: string
								routePrompt?: string
							}
							calls.backgroundLaunches.push({
								prompt: typed.prompt,
								repository: typed.repository,
								requestedBranch: typed.requestedBranch,
								hasRoutePrompt: typed.routePrompt?.includes("compatible background agent deeplink") === true,
							})
						},
						handleCursorPluginAdd: async (request: unknown) => {
							const typed = request as { sourceParam?: string; force?: boolean; detail?: string }
							calls.pluginAdds.push({
								sourceParam: typed.sourceParam,
								force: typed.force,
								detailMentionsReplace: typed.detail?.includes("Replace existing: requested") === true,
							})
						},
						postStateToWebview: async () => {
							calls.postStateCalls += 1
						},
						mcpHub: {
							addServerFromConfig: async (serverName: string, serverConfig: Record<string, unknown>) => {
								calls.mcpAdds.push({
									serverName,
									type: serverConfig.type,
									hasUrl: typeof serverConfig.url === "string",
									hasSecretConfig: JSON.stringify(serverConfig).includes("secret-value"),
								})
								return [
									{
										name: serverName,
										config: JSON.stringify(serverConfig),
										status: "disconnected",
										error: "Authenticate this MCP server before using tools.",
										oauthRequired: true,
										oauthAuthStatus: "unauthenticated",
									},
								]
							},
							initiateOAuth: async (serverName: string) => {
								calls.oauthInitiations.push(serverName)
							},
						},
					} as unknown as Parameters<typeof SharedUriHandler.handleUriWithController>[0]

					const routeResults: Record<string, boolean> = {}
					const runRoute = async (
						name: string,
						url: string,
						options?: Parameters<typeof SharedUriHandler.handleUriWithController>[2],
					) => {
						routeResults[name] = await SharedUriHandler.handleUriWithController(controllerStub, url, options)
					}

					const encodeConfig = (value: unknown) =>
						Buffer.from(JSON.stringify(value), "utf8")
							.toString("base64")
							.replace(/\+/g, "-")
							.replace(/\//g, "_")
							.replace(/=+$/g, "")
					const secretConfig = encodeConfig({ mode: "fast", token: "secret-value" })
					const automationNdjson = encodeURIComponent(
						JSON.stringify({
							eventId: "evt-1",
							eventType: "git.commit.created",
							source: "cursor",
							payload: { token: "secret-value" },
						}),
					)

					await runRoute("createchat", "vscode://atnumridha.codevibe/createchat?prompt=Review%20the%20plan")
					await runRoute("prompt", "cursor://prompt?text=Draft%20a%20local%20plan")
					await runRoute("glass", `codevibe://glass?text=Continue%20this%20session&config=${secretConfig}`)
					await runRoute("command", "vscode://atnumridha.codevibe/command?name=review-code")
					await runRoute(
						"mcpInstall",
						"vscode://atnumridha.codevibe/mcp/install?name=docs&url=https%3A%2F%2Fmcp.example.com%2Fsse%3Ftoken%3Dsecret-value",
					)
					await runRoute(
						"backgroundAgent",
						`vscode://atnumridha.codevibe/background-agent?task=Fix%20the%20queue&repository=owner%2Frepo&branch=main&config=${secretConfig}`,
					)
					await runRoute(
						"automationIngest",
						`vscode://atnumridha.codevibe/automation/ingest?ndjson=${automationNdjson}&defaultSource=cursor`,
					)
					await runRoute("settings", "cursor://settings?section=safe-browser-evaluate")
					await runRoute("pluginAdd", "vscode://atnumridha.codevibe/plugin/add?id=docs-helper")
					await runRoute("pluginReplace", "vscode://atnumridha.codevibe/plugin/add?id=docs-helper&replace=true")
					await runRoute(
						"prReview",
						"vscode://atnumridha.codevibe/pr-review?repo=owner%2Frepo&number=42&base=origin%2Fmain&head=pr-42&instructions=focus%20tests",
					)
					await runRoute("rulePreview", "vscode://atnumridha.codevibe/rule?name=team-style")
					await runRoute("gitCheckoutPreview", "vscode://atnumridha.codevibe/git/checkout?branch=main")
					await runRoute("gitBranchPreview", "vscode://atnumridha.codevibe/git/branch?name=feature%2Fcodie-route&base=main")
					await runRoute("gitCommitPreview", "vscode://atnumridha.codevibe/git/commit?message=fix%3A%20route%20preview")
					await runRoute("mcpOAuthCallback", "vscode://atnumridha.codevibe/mcp-auth/callback/hash123?code=code123&state=state123")
					await runRoute("disabledCreatechat", "vscode://atnumridha.codevibe/createchat?prompt=Blocked", {
						cursorCompatibleDeepLinksEnabled: false,
					})

					const serializedMessages = JSON.stringify(messageLog)

					res.writeHead(200, { "Content-Type": "application/json" })
					res.end(
						JSON.stringify({
							success: true,
							routeResults,
							messages: messageLog,
							openSettingsCalls,
							openFileCalls,
							calls,
							secretLeakInMessages:
								serializedMessages.includes("secret-value") || serializedMessages.includes("secret-fragment"),
						}),
					)
				} catch (error) {
					res.writeHead(500, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }))
				} finally {
					if (originalWindowDescriptor) {
						Object.defineProperty(HostProvider, "window", originalWindowDescriptor)
					} else {
						Reflect.deleteProperty(HostProvider, "window")
					}
				}
			})()
			return
		}

		if (req.method === "POST" && req.url === "/sandbox/evaluate") {
			readRequestBody()
				.then(async (body) => {
					const sandboxRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codevibe-e2e-sandbox-"))
					const savedPrimaryPermissions = process.env[COMMAND_PERMISSIONS_ENV_VAR]
					const savedLegacyPermissions = process.env[LEGACY_COMMAND_PERMISSIONS_ENV_VAR]
					delete process.env[COMMAND_PERMISSIONS_ENV_VAR]
					delete process.env[LEGACY_COMMAND_PERMISSIONS_ENV_VAR]

					try {
						const parsed = body ? JSON.parse(body) : {}
						const config =
							parsed && typeof parsed.config === "object" && parsed.config
								? parsed.config
								: {
										type: "workspace_readonly",
										blockGitWrites: true,
										networkPolicy: { default: "deny", allow: [] },
									}
						const cursorConfigDir = path.join(sandboxRoot, ".cursor")
						const cursorConfigPath = path.join(cursorConfigDir, "sandbox.json")
						await fs.promises.mkdir(cursorConfigDir, { recursive: true })
						await fs.promises.writeFile(cursorConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")

						const policy = await resolveCursorSandboxPolicy({
							workspaceRoot: sandboxRoot,
							policySetting: typeof parsed.policySetting === "string" ? parsed.policySetting : "workspace",
						})
						if (!policy) {
							throw new Error("Expected installed sandbox policy to load from .cursor/sandbox.json")
						}

						const sandboxController = new CommandPermissionController(policy.commandPermissions)
						const elevatedController = new CommandPermissionController()
						const evaluate = (command: string) => ({
							sandboxed: sandboxController.validateCommand(command),
							elevated: elevatedController.validateCommand(command),
						})
						const inlineRequests = {
							sandboxed: resolveInlineTerminalRequest("npm test", { sandboxPermissionsRaw: "sandboxed" }),
							unelevated: resolveInlineTerminalRequest("npm test", { sandboxPermissionsRaw: "unelevated" }),
							requireEscalated: resolveInlineTerminalRequest("npm install left-pad", {
								sandboxPermissionsRaw: "require_escalated",
							}),
							booleanEscalated: resolveInlineTerminalRequest("npm install left-pad", {
								requireEscalatedRaw: "true",
							}),
						}

						res.writeHead(200, { "Content-Type": "application/json" })
						res.end(
							JSON.stringify({
								success: true,
								policy: {
									status: policy.status,
									configSource: policy.configSource,
									configPath: policy.configPath,
									configPathRelative: path.relative(sandboxRoot, policy.configPath).split(path.sep).join("/"),
									effectiveAccess: policy.effectiveAccess,
									allowReadAutoApprove: policy.allowReadAutoApprove,
									allowWriteAutoApprove: policy.allowWriteAutoApprove,
									allowTerminalAutoApprove: policy.allowTerminalAutoApprove,
									allowNetworkAutoApprove: policy.allowNetworkAutoApprove,
									commandPermissions: {
										allow: policy.commandPermissions?.allow ?? [],
										deny: policy.commandPermissions?.deny ?? [],
										allowRedirects: policy.commandPermissions?.allowRedirects,
									},
								},
								defaultRunModes: {
									withSandboxPolicy: getDefaultTerminalRunMode(Boolean(policy)),
									withoutSandboxPolicy: getDefaultTerminalRunMode(false),
								},
								commands: {
									readOnly: evaluate("git diff"),
									mutating: evaluate("npm install left-pad"),
									gitWrite: evaluate("git commit -m test"),
									redirect: evaluate("cat package.json > /tmp/codie-sandbox-test.txt"),
								},
								inlineRequests,
							}),
						)
					} catch (error) {
						res.writeHead(500, { "Content-Type": "application/json" })
						res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }))
					} finally {
						if (savedPrimaryPermissions === undefined) {
							delete process.env[COMMAND_PERMISSIONS_ENV_VAR]
						} else {
							process.env[COMMAND_PERMISSIONS_ENV_VAR] = savedPrimaryPermissions
						}
						if (savedLegacyPermissions === undefined) {
							delete process.env[LEGACY_COMMAND_PERMISSIONS_ENV_VAR]
						} else {
							process.env[LEGACY_COMMAND_PERMISSIONS_ENV_VAR] = savedLegacyPermissions
						}
						await fs.promises.rm(sandboxRoot, { recursive: true, force: true }).catch(() => undefined)
					}
				})
				.catch((error) => {
					res.writeHead(400, { "Content-Type": "application/json" })
					res.end(JSON.stringify({ success: false, error: `Invalid JSON: ${error}` }))
				})
			return
		}

		// Only handle POST requests to /task
		if (req.method !== "POST" || req.url !== "/task") {
			res.writeHead(404)
			res.end(JSON.stringify({ error: "Not found" }))
			return
		}

		readRequestBody().then(async (body) => {
			try {
				// Parse the JSON body
				const { task, apiKey } = JSON.parse(body)

				if (!task) {
					res.writeHead(400)
					res.end(JSON.stringify({ error: "Missing task parameter" }))
					return
				}

				// Get a visible webview instance
				const visibleWebview = WebviewProvider.getVisibleInstance()
				if (!visibleWebview || !visibleWebview.controller) {
					res.writeHead(500)
					res.end(JSON.stringify({ error: "No active CodeVibe instance found" }))
					return
				}

				// Initiate a new task
				Logger.log(`Test server initiating task: ${task}`)

				try {
					// Get and validate the workspace path
					const workspacePath = await getCwd()
					Logger.log(`Using workspace path: ${workspacePath}`)

					// Validate workspace path before proceeding with any operations
					try {
						await validateWorkspacePath(workspacePath)
					} catch (error) {
						Logger.log(`Workspace validation failed: ${error.message}`)
						res.writeHead(500)
						res.end(
							JSON.stringify({
								error: `Workspace validation failed: ${error.message}. Please open a workspace folder in VSCode before running the test.`,
								workspacePath,
							}),
						)
						return
					}

					// Initialize Git repository before starting the task
					try {
						const wasNewlyInitialized = await initializeGitRepository(workspacePath)
						if (wasNewlyInitialized) {
							Logger.log(`Initialized new Git repository in ${workspacePath} before task start`)
						} else {
							Logger.log(`Using existing Git repository in ${workspacePath} before task start`)
						}

						// Log directory contents before task start
						try {
							const { stdout: lsOutput } = await execa("ls", ["-la", workspacePath])
							Logger.log(`Directory contents before task start:\n${lsOutput}`)
						} catch (lsError) {
							Logger.log(`Warning: Failed to list directory contents: ${lsError.message}`)
						}
					} catch (gitError) {
						Logger.log(`Warning: Git initialization failed: ${gitError.message}`)
						Logger.log("Continuing without Git initialization")
					}

					// Clear any existing task
					await visibleWebview.controller.clearTask()

					// If API key is provided, update the API configuration
					if (apiKey) {
						Logger.log("API key provided, updating API configuration")

						// Get current API configuration
						const apiConfiguration = visibleWebview.controller.stateManager.getApiConfiguration()

						// Update API configuration with API key
						const updatedConfig = {
							...apiConfiguration,
							apiProvider: "cline" as ApiProvider,
							clineAccountId: E2E_CLINE_TEST_ACCOUNT_ID,
							clineApiKey: apiKey,
							planModeClineModelId: E2E_CLINE_TEST_MODEL_ID,
							actModeClineModelId: E2E_CLINE_TEST_MODEL_ID,
							planModeClineModelInfo: E2E_CLINE_TEST_MODEL_INFO,
							actModeClineModelInfo: E2E_CLINE_TEST_MODEL_INFO,
						}

						// Store the API key securely
						visibleWebview.controller.stateManager.setSecret("clineAccountId", E2E_CLINE_TEST_ACCOUNT_ID)
						visibleWebview.controller.stateManager.setSecret("clineApiKey", apiKey)

						visibleWebview.controller.stateManager.setApiConfiguration(updatedConfig)

						// Update cache service to use cline provider
						const currentConfig = visibleWebview.controller.stateManager.getApiConfiguration()
						visibleWebview.controller.stateManager.setApiConfiguration({
							...currentConfig,
							planModeApiProvider: "cline",
							actModeApiProvider: "cline",
						})

						// Post state to webview to reflect changes
						await visibleWebview.controller.postStateToWebview()
					}

					// Ensure we're in Act mode before initiating the task
					const { mode } = await visibleWebview.controller.getStateToPostToWebview()
					if (mode === "plan") {
						// Switch to Act mode if currently in Plan mode
						await visibleWebview.controller.togglePlanActMode("act")
					}

					// Initialize tool call tracker
					const toolTracker = createToolCallTracker()

					// Record task start time
					const taskStartTime = Date.now()

					// Initiate the new task
					const result = await visibleWebview.controller.initTask(task)

					// Try to get the task ID directly from the result or from the state
					let taskId: string | undefined

					if (typeof result === "string") {
						// If initTask returns the task ID directly
						taskId = result
					} else {
						// Wait a moment for the state to update
						await new Promise((resolve) => setTimeout(resolve, 1000))

						// Try to get the task ID from the controller's state
						const state = await visibleWebview.controller.getStateToPostToWebview()
						taskId = state.currentTaskItem?.id

						// If still not found, try polling a few times
						if (!taskId) {
							for (let i = 0; i < 5; i++) {
								await new Promise((resolve) => setTimeout(resolve, 500))
								const updatedState = await visibleWebview.controller.getStateToPostToWebview()
								taskId = updatedState.currentTaskItem?.id
								if (taskId) {
									break
								}
							}
						}
					}

					if (!taskId) {
						throw new Error("Failed to get task ID after initiating task")
					}

					Logger.log(`Task initiated with ID: ${taskId}`)

					// Create a completion tracker for this task
					const completionPromise = createTaskCompletionTracker()

					// Wait for the task to complete with a timeout
					const timeoutPromise = new Promise<void>((_, reject) => {
						setTimeout(() => reject(new Error("Task completion timeout")), 15 * 60 * 1000) // 15 minute timeout
					})

					try {
						// Wait for either completion or timeout
						await Promise.race([completionPromise, timeoutPromise])

						// Get task history and metrics
						const taskHistory = await visibleWebview.controller.getStateToPostToWebview()
						const taskData = taskHistory.taskHistory?.find((t: HistoryItem) => t.id === taskId)

						// Get messages and API conversation history
						let messages: any[] = []
						let apiConversationHistory: any[] = []
						try {
							if (typeof taskId === "string") {
								messages = await getSavedClineMessages(taskId)
							}
						} catch (error) {
							Logger.log(`Error getting saved CodeVibe messages: ${error}`)
						}

						try {
							if (typeof taskId === "string") {
								apiConversationHistory = await getSavedApiConversationHistory(taskId)
							}
						} catch (error) {
							Logger.log(`Error getting saved API conversation history: ${error}`)
						}

						// Get file changes
						let fileChanges
						try {
							// Get the workspace path using our helper function
							const workspacePath = await getCwd()
							Logger.log(`Getting file changes from workspace path: ${workspacePath}`)

							// Log directory contents for debugging
							try {
								const { stdout: lsOutput } = await execa("ls", ["-la", workspacePath])
								Logger.log(`Directory contents after task completion:\n${lsOutput}`)
							} catch (lsError) {
								Logger.log(`Warning: Failed to list directory contents: ${lsError.message}`)
							}

							// Get file changes using Git
							fileChanges = await getFileChanges(workspacePath)

							// If no changes were detected, use a fallback method
							if (!fileChanges.created.length && !fileChanges.modified.length && !fileChanges.deleted.length) {
								Logger.log("No changes detected by Git, using fallback directory scan")

								// Try to get a list of all files in the directory
								try {
									const { stdout: findOutput } = await execa("find", [
										workspacePath,
										"-type",
										"f",
										"-not",
										"-path",
										"*/.*",
										"-not",
										"-path",
										"*/node_modules/*",
									])
									const files = findOutput.split("\n").filter(Boolean)

									// Add all files as "created" since we can't determine which ones are new
									fileChanges.created = files.map((file) => path.relative(workspacePath, file))
									Logger.log(`Fallback found ${fileChanges.created.length} files`)
								} catch (findError) {
									Logger.log(`Warning: Fallback directory scan failed: ${findError.message}`)
								}
							}
						} catch (fileChangeError) {
							Logger.log(`Error getting file changes: ${fileChangeError.message}`)
							throw new Error(`Error getting file changes: ${fileChangeError.message}`)
						}

						// Get tool metrics
						const toolMetrics = {
							toolCalls: toolTracker.toolCalls,
							toolFailures: toolTracker.toolFailures,
							totalToolCalls: Object.values(toolTracker.toolCalls).reduce((a, b) => a + b, 0),
							totalToolFailures: Object.values(toolTracker.toolFailures).reduce((a, b) => a + b, 0),
							toolSuccessRate: calculateToolSuccessRate(toolTracker.toolCalls, toolTracker.toolFailures),
						}

						// Calculate task duration
						const taskDuration = Date.now() - taskStartTime

						// Return comprehensive response with all metrics and data
						res.writeHead(200, { "Content-Type": "application/json" })
						res.end(
							JSON.stringify({
								success: true,
								taskId,
								completed: true,
								metrics: {
									tokensIn: taskData?.tokensIn || 0,
									tokensOut: taskData?.tokensOut || 0,
									cost: taskData?.totalCost || 0,
									duration: taskDuration,
									...toolMetrics,
								},
								messages,
								apiConversationHistory,
								files: fileChanges,
							}),
						)
					} catch (_timeoutError) {
						// Task didn't complete within the timeout period
						res.writeHead(200, { "Content-Type": "application/json" })
						res.end(
							JSON.stringify({
								success: true,
								taskId,
								completed: false,
								timeout: true,
							}),
						)
					}
				} catch (error) {
					Logger.log(`Error initiating task: ${error}`)
					res.writeHead(500)
					res.end(JSON.stringify({ error: `Failed to initiate task: ${error}` }))
				}
			} catch (error) {
				res.writeHead(400)
				res.end(JSON.stringify({ error: `Invalid JSON: ${error}` }))
			}
		})
	})

	testServer.listen(PORT, () => {
		Logger.log(`Test server listening on port ${PORT}`)
	})

	// Handle server errors
	testServer.on("error", (error) => {
		Logger.log(`Test server error: ${error}`)
	})

	return testServer
}

/**
 * Shuts down the test server if it exists
 */
export function shutdownTestServer() {
	if (testServer) {
		testServer.close()
		Logger.log("Test server shut down")
		testServer = undefined
	}

	// Dispose of the message catcher if it exists
	if (messageCatcherDisposable) {
		messageCatcherDisposable.dispose()
		messageCatcherDisposable = undefined
	}
}
