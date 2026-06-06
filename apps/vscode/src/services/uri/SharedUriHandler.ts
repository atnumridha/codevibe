import fs from "fs/promises"
import { WebviewProvider } from "@/core/webview"
import { HostProvider } from "@/hosts/host-provider"
import { writeLgWebhookConfig, writeLgWebhookHooks } from "@/services/lg-cns-integration/webhook-hooks"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import {
	buildCursorCompatibleBackgroundAgentLaunchRequest,
	buildCursorCompatibleTaskPrompt,
	parseCursorCompatibleUri,
} from "./CursorUriRoutes"
import {
	buildCursorMcpInstallRequest,
	formatCursorMcpInstallDetail,
	type CursorMcpServerConfig,
} from "./CursorMcpInstall"

export const TASK_URI_PATH = "/task"
export const LG_TASK_URI_PATH = "/lg-task"

interface SharedUriHandlerOptions {
	cursorCompatibleDeepLinksEnabled?: boolean
}

interface SharedUriController {
	handleOpenRouterCallback(code: string): Promise<void>
	handleRequestyCallback(code: string): Promise<void>
	handleAuthCallback(token: string, provider: string | null): Promise<void>
	handleOcaAuthCallback(code: string, state: string): Promise<void>
	handleTaskCreation(prompt: string): Promise<void>
	handleMcpOAuthCallback(serverHash: string, code: string, state: string): Promise<void>
	handleHicapCallback(code: string): Promise<void>
	handleCursorBackgroundAgentLaunch(request: ReturnType<typeof buildCursorCompatibleBackgroundAgentLaunchRequest>): Promise<unknown>
	postStateToWebview(): Promise<void>
	mcpHub: {
		addServerFromConfig(serverName: string, serverConfig: CursorMcpServerConfig): Promise<unknown>
	}
}

const MCP_OAUTH_CALLBACK_PATTERN = /^\/mcp-auth\/callback\/[^/]+$/

function parseUri(url: string): {
	parsedUrl: URL
	path: string
	query: URLSearchParams
} {
	const parsedUrl = new URL(url)
	const path = parsedUrl.pathname

	// Create URLSearchParams from the query string, but preserve plus signs
	// by replacing them with a placeholder before parsing
	const queryString = parsedUrl.search.slice(1) // Remove leading '?'
	const query = new URLSearchParams(queryString.replace(/\+/g, "%2B"))

	return { parsedUrl, path, query }
}

/**
 * Shared URI handler that processes both VSCode URI events and HTTP server callbacks
 */
export class SharedUriHandler {
	/**
	 * Processes a URI and routes it to the appropriate handler
	 * @param url The URI to process (can be from VSCode or converted from HTTP)
	 * @returns Promise<boolean> indicating success (true) or failure (false)
	 */
	public static async handleUri(
		url: string,
		options: SharedUriHandlerOptions = {},
	): Promise<boolean> {
		const { parsedUrl, path, query } = parseUri(url)

		const isMcpOAuthCallback = MCP_OAUTH_CALLBACK_PATTERN.test(path)
		let visibleWebview = WebviewProvider.getVisibleInstance()
		if (!visibleWebview && isMcpOAuthCallback) {
			try {
				visibleWebview = WebviewProvider.getInstance()
			} catch {
				// The extension URI handler opens the sidebar before callbacks. HTTP callback
				// paths can still arrive during startup, so keep the normal false return.
			}
		}

		if (!visibleWebview) {
			Logger.warn("SharedUriHandler: No visible webview found")
			return false
		}

		return this.handleParsedUriWithController(visibleWebview.controller, parsedUrl, path, query, options)
	}

	/**
	 * Processes a URI against a known controller. This is used by standalone and
	 * external UI clients that do not have VS Code sidebar visibility semantics.
	 */
	public static async handleUriWithController(
		controller: SharedUriController,
		url: string,
		options: SharedUriHandlerOptions = {},
	): Promise<boolean> {
		const { parsedUrl, path, query } = parseUri(url)
		return this.handleParsedUriWithController(controller, parsedUrl, path, query, options)
	}

	private static async handleParsedUriWithController(
		controller: SharedUriController,
		parsedUrl: URL,
		path: string,
		query: URLSearchParams,
		options: SharedUriHandlerOptions,
	): Promise<boolean> {
		Logger.info(
			"SharedUriHandler: Processing URI:" +
				JSON.stringify({
					path: path,
					query: query,
					scheme: parsedUrl.protocol,
				}),
		)

		try {
			if (options.cursorCompatibleDeepLinksEnabled !== false) {
				const cursorRoute = parseCursorCompatibleUri(path, query)
				if (cursorRoute.recognized) {
					if ("error" in cursorRoute) {
						Logger.warn(
							`SharedUriHandler: Invalid Cursor-compatible URI: ${cursorRoute.error}`,
						)
						return false
					}
					if (cursorRoute.route.kind === "mcp-install") {
						const installRequest = buildCursorMcpInstallRequest(cursorRoute.route)
						const choice = await HostProvider.window.showMessage({
							type: ShowMessageType.WARNING,
							message: `Install MCP server "${installRequest.serverName}"?`,
							options: {
								modal: true,
								items: ["Install"],
								detail: formatCursorMcpInstallDetail(installRequest),
							},
						})
						if (choice.selectedOption !== "Install") {
							return true
						}
						await controller.mcpHub.addServerFromConfig(
							installRequest.serverName,
							installRequest.serverConfig,
						)
						await controller.postStateToWebview()
						await HostProvider.window.showMessage({
							type: ShowMessageType.INFORMATION,
							message: `Installed MCP server "${installRequest.serverName}".`,
						})
						return true
					}
					if (cursorRoute.route.kind === "background-agent") {
						await controller.handleCursorBackgroundAgentLaunch(
							buildCursorCompatibleBackgroundAgentLaunchRequest(cursorRoute.route),
						)
						return true
					}
					await controller.handleTaskCreation(
						buildCursorCompatibleTaskPrompt(cursorRoute.route),
					)
					return true
				}
			}

			switch (path) {
				case "/openrouter": {
					const code = query.get("code")
					if (code) {
						await controller.handleOpenRouterCallback(code)
						return true
					}
					Logger.warn("SharedUriHandler: Missing code parameter for OpenRouter callback")
					return false
				}
				case "/requesty": {
					const code = query.get("code")
					if (code) {
						await controller.handleRequestyCallback(code)
						return true
					}
					Logger.warn("SharedUriHandler: Missing code parameter for Requesty callback")
					return false
				}
				case "/auth": {
					const provider = query.get("provider")

					Logger.info(`SharedUriHandler - Auth callback received for ${provider} - ${path}`)

					const token = query.get("refreshToken") || query.get("idToken") || query.get("code")
					if (token) {
						await controller.handleAuthCallback(token, provider)
						return true
					}
					Logger.warn("SharedUriHandler: Missing idToken parameter for auth callback")
					return false
				}
				case "/auth/oca": {
					Logger.log("SharedUriHandler: Oca Auth callback received:", { path: path })

					const code = query.get("code")
					const state = query.get("state")

					if (code && state) {
						await controller.handleOcaAuthCallback(code, state)
						return true
					}
					Logger.warn("SharedUriHandler: Missing code parameter for auth callback")
					return false
				}
				case TASK_URI_PATH: {
					const prompt = query.get("prompt")
					if (prompt) {
						await controller.handleTaskCreation(prompt)
						return true
					}
					Logger.warn("SharedUriHandler: Missing prompt parameter for task creation")
					return false
				}
				case LG_TASK_URI_PATH: {
					const promptFile = query.get("prompt-file")
					const webhookUrl = query.get("webhook-url")
					const webhookToken = query.get("webhook-token")

					if (!promptFile || !webhookUrl || !webhookToken) {
						Logger.warn("SharedUriHandler: Missing required parameters for LG task creation")
						return false
					}

					const specContents = await fs.readFile(promptFile, "utf-8")
					const prompt = [
						`The following file contains the development specification you must implement: ${promptFile}`,
						"",
						"Start by reading that file from disk. If context compaction happens later, re-read the same file path so you can continue tracking progress against the original requirements.",
						"",
						"For convenience, here is the current file content:",
						"",
						specContents,
					].join("\n")
					await writeLgWebhookConfig(webhookUrl, webhookToken)
					await writeLgWebhookHooks()
					await controller.handleTaskCreation(prompt)
					return true
				}
				// Match /mcp-auth/callback/{hash}
				case path.match(MCP_OAUTH_CALLBACK_PATTERN)?.input: {
					const serverHash = path.split("/").pop()
					const code = query.get("code")
					const state = query.get("state")

					if (!code || !serverHash || !state) {
						Logger.warn("SharedUriHandler: Missing code, hash, or state in MCP OAuth callback")
						return false
					}

					await controller.handleMcpOAuthCallback(serverHash, code, state)
					return true
				}
				case "/hicap": {
					const code = query.get("code")
					if (code) {
						await controller.handleHicapCallback(code)
						return true
					}
					Logger.warn("SharedUriHandler: Missing code parameter for Hicap callback")
					return false
				}
				default:
					Logger.warn(`SharedUriHandler: Unknown path: ${path}`)
					return false
			}
		} catch (error) {
			Logger.error("SharedUriHandler: Error processing URI:", error)
			return false
		}
	}
}
