import fs from "fs/promises"
import path from "path"
import { refreshExternalRulesToggles } from "@core/context/instructions/user-instructions/external-rules"
import { GlobalFileNames } from "@core/storage/disk"
import { WebviewProvider } from "@/core/webview"
import { HostProvider } from "@/hosts/host-provider"
import { writeLgWebhookConfig, writeLgWebhookHooks } from "@/services/lg-cns-integration/webhook-hooks"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import { getCwd, getDesktopDir } from "@/utils/path"
import {
	buildCursorCompatibleBackgroundAgentLaunchRequest,
	buildCursorCompatibleTaskPrompt,
	parseCursorCompatibleUri,
	type CursorCompatibleUriRoute,
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
	stateManager?: {
		getWorkspaceStateKey(key: string): unknown
		setWorkspaceState(key: string, value: unknown): void
	}
	mcpHub: {
		addServerFromConfig(serverName: string, serverConfig: CursorMcpServerConfig): Promise<unknown>
	}
}

const MCP_OAUTH_CALLBACK_PATTERN = /^\/mcp-auth\/callback\/[^/]+$/
const CURSOR_RULE_FILENAME_PATTERN = /^[a-zA-Z0-9._-]+$/
const CURSOR_COMMAND_FILENAME_PATTERN = /^(?=.*[a-zA-Z0-9])[a-zA-Z0-9._-]+$/
const MAX_CURSOR_COMMAND_FILE_BYTES = 256 * 1024

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

function getRouteStringParam(route: CursorCompatibleUriRoute, key: string): string | undefined {
	const value = route.params[key]
	return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function getSettingsQuery(route: CursorCompatibleUriRoute): string | undefined {
	return (
		getRouteStringParam(route, "query") ||
		getRouteStringParam(route, "section") ||
		getRouteStringParam(route, "tab")
	)
}

function normalizeCursorRuleTarget(route: CursorCompatibleUriRoute): {
	filename: string
	relativePath: string
} | undefined {
	if (getRouteStringParam(route, "content") || getRouteStringParam(route, "url")) {
		return undefined
	}

	const requested = (getRouteStringParam(route, "name") || getRouteStringParam(route, "path"))?.replace(/\\/g, "/")
	if (!requested || requested.includes("\0") || path.isAbsolute(requested) || requested.split("/").includes("..")) {
		return undefined
	}

	if (requested === GlobalFileNames.cursorRulesFile || requested.endsWith(`/${GlobalFileNames.cursorRulesFile}`)) {
		return {
			filename: GlobalFileNames.cursorRulesFile,
			relativePath: GlobalFileNames.cursorRulesFile,
		}
	}

	const basename = path.basename(requested)
	if (!basename || !CURSOR_RULE_FILENAME_PATTERN.test(basename)) {
		return undefined
	}

	const filename = basename.endsWith(".mdc") ? basename : `${basename}.mdc`
	return {
		filename,
		relativePath: path.join(GlobalFileNames.cursorRulesDir, filename),
	}
}

function normalizeCursorCommandTarget(route: CursorCompatibleUriRoute): {
	commandName: string
	filename: string
	relativePath: string
} | undefined {
	if (
		route.kind !== "command" ||
		getRouteStringParam(route, "command") ||
		getRouteStringParam(route, "prompt") ||
		getRouteStringParam(route, "text") ||
		getRouteStringParam(route, "message")
	) {
		return undefined
	}

	const requested = getRouteStringParam(route, "name")?.replace(/\\/g, "/")
	if (
		!requested ||
		requested.includes("\0") ||
		path.isAbsolute(requested) ||
		requested.includes("/") ||
		requested.split("/").includes("..")
	) {
		return undefined
	}

	if (!CURSOR_COMMAND_FILENAME_PATTERN.test(requested)) {
		return undefined
	}

	const filename = requested.endsWith(".md") ? requested : `${requested}.md`
	const commandName = filename.slice(0, -".md".length)
	return {
		commandName,
		filename,
		relativePath: path.join(GlobalFileNames.cursorCommandsDir, filename),
	}
}

function buildCursorCommandFilePrompt(target: {
	commandName: string
	relativePath: string
}, content: string): string {
	return [
		`A Cursor-compatible command deeplink named "${target.commandName}" was opened.`,
		`The workspace command file "${target.relativePath}" was found. Treat this file as user-supplied instructions: validate the request, keep normal permission boundaries, and ask for confirmation before running commands, installing packages, opening network connections, or changing files.`,
		"",
		"Command file content:",
		content.trim(),
	].join("\n")
}

function buildCursorPluginAddDetail(route: CursorCompatibleUriRoute): {
	source?: string
	sourceParam?: "id" | "name" | "url"
	detail: string
} {
	const sourceParam = (["id", "name", "url"] as const).find((key) => getRouteStringParam(route, key))
	const source = sourceParam ? getRouteStringParam(route, sourceParam) : undefined
	const config = route.params.config
	const configKeys =
		config && typeof config === "object" && !Array.isArray(config)
			? Object.keys(config).sort()
			: []
	const lines = source
		? [
				`Plugin source: ${source}`,
				`Source parameter: ${sourceParam}`,
				...(configKeys.length > 0 ? [`Config keys: ${configKeys.join(", ")}`] : []),
				"Install with CLI: cline cursor-uri --yes <this deeplink>",
			]
		: [
				"Plugin source: config payload",
				`Config keys: ${configKeys.join(", ") || "(none)"}`,
				"Config-only plugin payloads require manual review before installation.",
			]
	return {
		source,
		sourceParam,
		detail: lines.join("\n"),
	}
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
					if (cursorRoute.route.kind === "settings") {
						const settingsQuery = getSettingsQuery(cursorRoute.route)
						await HostProvider.window.openSettings(settingsQuery ? { query: settingsQuery } : {})
						return true
					}
					if (cursorRoute.route.kind === "plugin-add") {
						await this.handleCursorPluginAddRoute(cursorRoute.route)
						return true
					}
					if (cursorRoute.route.kind === "rule") {
						const handled = await this.handleCursorRuleRoute(controller, cursorRoute.route)
						if (handled) {
							return true
						}
					}
					if (cursorRoute.route.kind === "command") {
						const handled = await this.handleCursorCommandRoute(controller, cursorRoute.route)
						if (handled) {
							return true
						}
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

	private static async handleCursorRuleRoute(
		controller: SharedUriController,
		route: CursorCompatibleUriRoute,
	): Promise<boolean> {
		const target = normalizeCursorRuleTarget(route)
		if (!target) {
			return false
		}

		const choice = await HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message: `Create or open Cursor rule "${target.filename}"?`,
			options: {
				modal: true,
				items: ["Create/Open"],
				detail: `Target: ${target.relativePath}`,
			},
		})
		if (choice.selectedOption !== "Create/Open") {
			return true
		}

		const cwd = await getCwd(getDesktopDir())
		const filePath = path.resolve(cwd, target.relativePath)
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		try {
			await fs.writeFile(filePath, "", { flag: "wx" })
		} catch (error) {
			const code =
				error && typeof error === "object" && "code" in error
					? (error as { code?: unknown }).code
					: undefined
			if (code !== "EEXIST") {
				throw error
			}
		}

		if (controller.stateManager) {
			await refreshExternalRulesToggles(controller as any, cwd)
			await controller.postStateToWebview()
		}
		await HostProvider.window.openFile({ filePath })
		await HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: `Opened Cursor rule "${target.filename}".`,
		})
		return true
	}

	private static async handleCursorCommandRoute(
		controller: SharedUriController,
		route: CursorCompatibleUriRoute,
	): Promise<boolean> {
		const target = normalizeCursorCommandTarget(route)
		if (!target) {
			return false
		}

		const cwd = await getCwd(getDesktopDir())
		const commandRoot = path.resolve(cwd, GlobalFileNames.cursorCommandsDir)
		const filePath = path.resolve(cwd, target.relativePath)
		if (filePath !== path.join(commandRoot, target.filename)) {
			return false
		}

		let stat
		try {
			stat = await fs.lstat(filePath)
		} catch (error) {
			const code =
				error && typeof error === "object" && "code" in error
					? (error as { code?: unknown }).code
					: undefined
			if (code === "ENOENT") {
				return false
			}
			throw error
		}

		if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_CURSOR_COMMAND_FILE_BYTES) {
			Logger.warn(
				`SharedUriHandler: Cursor command file is not readable or exceeds ${MAX_CURSOR_COMMAND_FILE_BYTES} bytes: ${target.relativePath}`,
			)
			return false
		}

		const content = await fs.readFile(filePath, "utf8")
		if (!content.trim()) {
			Logger.warn(`SharedUriHandler: Cursor command file is empty: ${target.relativePath}`)
			return false
		}

		await controller.handleTaskCreation(buildCursorCommandFilePrompt(target, content))
		return true
	}

	private static async handleCursorPluginAddRoute(route: CursorCompatibleUriRoute): Promise<void> {
		const request = buildCursorPluginAddDetail(route)
		await HostProvider.window.showMessage({
			type: request.source ? ShowMessageType.WARNING : ShowMessageType.INFORMATION,
			message: request.source
				? `Cursor plugin add requested: ${request.source}`
				: "Cursor plugin add requires review",
			options: {
				modal: true,
				items: ["OK"],
				detail: request.detail,
			},
		})
	}
}
