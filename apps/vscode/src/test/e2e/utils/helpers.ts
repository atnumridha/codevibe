import { execFileSync, type ChildProcess } from "node:child_process"
import { mkdirSync, mkdtempSync, type PathLike, type RmOptions, readdirSync, rmSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { type ElectronApplication, expect, type Frame, type Locator, type Page, test } from "@playwright/test"
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, SilentReporter } from "@vscode/test-electron"
import { _electron } from "playwright"
import { CodeVibeApiServerMock } from "../fixtures/server"

interface E2ETestDirectories {
	workspaceDir: string
	multiRootWorkspaceDir: string
	userDataDir: string
	extensionsDir: string
}

export interface E2ETestConfigs {
	workspaceType: "single" | "multi"
	channel: "stable" | "insiders"
	extensionInstallMode: "development" | "installed"
}

export interface NativeAgentDiagnosticsResponse {
	success: boolean
	ready?: boolean
	diagnostics?: {
		extensionId?: string
		enabledApiProposals?: string[]
		chatSessionContribution?: {
			type?: string
			displayName?: string
			order?: number
		}
		apiAvailability?: Record<string, boolean>
		registration?: {
			chatParticipant?: boolean
			chatParticipantIds?: string[]
			customAgentProvider?: boolean
			chatSessionProvider?: boolean
			chatSessionItemProvider?: boolean
			chatSessionItemController?: boolean
			chatSessionProviderTypes?: string[]
			chatSessionItemProviderTypes?: string[]
			chatSessionItemControllerTypes?: string[]
		}
		failures?: string[]
	}
	error?: string
}

export interface NativeAgentOpenResponse {
	success: boolean
	result?: {
		position?: "sidebar" | "editor"
		command?: string
		commandAvailable?: boolean
		opened?: boolean
		error?: string
	}
	error?: string
}

export interface NativeAgentRequestResponse {
	success: boolean
	taskText?: string
	progress?: string[]
	markdown?: string[]
	result?: {
		metadata?: {
			routedTo?: string
			taskId?: string
			startedInCodeVibe?: boolean
			cancelled?: boolean
			fallbackToTaskInput?: boolean
		}
	}
	currentTaskItem?: {
		id?: string
		task?: string
		ts?: number
	}
	error?: string
}

export interface NativePlanCreateResponse {
	success: boolean
	plan?: {
		planId?: string
		planPath?: string
		status?: string
		buildStatus?: string
		todoCount?: number
		completedTodoCount?: number
		metadata?: {
			name?: string
			overview?: string
			todos?: Array<{ id?: string; content?: string; status?: string }>
			isProject?: boolean
			phases?: Array<{ name?: string; todos?: Array<{ id?: string; content?: string; status?: string }> }>
		}
		body?: string
	}
	error?: string
}

export interface NativePlanOpenLatestResponse {
	success: boolean
	latestPlan?: {
		id?: string
		name?: string
		uri?: string
		status?: string
	}
	activeTab?: {
		label?: string
		inputUri?: string
		inputViewType?: string
	}
	planEditor?: {
		editorAssociation?: string
		usesCustomEditor?: boolean
		renderedCanvasExpected?: boolean
		hasLocalBuildActions?: boolean
		hasBuildSelectedAction?: boolean
		hasParallelBuildAction?: boolean
		hasCloudBuildAction?: boolean
		hasMermaid?: boolean
		hasFrontmatterTodos?: boolean
	}
	error?: string
}

export interface NativeWorkspaceTextSearchResponse {
	success: boolean
	nativeTextSearchAvailable?: boolean
	nativeFindTextInFilesCalls?: number
	fallbackFindFilesCalls?: number
	fallbackReadFileCalls?: number
	limitHit?: boolean
	matches?: Array<{
		path?: string
		line?: number
		column?: number
		match?: string
		beforeContext?: string[]
		afterContext?: string[]
	}>
	error?: string
}

type SandboxPermissionResult = {
	allowed?: boolean
	reason?: string
	matchedPattern?: string
	detectedOperator?: string
	failedSegment?: string
}

type InlineTerminalRequestResult = {
	ok?: boolean
	request?: {
		requestedTerminalRunMode?: "sandboxed" | "elevated" | "default"
		prefixRule?: string[]
		requiresManualApproval?: boolean
	}
	error?: string
}

export interface NativeSandboxEvaluateResponse {
	success: boolean
	policy?: {
		status?: string
		configSource?: string
		configPath?: string
		configPathRelative?: string
		effectiveAccess?: string
		allowReadAutoApprove?: boolean
		allowWriteAutoApprove?: boolean
		allowTerminalAutoApprove?: boolean
		allowNetworkAutoApprove?: boolean
		commandPermissions?: {
			allow?: string[]
			deny?: string[]
			allowRedirects?: boolean
		}
	}
	defaultRunModes?: {
		withSandboxPolicy?: string
		withoutSandboxPolicy?: string
	}
	commands?: Record<string, { sandboxed?: SandboxPermissionResult; elevated?: SandboxPermissionResult }>
	inlineRequests?: Record<string, InlineTerminalRequestResult>
	error?: string
}

export interface NativeCompatibilityDeeplinkResponse {
	success: boolean
	routeResults?: Record<string, boolean>
	messages?: Array<{
		type?: string | number
		message?: string
		items?: string[]
		detail?: string
		selectedOption?: string
	}>
	openSettingsCalls?: unknown[]
	openFileCalls?: unknown[]
	calls?: {
		tasks?: Array<{ preview?: string; hasCompatibleContext?: boolean }>
		mcpAdds?: Array<{ serverName?: string; type?: unknown; hasUrl?: boolean; hasSecretConfig?: boolean }>
		oauthInitiations?: string[]
		oauthCallbacks?: Array<{ serverHash?: string; code?: string; state?: string }>
		backgroundLaunches?: Array<{
			prompt?: string
			repository?: string
			requestedBranch?: string
			hasRoutePrompt?: boolean
		}>
		automationIngests?: Array<{ eventCount?: number; strict?: boolean; hasRoutePrompt?: boolean }>
		pluginAdds?: Array<{ sourceParam?: string; force?: boolean; detailMentionsReplace?: boolean }>
		prReviewTasks?: number
		postStateCalls?: number
	}
	secretLeakInMessages?: boolean
	error?: string
}

export interface NativeOpenAiCodexStateResponse {
	success: boolean
	defaultApiProvider?: string
	apiConfiguration?: {
		planModeApiProvider?: string
		actModeApiProvider?: string
		planModeApiModelId?: string
		actModeApiModelId?: string
	}
	openAiCodexIsAuthenticated?: boolean
	compatibilityStatus?: {
		openAiCodexAuthSource?: string
		openAiCodexAuthenticated?: boolean
	}
	credentials?: {
		tokenSource?: string
		authMode?: string
		email?: string
		accountId?: string
		installationId?: string
		clientVersion?: string
		hasAccessToken?: boolean
		hasRefreshToken?: boolean
	}
	models?: {
		defaultModelId?: string
		bundledModelCount?: number
		includesDefaultModel?: boolean
	}
	authJsonRelativePath?: string
	secretLeakInPayload?: boolean
	error?: string
}

export interface NativeVisibleCommandApprovalResponse {
	success: boolean
	command?: string
	taskId?: string
	messageCount?: number
	sandboxRuntime?: {
		status?: string
		effectiveAccess?: string
		configSource?: string
		networkDefault?: string
		writablePathCount?: number
	}
	error?: string
}

export interface NativeBrowserAutomationResponse {
	success: boolean
	actions?: string[]
	hasScreenshot?: boolean
	messageCount?: number
	taskId?: string
	url?: string
	error?: string
}

export interface NativePlanBuildWithoutFileResponse {
	success: boolean
	messageCount?: number
	response?: string
	taskId?: string
	error?: string
}

export class E2ETestHelper {
	// Constants
	public static readonly CODEBASE_ROOT_DIR = path.resolve(__dirname, "..", "..", "..", "..")
	public static readonly E2E_TESTS_DIR = path.join(E2ETestHelper.CODEBASE_ROOT_DIR, "src", "test", "e2e")
	public static readonly E2E_VSIX_PATH = path.join(E2ETestHelper.CODEBASE_ROOT_DIR, "dist", "e2e.vsix")
	private static readonly TEARDOWN_TIMEOUT_MS = 10_000
	private static readonly WINDOW_DIAGNOSTIC_TIMEOUT_MS = 1_000
	private static readonly PROCESS_EXIT_TIMEOUT_MS = 2_000
	private static readonly SIDEBAR_DISCOVERY_TIMEOUT_MS = 60_000

	// Instance properties for caching
	private cachedFrame: Frame | null = null

	// Path utilities
	public static escapeToPath(text: string): string {
		return text.trim().toLowerCase().replaceAll(/\W/g, "_")
	}

	public static getResultsDir(testName = "", label?: string): string {
		const testDir = path.join(
			E2ETestHelper.CODEBASE_ROOT_DIR,
			"test-results",
			"playwright",
			E2ETestHelper.escapeToPath(testName),
		)
		return label ? path.join(testDir, label) : testDir
	}

	/**
	 * Generates a filename for gRPC recorder logs based on test information
	 * @param testTitle The title of the test
	 * @param projectName The name of the test project (optional)
	 * @returns A sanitized filename suitable for gRPC recorder logs
	 */
	public static generateTestFileName(testTitle: string, projectName?: string): string {
		// Create a base name from the test title
		const baseName = E2ETestHelper.escapeToPath(testTitle)

		// Add project name if provided and different from default
		const projectSuffix = projectName && projectName !== "e2e tests" ? `_${E2ETestHelper.escapeToPath(projectName)}` : ""

		return `${baseName}${projectSuffix}`
	}

	public static async waitUntil(predicate: () => boolean | Promise<boolean>, maxDelay = 10000): Promise<void> {
		let delay = 10
		const start = Date.now()

		while (!(await predicate())) {
			if (Date.now() - start > maxDelay) {
				throw new Error(`waitUntil timeout after ${maxDelay}ms`)
			}
			await new Promise((resolve) => setTimeout(resolve, delay))
			delay = Math.min(delay << 1, 1000) // Cap at 1s
		}
	}

	private async isLocatorVisible(locator: Locator): Promise<boolean> {
		return locator.isVisible().catch(() => false)
	}

	private async firstVisibleLocator(candidates: Locator[]): Promise<Locator> {
		for (const candidate of candidates) {
			if (await this.isLocatorVisible(candidate)) {
				return candidate
			}
		}
		return candidates[0]
	}

	public async getChatInput(webview: Frame): Promise<Locator> {
		return this.firstVisibleLocator([
			webview.getByTestId("chat-input"),
			webview.getByPlaceholder(/Start a Codie task|Message Codie/i),
		])
	}

	public async getSendButton(webview: Frame): Promise<Locator> {
		return this.firstVisibleLocator([
			webview.getByTestId("send-button"),
			webview.getByRole("button", { name: /send message/i }),
		])
	}

	public async getModeSwitch(webview: Frame): Promise<Locator> {
		return this.firstVisibleLocator([
			webview.getByTestId("mode-switch"),
			webview.getByRole("button").filter({ hasText: /Plan.*Act|Act.*Plan/ }),
		])
	}

	public async getActiveMode(modeSwitch: Locator): Promise<Locator> {
		const currentMode = modeSwitch.locator("[aria-current='true']")
		if ((await currentMode.count()) > 0) {
			return currentMode.first()
		}

		const checkedMode = modeSwitch.locator("[role='radio'][aria-checked='true'], [aria-checked='true']")
		if ((await checkedMode.count()) > 0) {
			return checkedMode.first()
		}

		return currentMode
	}

	private async clickMode(modeSwitch: Locator, targetMode: "Act" | "Plan"): Promise<void> {
		const targetOption = modeSwitch.getByText(targetMode, { exact: true }).first()
		if (await this.isLocatorVisible(targetOption)) {
			await targetOption.click()
			return
		}
		await modeSwitch.click()
	}

	public async ensureActMode(page: Page, webview: Frame): Promise<Frame> {
		let sidebar = webview
		let lastError: unknown

		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				let modeSwitch = await this.getModeSwitch(sidebar)
				let activeMode = await this.getActiveMode(modeSwitch)
				await expect(activeMode).toHaveText(/^(Plan|Act)$/)
				if (((await activeMode.textContent())?.trim() ?? "") === "Act") {
					return sidebar
				}

				await this.clickMode(modeSwitch, "Act")
				sidebar = await this.getReadySidebar(page)
				modeSwitch = await this.getModeSwitch(sidebar)
				activeMode = await this.getActiveMode(modeSwitch)
				await expect(activeMode).toHaveText("Act", { timeout: 5_000 })
				return sidebar
			} catch (error: any) {
				lastError = error
				if (!this.isTransientWebviewError(error) && !error.message?.includes("toHaveText")) {
					break
				}
				this.clearCachedFrame()
				await E2ETestHelper.openCodeVibeSidebar(page)
				sidebar = await this.getReadySidebar(page)
			}
		}

		throw lastError instanceof Error ? lastError : new Error(String(lastError))
	}

	public async ensurePlanMode(page: Page, webview: Frame): Promise<Frame> {
		let sidebar = webview
		let lastError: unknown

		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				let modeSwitch = await this.getModeSwitch(sidebar)
				let activeMode = await this.getActiveMode(modeSwitch)
				await expect(activeMode).toHaveText(/^(Plan|Act)$/)
				if (((await activeMode.textContent())?.trim() ?? "") === "Plan") {
					return sidebar
				}

				await this.clickMode(modeSwitch, "Plan")
				sidebar = await this.getReadySidebar(page)
				modeSwitch = await this.getModeSwitch(sidebar)
				activeMode = await this.getActiveMode(modeSwitch)
				await expect(activeMode).toHaveText("Plan", { timeout: 5_000 })
				return sidebar
			} catch (error: any) {
				lastError = error
				if (!this.isTransientWebviewError(error) && !error.message?.includes("toHaveText")) {
					break
				}
				this.clearCachedFrame()
				await E2ETestHelper.openCodeVibeSidebar(page)
				sidebar = await this.getReadySidebar(page)
			}
		}

		throw lastError instanceof Error ? lastError : new Error(String(lastError))
	}

	private isTransientWebviewError(error: any): boolean {
		return (
			error.message?.includes("detached") ||
			error.message?.includes("navigation") ||
			error.message?.includes("closed") ||
			error.message?.includes("Target page") ||
			error.message?.includes("Timeout")
		)
	}

	private isRetryableSidebarError(error: any): boolean {
		return (
			this.isTransientWebviewError(error) ||
			error.message?.includes("waitUntil timeout") ||
			error.message?.includes("webview frame was not ready") ||
			error.message?.includes("webview frame was not found")
		)
	}

	public async submitChatMessage(page: Page, webview: Frame, message: string): Promise<Frame> {
		let sidebar = webview
		let lastError: unknown

		for (let attempt = 0; attempt < 4; attempt++) {
			try {
				if (sidebar.isDetached()) {
					this.clearCachedFrame()
					sidebar = await this.getReadySidebar(page)
				}

				const input = await this.getChatInput(sidebar)
				await expect(input).toBeVisible({ timeout: 2_000 })
				await input.click()
				await input.evaluate((element, value) => {
					const textarea = element as HTMLTextAreaElement
					const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set
					setter?.call(textarea, value)
					textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }))
					textarea.dispatchEvent(new Event("change", { bubbles: true }))
				}, message)
				await expect(input).toHaveValue(message, { timeout: 5_000 })
				const sendButton = await this.getSendButton(sidebar)
				try {
					await expect(sendButton).toBeEnabled({ timeout: 2_000 })
					await sendButton.evaluate((button) => {
						;(button as HTMLButtonElement).click()
					})
				} catch {
					await input.press("Enter")
				}
				return sidebar
			} catch (error: any) {
				lastError = error
				if (!this.isTransientWebviewError(error) || attempt === 3) {
					break
				}
				this.clearCachedFrame()
				await E2ETestHelper.openCodeVibeSidebar(page)
				sidebar = await this.getReadySidebar(page)
			}
		}

		throw lastError instanceof Error ? lastError : new Error(String(lastError))
	}

	public async enterChatMessage(page: Page, webview: Frame, message: string): Promise<Frame> {
		let sidebar = webview
		let lastError: unknown

		for (let attempt = 0; attempt < 4; attempt++) {
			try {
				if (sidebar.isDetached()) {
					this.clearCachedFrame()
					sidebar = await this.getReadySidebar(page)
				}

				const input = await this.getChatInput(sidebar)
				await expect(input).toBeVisible({ timeout: 2_000 })
				await input.click()
				await input.evaluate((element, value) => {
					const textarea = element as HTMLTextAreaElement
					const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set
					setter?.call(textarea, value)
					textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }))
					textarea.dispatchEvent(new Event("change", { bubbles: true }))
				}, message)
				await expect(input).toHaveValue(message, { timeout: 5_000 })
				return sidebar
			} catch (error: any) {
				lastError = error
				if (!this.isTransientWebviewError(error) || attempt === 3) {
					break
				}
				this.clearCachedFrame()
				await E2ETestHelper.openCodeVibeSidebar(page)
				sidebar = await this.getReadySidebar(page)
			}
		}

		throw lastError instanceof Error ? lastError : new Error(String(lastError))
	}

	private async isCodeVibeSurface(frame: Frame): Promise<boolean> {
		return (
			(await this.isLocatorVisible(frame.getByTestId("chat-input"))) ||
			(await this.isLocatorVisible(frame.getByPlaceholder(/Start a Codie task|Message Codie/i))) ||
			(await this.isLocatorVisible(frame.getByText("AGENT CONSOLE"))) ||
			(await this.isLocatorVisible(frame.getByRole("button", { name: "Sign in to Codie" }))) ||
			(await this.isLocatorVisible(frame.getByText(/How will you use Codie\?|Use another model source|Connect Codie/i)))
		)
	}

	public async waitForSidebarText(page: Page, text: string | RegExp, maxDelay = 30000): Promise<Frame> {
		let matchedSidebar: Frame | null = null
		await E2ETestHelper.waitUntil(async () => {
			try {
				for (const frame of page.frames()) {
					if (frame.isDetached()) {
						continue
					}
					if (await this.isLocatorVisible(frame.getByText(text))) {
						this.cachedFrame = frame
						matchedSidebar = frame
						return true
					}
				}
			} catch (error: any) {
				if (
					!error.message?.includes("detached") &&
					!error.message?.includes("navigation") &&
					!error.message?.includes("closed") &&
					!error.message?.includes("Target page")
				) {
					throw error
				}
			}
			return false
		}, maxDelay)
		if (!matchedSidebar) {
			throw new Error(`CodeVibe sidebar text was not found: ${text.toString()}`)
		}
		return matchedSidebar
	}

	public async getSidebar(page: Page, maxDelay = E2ETestHelper.SIDEBAR_DISCOVERY_TIMEOUT_MS): Promise<Frame> {
		const findSidebarFrame = async (): Promise<Frame | null> => {
			// Check cached frame first
			if (this.cachedFrame && !this.cachedFrame.isDetached()) {
				return this.cachedFrame
			}

			for (const frame of page.frames()) {
				if (frame.isDetached()) {
					continue
				}

				try {
					if (await this.isCodeVibeSurface(frame)) {
						this.cachedFrame = frame
						return frame
					}
				} catch (error: any) {
					if (
						!error.message.includes("detached") &&
						!error.message.includes("navigation") &&
						!error.message.includes("closed")
					) {
						throw error
					}
				}
			}
			return null
		}

		// macOS CI runners can be slow to materialize the webview frame after the command reports success.
		let sidebarFrame: Frame | null = null
		await E2ETestHelper.waitUntil(async () => {
			sidebarFrame = await findSidebarFrame()
			return sidebarFrame !== null
		}, maxDelay)
		if (!sidebarFrame) {
			throw new Error("CodeVibe webview frame was not found")
		}
		return sidebarFrame
	}

	public async getReadySidebar(
		page: Page,
		requireSendEnabled = false,
		maxDelay = E2ETestHelper.SIDEBAR_DISCOVERY_TIMEOUT_MS,
	): Promise<Frame> {
		let readySidebar: Frame | null = null
		await E2ETestHelper.waitUntil(async () => {
			try {
				this.clearCachedFrame()
				const sidebar = await this.getSidebar(page, 5_000)
				const chatInput = await this.getChatInput(sidebar)
				await expect(chatInput).toBeVisible({ timeout: 500 })
				if (requireSendEnabled) {
					const sendButton = await this.getSendButton(sidebar)
					await expect(sendButton).toBeEnabled({ timeout: 500 })
				}
				if (sidebar.isDetached()) {
					return false
				}
				readySidebar = sidebar
				return true
			} catch (error: any) {
				if (this.isTransientWebviewError(error)) {
					return false
				}
				return false
			}
		}, maxDelay)
		if (!readySidebar) {
			throw new Error("CodeVibe webview frame was not ready")
		}
		return readySidebar
	}

	public static async rmForRetries(path: PathLike, options?: RmOptions): Promise<void> {
		const maxAttempts = 3 // Reduced from 5

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				rmSync(path, options)
				return
			} catch (error) {
				if (attempt === maxAttempts) {
					throw new Error(`Failed to rmSync ${path} after ${maxAttempts} attempts: ${error}`)
				}
				await new Promise((resolve) => setTimeout(resolve, 50 * attempt)) // Progressive delay
			}
		}
	}

	private static async withTimeout<T>(
		promise: Promise<T>,
		timeoutMs: number,
	): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
		let timeout: ReturnType<typeof setTimeout> | undefined
		let timedOut = false

		try {
			const value = await Promise.race([
				promise.then((value) => ({ timedOut: false as const, value })),
				new Promise<{ timedOut: true }>((resolve) => {
					timeout = setTimeout(() => {
						timedOut = true
						resolve({ timedOut: true })
					}, timeoutMs)
				}),
			])

			return value
		} finally {
			if (timeout) {
				clearTimeout(timeout)
			}
			if (timedOut) {
				void promise.catch(() => undefined)
			}
		}
	}

	private static async getWindowDiagnostics(app: ElectronApplication): Promise<string> {
		const windows = app.windows()
		const titles = await Promise.all(
			windows.map(async (window, index) => {
				if (window.isClosed()) {
					return `#${index}: closed`
				}

				const title = await E2ETestHelper.withTimeout(window.title(), E2ETestHelper.WINDOW_DIAGNOSTIC_TIMEOUT_MS)
				return title.timedOut ? `#${index}: title timed out` : `#${index}: ${title.value || "<untitled>"}`
			}),
		)

		return titles.length > 0 ? titles.join(", ") : "no windows"
	}

	private static async waitForProcessExit(process: ChildProcess, timeoutMs: number): Promise<boolean> {
		if (process.exitCode !== null || process.signalCode !== null) {
			return true
		}

		return new Promise((resolve) => {
			const onExit = () => {
				clearTimeout(timeout)
				resolve(true)
			}
			const timeout = setTimeout(() => {
				process.off("exit", onExit)
				resolve(process.exitCode !== null || process.signalCode !== null)
			}, timeoutMs)

			process.once("exit", onExit)
		})
	}

	public static async closePageForTeardown(page: Page): Promise<void> {
		if (page.isClosed()) {
			return
		}

		const result = await E2ETestHelper.withTimeout(page.close(), E2ETestHelper.TEARDOWN_TIMEOUT_MS).catch((error) => {
			console.warn(`[e2e teardown] page.close() failed: ${error}`)
			return { timedOut: false as const, value: undefined }
		})
		if (result.timedOut) {
			console.warn(`[e2e teardown] page.close() exceeded ${E2ETestHelper.TEARDOWN_TIMEOUT_MS}ms; continuing to app cleanup`)
		}
	}

	public static async closeAppForTeardown(app: ElectronApplication): Promise<void> {
		const process = app.process()
		const getProcessSummary = () =>
			process
				? `pid=${process.pid ?? "unknown"} exitCode=${process.exitCode ?? "null"} signalCode=${process.signalCode ?? "null"} killed=${process.killed}`
				: "process unavailable"

		const closeResult = await E2ETestHelper.withTimeout(app.close(), E2ETestHelper.TEARDOWN_TIMEOUT_MS).catch((error) => {
			console.warn(`[e2e teardown] app.close() failed: ${error}`)
			return { timedOut: true as const }
		})
		if (!closeResult.timedOut) {
			return
		}

		const windowDiagnostics = await E2ETestHelper.getWindowDiagnostics(app).catch(
			(error) => `window diagnostics failed: ${error}`,
		)
		console.warn(
			`[e2e teardown] app.close() exceeded ${E2ETestHelper.TEARDOWN_TIMEOUT_MS}ms; forcing VS Code/Electron shutdown (${getProcessSummary()}; windows: ${windowDiagnostics})`,
		)

		if (!process || process.killed || process.exitCode !== null) {
			return
		}

		try {
			if (process.kill("SIGKILL")) {
				const exited = await E2ETestHelper.waitForProcessExit(process, E2ETestHelper.PROCESS_EXIT_TIMEOUT_MS)
				if (!exited) {
					console.warn(
						`[e2e teardown] VS Code/Electron process did not report exit within ${E2ETestHelper.PROCESS_EXIT_TIMEOUT_MS}ms after SIGKILL (${getProcessSummary()})`,
					)
				}
				return
			}

			console.warn(
				`[e2e teardown] SIGKILL returned false for VS Code/Electron process; skipping SIGTERM (${getProcessSummary()})`,
			)
			return
		} catch (error) {
			console.warn(`[e2e teardown] SIGKILL failed for VS Code/Electron process: ${error}`)
		}

		try {
			if (process.exitCode === null && process.signalCode === null && process.kill("SIGTERM")) {
				await E2ETestHelper.waitForProcessExit(process, E2ETestHelper.PROCESS_EXIT_TIMEOUT_MS)
			}
		} catch (error) {
			console.warn(`[e2e teardown] SIGTERM failed for VS Code/Electron process: ${error}`)
		}
	}

	public async signin(webview: Frame, page?: Page): Promise<Frame> {
		const response = await fetch("http://127.0.0.1:9876/seed-signed-in", { method: "POST" })
		if (!response.ok) {
			throw new Error(`Failed to seed signed-in e2e state: ${response.status} ${await response.text()}`)
		}
		if (page) {
			let lastError: unknown
			for (let attempt = 0; attempt < 3; attempt++) {
				try {
					this.clearCachedFrame()
					await E2ETestHelper.openCodeVibeSidebar(page)
					webview = await this.getReadySidebar(page)
					return webview
				} catch (error: any) {
					lastError = error
					if (!this.isRetryableSidebarError(error)) {
						break
					}
				}
			}
			throw lastError instanceof Error ? lastError : new Error(String(lastError))
		}
		const chatInput = await this.getChatInput(webview)
		await expect(chatInput).toBeVisible()

		const closeButton = webview.getByRole("button", { name: "Close" })
		let shouldCloseModal = false
		try {
			await closeButton.waitFor({ state: "visible", timeout: 5_000 })
			shouldCloseModal = true
		} catch {
			// No blocking modal appeared after sign-in.
		}
		if (shouldCloseModal) {
			await closeButton.click({ delay: 50 })
		}
		return webview
	}

	public async openSidebar(page: Page): Promise<Frame> {
		let lastError: unknown

		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				this.clearCachedFrame()
				await E2ETestHelper.openCodeVibeSidebar(page, 15_000)
				return await this.getSidebar(page)
			} catch (error: any) {
				lastError = error
				if (!this.isRetryableSidebarError(error)) {
					break
				}
			}
		}

		throw lastError instanceof Error ? lastError : new Error(String(lastError))
	}

	public static async openCodeVibeSidebar(
		page: Page,
		maxDelay = E2ETestHelper.SIDEBAR_DISCOVERY_TIMEOUT_MS,
	): Promise<void> {
		await page.bringToFront()
		await E2ETestHelper.waitUntil(async () => {
			try {
				const response = await fetch("http://127.0.0.1:9876/open-legacy-webview", { method: "POST" })
				if (!response.ok) {
					return false
				}
				const result = (await response.json()) as { visible?: boolean }
				return result.visible === true
			} catch {
				return false
			}
		}, maxDelay)
	}

	private static async postTestServerJson<T>(endpointPath: string, body?: unknown): Promise<T> {
		const response = await fetch(`http://127.0.0.1:9876${endpointPath}`, {
			method: "POST",
			headers: body === undefined ? undefined : { "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		})
		const text = await response.text()
		const data = text ? JSON.parse(text) : {}
		if (!response.ok) {
			throw new Error(`Test server ${endpointPath} failed: ${response.status} ${text}`)
		}
		return data as T
	}

	public static async getNativeAgentDiagnostics(): Promise<NativeAgentDiagnosticsResponse> {
		return E2ETestHelper.postTestServerJson<NativeAgentDiagnosticsResponse>("/native-agent/diagnostics")
	}

	public static async openNativeAgentSessionRuntime(
		position: "sidebar" | "editor" = "sidebar",
	): Promise<NativeAgentOpenResponse> {
		return E2ETestHelper.postTestServerJson<NativeAgentOpenResponse>("/native-agent/open", { position })
	}

	public static async invokeNativeAgentRequest(input: {
		command?: string
		prompt?: string
	}): Promise<NativeAgentRequestResponse> {
		return E2ETestHelper.postTestServerJson<NativeAgentRequestResponse>("/native-agent/request", input)
	}

	public static async createNativePlan(input: {
		response: string
		taskProgress: string
		composerId?: string
	}): Promise<NativePlanCreateResponse> {
		return E2ETestHelper.postTestServerJson<NativePlanCreateResponse>("/plans/create", input)
	}

	public static async openLatestNativePlan(): Promise<NativePlanOpenLatestResponse> {
		return E2ETestHelper.postTestServerJson<NativePlanOpenLatestResponse>("/plans/open-latest")
	}

	public static async searchNativeWorkspaceText(input: {
		regex: string
		filePattern?: string
		maxResults?: number
		files?: Array<{ relativePath: string; content: string }>
	}): Promise<NativeWorkspaceTextSearchResponse> {
		return E2ETestHelper.postTestServerJson<NativeWorkspaceTextSearchResponse>("/workspace/search-text", input)
	}

	public static async evaluateNativeSandboxPolicy(input?: {
		config?: Record<string, unknown>
		policySetting?: string
	}): Promise<NativeSandboxEvaluateResponse> {
		return E2ETestHelper.postTestServerJson<NativeSandboxEvaluateResponse>("/sandbox/evaluate", input)
	}

	public static async evaluateNativeCompatibilityDeeplinks(): Promise<NativeCompatibilityDeeplinkResponse> {
		return E2ETestHelper.postTestServerJson<NativeCompatibilityDeeplinkResponse>(
			"/compatibility/deeplinks/evaluate",
		)
	}

	public static async evaluateNativeOpenAiCodexState(): Promise<NativeOpenAiCodexStateResponse> {
		return E2ETestHelper.postTestServerJson<NativeOpenAiCodexStateResponse>("/state/openai-codex/evaluate")
	}

	public static async seedVisibleCommandApproval(input?: {
		command?: string
	}): Promise<NativeVisibleCommandApprovalResponse> {
		return E2ETestHelper.postTestServerJson<NativeVisibleCommandApprovalResponse>(
			"/seed-visible-command-approval",
			input,
		)
	}

	public static async seedBrowserAutomation(): Promise<NativeBrowserAutomationResponse> {
		return E2ETestHelper.postTestServerJson<NativeBrowserAutomationResponse>("/seed-browser-automation")
	}

	public static async seedPlanBuildWithoutFile(): Promise<NativePlanBuildWithoutFileResponse> {
		return E2ETestHelper.postTestServerJson<NativePlanBuildWithoutFileResponse>("/seed-plan-build-without-file")
	}

	public static async runCommandPalette(page: Page, command: string): Promise<void> {
		await E2ETestHelper.openCommandPalette(page, `>${command}`)
		await page.keyboard.press("Enter")
	}

	public static async expectCommandPaletteItem(page: Page, query: string, itemText: string): Promise<void> {
		const quickInput = await E2ETestHelper.openCommandPalette(page, query)
		try {
			await expect(quickInput.getByText(itemText).first()).toBeVisible()
		} finally {
			await page.keyboard.press("Escape")
		}
	}

	public static async expectCommandPaletteNoItem(page: Page, query: string, itemText: string): Promise<void> {
		const quickInput = await E2ETestHelper.openCommandPalette(page, query)
		try {
			await expect(quickInput.getByText(itemText)).toHaveCount(0)
		} finally {
			await page.keyboard.press("Escape")
		}
	}

	private static async openCommandPalette(page: Page, query: string): Promise<Locator> {
		await page.bringToFront()
		const quickInput = page.locator(".quick-input-widget").first()
		const editorSearchBar = page.locator(".quick-input-widget input").first()

		const waitForQuickInput = async (timeout = 2_000) => {
			try {
				await editorSearchBar.waitFor({ state: "visible", timeout })
				return true
			} catch {
				return false
			}
		}

		const openAttempts: Array<() => Promise<void>> = [
			async () => {
				const showAllCommands = page.getByText("Show All Commands", { exact: true }).first()
				if (await showAllCommands.isVisible()) {
					await showAllCommands.click({ delay: 50 })
				}
			},
			async () => page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+P" : "F1"),
			async () => page.keyboard.press("F1"),
		]

		for (const open of openAttempts) {
			await open().catch(() => undefined)
			if (await waitForQuickInput()) {
				break
			}
		}

		await editorSearchBar.waitFor({ state: "visible", timeout: 10_000 })
		await editorSearchBar.fill(query)
		return quickInput
	}

	public static installVsixForE2E(executablePath: string, userDataDir: string, extensionsDir: string): void {
		const [codeCommand, ...baseArgs] = resolveCliArgsFromVSCodeExecutablePath(executablePath, {
			reuseMachineInstall: true,
		})
		execFileSync(
			codeCommand,
			[
				...baseArgs,
				`--user-data-dir=${userDataDir}`,
				`--extensions-dir=${extensionsDir}`,
				"--install-extension",
				E2ETestHelper.E2E_VSIX_PATH,
				"--force",
			],
			{
				stdio: "inherit",
				shell: process.platform === "win32",
			},
		)
	}

	// Clear cached frame when needed
	public clearCachedFrame(): void {
		this.cachedFrame = null
	}
}

/**
 * NOTE: Use the `e2e` test fixture for all E2E tests to test the CodeVibe extension.
 *
 * Extended Playwright test configuration for CodeVibe E2E testing.
 *
 * This test configuration provides a comprehensive setup for end-to-end testing of the CodeVibe VS Code extension,
 * including server mocking, temporary directories, VS Code instance management, and helper utilities.
 *
 * NOTE: Default to run in single-root workspace; use `e2eMultiRoot` for multi-root workspace tests.
 *
 * @extends test - Base Playwright test with multiple fixture extensions
 *
 * Fixtures provided:
 * - `server`: Shared CodeVibeApiServerMock instance for API mocking (reused across all tests)
 * - `workspaceDir`: Path to the test workspace directory
 * - `userDataDir`: Temporary directory for VS Code user data
 * - `extensionsDir`: Temporary directory for VS Code extensions
 * - `openVSCode`: Function that returns a Promise resolving to an ElectronApplication instance
 * - `app`: ElectronApplication instance with automatic cleanup
 * - `helper`: E2ETestHelper instance for test utilities
 * - `page`: Playwright Page object representing the main VS Code window with CodeVibe opened
 * - `sidebar`: Playwright Frame object representing the CodeVibe extension's sidebar iframe
 *
 * @returns Extended test object with all fixtures available for E2E test scenarios:
 * - **server**: Automatically starts and manages a CodeVibeApiServerMock instance
 * - **workspaceDir**: Sets up a test workspace directory from fixtures
 * - **userDataDir**: Creates a temporary directory for VS Code user data
 * - **extensionsDir**: Creates a temporary directory for VS Code extensions
 * - **openVSCode**: Factory function that launches VS Code with proper configuration for testing
 * - **app**: Manages the VS Code ElectronApplication lifecycle with automatic cleanup
 * - **helper**: Provides E2ETestHelper utilities for test operations
 * - **page**: Configures the main VS Code window with notifications disabled and CodeVibe open
 * - **sidebar**: Provides access to the CodeVibe extension's sidebar frame
 *
 * @example
 * ```typescript
 * e2e('should perform basic operations', async ({ sidebar, helper }) => {
 *   // Test implementation using the configured sidebar and helper
 * });
 * ```
 *
 * @remarks
 * - Automatically handles VS Code download and setup
 * - Installs the packaged CodeVibe VSIX and can optionally load the development extension path
 * - Records test videos for debugging
 * - Performs cleanup of temporary directories after each test
 * - Configures VS Code with disabled updates, workspace trust, and welcome screens
 */
export const e2e = test
	.extend<{ server: CodeVibeApiServerMock | null }>({
		server: async ({}, use) => {
			// Start server if it doesn't exist
			if (!CodeVibeApiServerMock.globalSharedServer) {
				await CodeVibeApiServerMock.startGlobalServer()
			}
			await use(CodeVibeApiServerMock.globalSharedServer)
		},
	})
	.extend<E2ETestDirectories>({
		workspaceDir: async ({}, use) => {
			await use(path.join(E2ETestHelper.E2E_TESTS_DIR, "fixtures", "workspace"))
		},
		multiRootWorkspaceDir: async ({}, use) => {
			// DOCS: https://code.visualstudio.com/docs/editing/workspaces/multi-root-workspaces
			await use(path.join(E2ETestHelper.E2E_TESTS_DIR, "fixtures", "multiroots.code-workspace"))
		},
		userDataDir: async ({}, use) => {
			await use(mkdtempSync(path.join(os.tmpdir(), "vsce")))
		},
		extensionsDir: async ({}, use) => {
			await use(mkdtempSync(path.join(os.tmpdir(), "vsce")))
		},
	})
	.extend<E2ETestConfigs>({
		workspaceType: "single",
		channel: "stable",
		extensionInstallMode: "development",
	})
	.extend<{ openVSCode: (workspacePath: string) => Promise<ElectronApplication> }>({
		openVSCode: async ({ userDataDir, extensionsDir, channel, extensionInstallMode }, use, testInfo) => {
			const executablePath = await downloadAndUnzipVSCode(channel, undefined, new SilentReporter())

			await use(async (workspacePath: string) => {
				// Create isolated CodeVibe data directory for this test. Keep CLINE_DIR during transition for
				// compatibility with storage code that still uses legacy config keys.
				const codeVibeTestDir = mkdtempSync(path.join(os.tmpdir(), "codevibe-e2e-"))
				const userSettingsDir = path.join(userDataDir, "User")
				mkdirSync(userSettingsDir, { recursive: true })
				writeFileSync(
					path.join(userSettingsDir, "settings.json"),
					JSON.stringify(
						{
							"extensions.ignoreRecommendations": true,
							"git.openRepositoryInParentFolders": "never",
							"telemetry.telemetryLevel": "off",
							"workbench.enableExperiments": false,
						},
						null,
						2,
					),
				)
				E2ETestHelper.installVsixForE2E(executablePath, userDataDir, extensionsDir)

				const args = [
					"--no-sandbox",
					"--disable-updates",
					"--disable-workspace-trust",
					"--skip-welcome",
					"--skip-release-notes",
					`--user-data-dir=${userDataDir}`,
					`--extensions-dir=${extensionsDir}`,
				]
				if (extensionInstallMode === "development") {
					args.push(`--extensionDevelopmentPath=${E2ETestHelper.CODEBASE_ROOT_DIR}`)
				} else {
					args.push("--enable-proposed-api", "atnumridha.codevibe")
				}
				args.push(workspacePath)

				const app = await _electron.launch({
					executablePath,
					env: {
						...process.env,
						TEMP_PROFILE: "true",
						E2E_TEST: "true",
						CLINE_ENVIRONMENT: "local",
						CODEVIBE_DIR: codeVibeTestDir,
						CODEVIBE_PLAN_HOME: path.join(codeVibeTestDir, "plans"),
						CLINE_DIR: codeVibeTestDir,
						GRPC_RECORDER_FILE_NAME: E2ETestHelper.generateTestFileName(testInfo.title, testInfo.project.name),
						// GRPC_RECORDER_ENABLED: "true",
						// GRPC_RECORDER_TESTS_FILTERS_ENABLED: "true"
						// IS_DEV: "true",
						// DEV_WORKSPACE_FOLDER: E2ETestHelper.CODEBASE_ROOT_DIR,
					},
					recordVideo: {
						dir: E2ETestHelper.getResultsDir(testInfo.title, "recordings"),
					},
					args,
				})
				await E2ETestHelper.waitUntil(() => app.windows().length > 0)
				return app
			})
		},
	})
	.extend<{ app: ElectronApplication; clineTestDir: string }>({
		app: async ({ openVSCode, userDataDir, extensionsDir, workspaceType, workspaceDir, multiRootWorkspaceDir }, use) => {
			const workspacePath = workspaceType === "single" ? workspaceDir : multiRootWorkspaceDir

			const app = await openVSCode(workspacePath)

			try {
				await use(app)
			} finally {
				await E2ETestHelper.closeAppForTeardown(app)
				// Cleanup in parallel after the app process has been asked to exit.
				const cleanupTasks = [
					E2ETestHelper.rmForRetries(userDataDir, { recursive: true }),
					E2ETestHelper.rmForRetries(extensionsDir, { recursive: true }),
				]

				// Clean up the isolated CodeVibe data directory and legacy temp directories from older test runs.
				// Find all temp directories matching our pattern
				const tmpDir = os.tmpdir()
				try {
					const entries = readdirSync(tmpDir)
					for (const entry of entries) {
						if (entry.startsWith("codevibe-e2e-") || entry.startsWith("cline-e2e-")) {
							cleanupTasks.push(E2ETestHelper.rmForRetries(path.join(tmpDir, entry), { recursive: true }))
						}
					}
				} catch (error) {
					// Ignore cleanup errors
				}

				await Promise.allSettled(cleanupTasks)
			}
		},
		clineTestDir: async ({}, use) => {
			// This legacy fixture name is kept for older tests; openVSCode owns the isolated CodeVibe data dirs.
			await use("")
		},
	})
	.extend<{ helper: E2ETestHelper }>({
		helper: async ({}, use) => {
			const helper = new E2ETestHelper()
			await use(helper)
		},
	})
	.extend({
		page: async ({ app }, use) => {
			const page = await app.firstWindow()
			try {
				await use(page)
			} finally {
				await E2ETestHelper.closePageForTeardown(page)
			}
		},
	})
	.extend<{ sidebar: Frame }>({
		sidebar: async ({ page, helper, server }, use) => {
			const sidebar = await helper.openSidebar(page)
			await use(sidebar)
		},
	})

export const E2E_WORKSPACE_TYPES = [
	{ title: "Single Root", workspaceType: "single" },
	{ title: "Multi-Roots", workspaceType: "multi" },
] as const
