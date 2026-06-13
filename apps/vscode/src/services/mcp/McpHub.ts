import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import { sendMcpServersUpdate } from "@core/controller/mcp/subscribeToMcpServers"
import { getMcpSettingsFilePath as getMcpSettingsFilePathHelper } from "@core/storage/disk"
import { StateManager } from "@core/storage/StateManager"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
	CallToolResultSchema,
	GetPromptResultSchema,
	ListPromptsResultSchema,
	ListResourcesResultSchema,
	ListResourceTemplatesResultSchema,
	ListToolsResultSchema,
	ReadResourceResultSchema,
} from "@modelcontextprotocol/sdk/types.js"
import {
	DEFAULT_MCP_TIMEOUT_SECONDS,
	McpPrompt,
	McpPromptResponse,
	McpResource,
	McpResourceResponse,
	McpResourceTemplate,
	McpServer,
	McpServerSettingsSource,
	McpTool,
	McpToolCallResponse,
	MIN_MCP_TIMEOUT_SECONDS,
} from "@shared/mcp"
import { convertMcpServersToProtoMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { secondsToMs } from "@utils/time"
import chokidar, { FSWatcher } from "chokidar"
import deepEqual from "fast-deep-equal"
import * as fs from "fs/promises"
import { nanoid } from "nanoid"
import * as os from "os"
import * as path from "path"
import ReconnectingEventSource from "reconnecting-eventsource"
import { z } from "zod"
import { HostProvider } from "@/hosts/host-provider"
import { fetch } from "@/shared/net"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import { expandEnvironmentVariables } from "@/utils/envExpansion"
import { getServerAuthHash } from "@/utils/mcpAuth"
import { TelemetryService } from "../telemetry/TelemetryService"
import { DEFAULT_REQUEST_TIMEOUT_MS } from "./constants"
import { McpOAuthManager } from "./McpOAuthManager"
import { StreamableHttpReconnectHandler } from "./StreamableHttpReconnectHandler"
import { BaseConfigSchema, McpSettingsSchema, ServerConfigSchema } from "./schemas"
import { McpConnection, McpServerConfig, Transport } from "./types"

type McpSettings = z.infer<typeof McpSettingsSchema>

type McpSettingsReadResult = {
	settings: McpSettings
	serverOrder: string[]
	serverSettingsFiles: Map<string, string>
	serverSettingsSources: Map<string, McpServerSettingsSource>
}

const CURSOR_MCP_SETTINGS_RELATIVE_PATH = path.join(".cursor", "mcp.json")

export class McpHub {
	getMcpServersPath: () => Promise<string>
	private getSettingsDirectoryPath: () => Promise<string>
	private getWorkspaceRootPaths?: () => Promise<string[]> | string[]
	private clientVersion: string
	private telemetryService: TelemetryService
	private mcpOAuthManager: McpOAuthManager

	private settingsWatcher?: FSWatcher
	private cursorSettingsWatcher?: FSWatcher
	private fileWatchers: Map<string, FSWatcher> = new Map()
	connections: McpConnection[] = []
	private serverSettingsFiles: Map<string, string> = new Map()
	private serverSettingsSources: Map<string, McpServerSettingsSource> = new Map()
	private lastServerOrder: string[] = []
	isConnecting = false
	/**
	 * Flag to skip file watcher processing when we're updating Cline-specific settings
	 * (autoApprove, timeout) that don't require an MCP server restart.
	 *
	 * The file watcher has a 100ms stabilityThreshold before firing "change" events.
	 * When we update settings, we set this flag to true, write the file, then clear
	 * the flag after 300ms. This ensures the flag is still true when the delayed
	 * file watcher event fires, so we can skip redundant processing.
	 *
	 * Timeline:
	 *   0ms:    flag = true, write file
	 *   ~100ms: file watcher fires "change" → sees flag=true → skips
	 *   300ms:  flag = false (ready for external file changes)
	 */
	private isUpdatingClineSettings = false

	// Track when remote config is updating to prevent unnecessary watcher triggers
	private isUpdatingFromRemoteConfig = false

	/**
	 * Map of unique keys to each connected server names
	 */
	private static mcpServerKeys = new Map<string, string>()

	// Store notifications for display in chat
	private pendingNotifications: Array<{
		serverName: string
		level: string
		message: string
		timestamp: number
	}> = []

	// Callback for sending notifications to active task
	private notificationCallback?: (serverName: string, level: string, message: string) => void

	constructor(
		getMcpServersPath: () => Promise<string>,
		getSettingsDirectoryPath: () => Promise<string>,
		clientVersion: string,
		telemetryService: TelemetryService,
		getWorkspaceRootPaths?: () => Promise<string[]> | string[],
	) {
		this.getMcpServersPath = getMcpServersPath
		this.getSettingsDirectoryPath = getSettingsDirectoryPath
		this.getWorkspaceRootPaths = getWorkspaceRootPaths
		this.clientVersion = clientVersion
		this.telemetryService = telemetryService
		this.mcpOAuthManager = new McpOAuthManager()
		this.watchMcpSettingsFile()
		this.initializeMcpServers()
	}

	getServers(): McpServer[] {
		// Only return enabled servers

		return this.connections.filter((conn) => !conn.server.disabled).map((conn) => conn.server)
	}

	/**
	 * Get the MCP server name from its unique key.
	 * If the key is not found, return the key itself.
	 */
	public static getMcpServerByKey(key: string): string {
		return McpHub.mcpServerKeys.get(key) || key
	}

	/**
	 * Create a unique key for an MCP server based on its name.
	 * This avoids making a tool name too long while still ensuring uniqueness.
	 */
	private getMcpServerKey(server: string): string {
		// Reuse existing key if server is already registered
		for (const [existingKey, existingServer] of McpHub.mcpServerKeys.entries()) {
			if (existingServer === server) {
				return existingKey
			}
		}
		// Generate a short 6-character unique ID for the server
		// Add c prefix to ensure it starts with a letter (for compatibility with Gemini)
		// Only use the first 5 characters of nanoid to keep it short
		const uid = "c" + nanoid(5)
		McpHub.mcpServerKeys.set(uid, server)
		return uid
	}

	/**
	 * Gets the path to the MCP settings file
	 * @returns Path to the MCP settings file
	 */
	async getMcpSettingsFilePath(): Promise<string> {
		return getMcpSettingsFilePathHelper(await this.getSettingsDirectoryPath())
	}

	private async getNativeMcpSettingsFilePath(): Promise<string> {
		return getMcpSettingsFilePathHelper(await this.getSettingsDirectoryPath())
	}

	private async pathExists(filePath: string): Promise<boolean> {
		try {
			await fs.access(filePath)
			return true
		} catch {
			return false
		}
	}

	private async getCursorMcpSettingsFilePaths(): Promise<string[]> {
		const roots = this.getWorkspaceRootPaths ? await this.getWorkspaceRootPaths() : []
		return [
			...new Set([
				...roots
					.filter(Boolean)
					.map((root) => path.join(root, CURSOR_MCP_SETTINGS_RELATIVE_PATH)),
				path.join(os.homedir(), CURSOR_MCP_SETTINGS_RELATIVE_PATH),
			]),
		]
	}

	private async getCursorMcpSettingsFilePathSources(): Promise<
		Array<{ settingsPath: string; source: McpServerSettingsSource }>
	> {
		const roots = this.getWorkspaceRootPaths ? await this.getWorkspaceRootPaths() : []
		const workspaceCursorPaths = new Set(
			roots
				.filter(Boolean)
				.map((root) => path.normalize(path.join(root, CURSOR_MCP_SETTINGS_RELATIVE_PATH))),
		)
		return (await this.getCursorMcpSettingsFilePaths()).map((settingsPath) => ({
			settingsPath,
			source: workspaceCursorPaths.has(path.normalize(settingsPath)) ? "cursor-workspace" : "cursor-global",
		}))
	}

	private async getCursorMcpWorkspaceRootForSettingsPath(settingsPath: string): Promise<string | undefined> {
		const normalizedPath = path.normalize(settingsPath)
		const roots = this.getWorkspaceRootPaths ? await this.getWorkspaceRootPaths() : []
		for (const root of roots.filter(Boolean)) {
			const cursorSettingsPath = path.normalize(path.join(root, CURSOR_MCP_SETTINGS_RELATIVE_PATH))
			if (normalizedPath === cursorSettingsPath) {
				return root
			}
		}
		const globalCursorSettingsPath = path.normalize(path.join(os.homedir(), CURSOR_MCP_SETTINGS_RELATIVE_PATH))
		return normalizedPath === globalCursorSettingsPath && roots.length === 1 ? roots[0] : undefined
	}

	/**
	 * Sets the flag to indicate remote config is updating
	 * Used to prevent watcher from triggering on remote config writes
	 */
	setIsUpdatingFromRemoteConfig(value: boolean): void {
		this.isUpdatingFromRemoteConfig = value
	}

	/**
	 * Gets whether remote config is currently updating
	 */
	getIsUpdatingFromRemoteConfig(): boolean {
		return this.isUpdatingFromRemoteConfig
	}

	private async readAndValidateMcpSettingsPath(settingsPath: string, sourceLabel: string): Promise<McpSettings | undefined> {
		try {
			const content = await fs.readFile(settingsPath, "utf-8")

			let config: any

			// Handle empty or minimal files silently - this is a valid state meaning "no MCP servers"
			const trimmedContent = content.trim()
			if (!trimmedContent || trimmedContent === "{}" || trimmedContent === '{"mcpServers":{}}') {
				return { mcpServers: {} }
			}

			// Parse JSON file content
			try {
				config = JSON.parse(content)
			} catch (_error) {
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: `Invalid ${sourceLabel} MCP settings format. Please ensure your settings follow the correct JSON format.`,
				})
				return undefined
			}

			// Expand environment variables before validation
			// This allows ${env:VAR_NAME} syntax in URLs, headers, env vars, etc.
			config = expandEnvironmentVariables(config, {
				workspaceRoot: await this.getCursorMcpWorkspaceRootForSettingsPath(settingsPath),
			})

			// Validate against schema
			const result = McpSettingsSchema.safeParse(config)
			if (!result.success) {
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: `Invalid ${sourceLabel} MCP settings schema.`,
				})
				return undefined
			}

			return result.data
		} catch (error) {
			Logger.error(`Failed to read ${sourceLabel} MCP settings:`, error)
			return undefined
		}
	}

	private async readNativeMcpSettingsFile(): Promise<McpSettings | undefined> {
		return this.readAndValidateMcpSettingsPath(await this.getNativeMcpSettingsFilePath(), "Codie")
	}

	private async readAllMcpSettingsFiles(): Promise<McpSettingsReadResult | undefined> {
		const nativeSettingsPath = await this.getNativeMcpSettingsFilePath()
		const nativeSettings = await this.readAndValidateMcpSettingsPath(nativeSettingsPath, "Codie")
		if (!nativeSettings) {
			return undefined
		}

		const mergedServers: McpSettings["mcpServers"] = { ...nativeSettings.mcpServers }
		const serverOrder = Object.keys(nativeSettings.mcpServers)
		const serverSettingsFiles = new Map<string, string>()
		const serverSettingsSources = new Map<string, McpServerSettingsSource>()

		for (const serverName of serverOrder) {
			serverSettingsFiles.set(serverName, nativeSettingsPath)
			serverSettingsSources.set(serverName, "cline")
		}

		for (const { settingsPath: cursorSettingsPath, source } of await this.getCursorMcpSettingsFilePathSources()) {
			if (!(await this.pathExists(cursorSettingsPath))) {
				continue
			}

			const cursorSettings = await this.readAndValidateMcpSettingsPath(cursorSettingsPath, ".cursor/mcp.json")
			if (!cursorSettings) {
				return undefined
			}

			for (const [serverName, serverConfig] of Object.entries(cursorSettings.mcpServers)) {
				if (serverName in mergedServers) {
					Logger.log(
						`[McpHub] Skipping Cursor MCP server "${serverName}" from ${cursorSettingsPath}; a higher-priority MCP settings file already defines it.`,
					)
					continue
				}
				mergedServers[serverName] = serverConfig
				serverOrder.push(serverName)
				serverSettingsFiles.set(serverName, cursorSettingsPath)
				serverSettingsSources.set(serverName, source)
			}
		}

		this.serverSettingsFiles = serverSettingsFiles
		this.serverSettingsSources = serverSettingsSources
		this.lastServerOrder = serverOrder

		return {
			settings: { mcpServers: mergedServers },
			serverOrder,
			serverSettingsFiles,
			serverSettingsSources,
		}
	}

	private async readAndValidateMcpSettingsFile(): Promise<McpSettings | undefined> {
		return (await this.readAllMcpSettingsFiles())?.settings
	}

	private async getSettingsFilePathForServer(serverName: string): Promise<string> {
		return this.serverSettingsFiles.get(serverName) ?? (await this.getNativeMcpSettingsFilePath())
	}

	private async readWritableMcpSettingsForServer(
		serverName: string,
	): Promise<{ settingsPath: string; settings: McpSettings }> {
		const settingsPath = await this.getSettingsFilePathForServer(serverName)
		const settings = await this.readAndValidateMcpSettingsPath(settingsPath, settingsPath.endsWith(CURSOR_MCP_SETTINGS_RELATIVE_PATH) ? ".cursor/mcp.json" : "CodeVibe")
		if (!settings) {
			throw new Error("Failed to read or validate MCP settings")
		}
		return { settingsPath, settings }
	}

	private async reloadMcpServersFromSettings(): Promise<void> {
		const readResult = await this.readAllMcpSettingsFiles()
		if (!readResult) {
			return
		}

		try {
			const settings = readResult.settings
			// Re-add any remotely configured servers that were manually removed from all settings files.
			const remoteServers = StateManager.get().getRemoteConfigSettings().remoteMCPServers
			if (remoteServers?.length) {
				let fileNeedsUpdate = false
				const nativeSettingsPath = await this.getNativeMcpSettingsFilePath()
				const nativeSettings = (await this.readNativeMcpSettingsFile()) ?? { mcpServers: {} }

				for (const rs of remoteServers) {
					if (!settings.mcpServers[rs.name]) {
						;(settings.mcpServers as Record<string, any>)[rs.name] = {
							url: rs.url,
							type: "streamableHttp",
							disabled: false,
							autoApprove: [],
							remoteConfigured: true,
						}
						;(nativeSettings.mcpServers as Record<string, any>)[rs.name] = settings.mcpServers[rs.name]
						this.serverSettingsFiles.set(rs.name, nativeSettingsPath)
						this.lastServerOrder.push(rs.name)
						fileNeedsUpdate = true
					}
				}
				if (fileNeedsUpdate) {
					this.isUpdatingFromRemoteConfig = true
					await fs.writeFile(nativeSettingsPath, JSON.stringify({ mcpServers: nativeSettings.mcpServers }, null, 2))
					this.isUpdatingFromRemoteConfig = false
				}
			}
			await this.updateServerConnections(settings.mcpServers)
		} catch (error) {
			Logger.error("Failed to process MCP settings change:", error)
		}
	}

	private async watchMcpSettingsFile(): Promise<void> {
		const settingsPath = await this.getNativeMcpSettingsFilePath()

		this.settingsWatcher = chokidar.watch(settingsPath, {
			persistent: true, // Keep the process running as long as files are being watched
			ignoreInitial: true, // Don't fire 'add' events when discovering the file initially
			awaitWriteFinish: {
				// Wait for writes to finish before emitting events (handles chunked writes)
				stabilityThreshold: 100, // Wait 100ms for file size to remain constant
				pollInterval: 100, // Check file size every 100ms while waiting for stability
			},
			atomic: true, // Handle atomic writes where editors write to a temp file then rename (prevents duplicate events)
		})

		this.settingsWatcher.on("change", async () => {
			// Skip if remote config is currently updating to prevent unnecessary reconnections
			if (this.isUpdatingFromRemoteConfig) {
				return
			}
			// Skip processing if we're updating Cline-specific settings (autoApprove, timeout)
			if (this.isUpdatingClineSettings) {
				return
			}

			await this.reloadMcpServersFromSettings()
		})

		this.settingsWatcher.on("error", (error) => {
			Logger.error("Error watching MCP settings file:", error)
		})

		const cursorSettingsPaths = await this.getCursorMcpSettingsFilePaths()
		if (cursorSettingsPaths.length > 0) {
			this.cursorSettingsWatcher = chokidar.watch(cursorSettingsPaths, {
				persistent: true,
				ignoreInitial: true,
				awaitWriteFinish: {
					stabilityThreshold: 100,
					pollInterval: 100,
				},
				atomic: true,
			})

			const handleCursorSettingsChange = async () => {
				if (this.isUpdatingClineSettings) {
					return
				}
				await this.reloadMcpServersFromSettings()
			}
			this.cursorSettingsWatcher.on("add", handleCursorSettingsChange)
			this.cursorSettingsWatcher.on("change", handleCursorSettingsChange)
			this.cursorSettingsWatcher.on("unlink", handleCursorSettingsChange)
			this.cursorSettingsWatcher.on("error", (error) => {
				Logger.error("Error watching Cursor MCP settings file:", error)
			})
		}
	}

	private async initializeMcpServers(): Promise<void> {
		await this.reloadMcpServersFromSettings()
	}

	private findConnection(name: string, _source: "rpc" | "internal"): McpConnection | undefined {
		return this.connections.find((conn) => conn.server.name === name)
	}

	private async connectToServer(
		name: string,
		config: z.infer<typeof ServerConfigSchema>,
		source: "rpc" | "internal",
	): Promise<void> {
		// Remove existing connection if it exists (should never happen, the connection should be deleted beforehand)
		this.connections = this.connections.filter((conn) => conn.server.name !== name)

		// Validate remote MCP server URL against remote config if blockPersonalRemoteMCPServers is enabled
		if (config.type !== "stdio" && "url" in config && config.url) {
			const stateManager = StateManager.get()
			const remoteConfig = stateManager.getRemoteConfigSettings()

			if (remoteConfig.blockPersonalRemoteMCPServers === true) {
				const remoteMCPServers = remoteConfig.remoteMCPServers || []
				const allowedUrls = remoteMCPServers.map((server) => server.url)

				if (!allowedUrls.includes(config.url)) {
					return
				}
			}
		}

		// Validate local MCP servers based on remote config (enterprise feature)
		if (config.type === "stdio") {
			const stateManager = StateManager.get()
			const remoteConfig = stateManager.getRemoteConfigSettings()

			// Early exit for non-enterprise users: if no remote config is set, allow all local servers
			if (Object.keys(remoteConfig).length === 0) {
				// No remote config restrictions - proceed with connection (default behavior for non-enterprise users)
				// This ensures backwards compatibility and that regular users are not affected
			} else {
				// Enterprise restrictions apply

				// If marketplace is explicitly disabled by enterprise config, block all local servers
				if (remoteConfig.mcpMarketplaceEnabled === false) {
					return
				}

				// If allowlist exists, only servers on the allowlist are allowed
				const hasAllowlist = remoteConfig.allowedMCPServers && remoteConfig.allowedMCPServers.length > 0
				if (hasAllowlist) {
					const allowedIds = remoteConfig.allowedMCPServers!.map((server: { id: string }) => server.id)
					if (!allowedIds.includes(name)) {
						return
					}
				}

				// If marketplace is enabled with no allowlist, all local servers are allowed
			}
		}

		if (config.disabled) {
			//Logger.log(`[MCP Debug] Creating disabled connection object for server "${name}"`)
			// Create a connection object for disabled server so it appears in UI
			const disabledConnection: McpConnection = {
				server: {
					name,
					config: JSON.stringify(config),
					status: "disconnected",
					disabled: true,
				},
				client: null as unknown as Client,
				transport: null as unknown as Transport,
			}
			this.connections.push(disabledConnection)
			return
		}

		try {
			// Store unexpanded config for display/comparison (keeps credentials out of stored config)
			const configForStorage = JSON.stringify(config)

			// Expand environment variables in config before using it
			const expandedConfig = expandEnvironmentVariables(config)

			// Each MCP server requires its own transport connection and has unique capabilities, configurations, and error handling. Having separate clients also allows proper scoping of resources/tools and independent server management like reconnection.
			const client = new Client(
				{
					name: "Codie",
					version: this.clientVersion,
				},
				{
					capabilities: {},
				},
			)

			let transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport

			// Create OAuth provider for remote transports (SSE and HTTP)
			const authProvider =
				expandedConfig.type === "sse" || expandedConfig.type === "streamableHttp"
					? await this.mcpOAuthManager.getOrCreateProvider(name, expandedConfig.url)
					: undefined

			switch (expandedConfig.type) {
				case "stdio": {
					transport = new StdioClientTransport({
						command: expandedConfig.command,
						args: expandedConfig.args,
						cwd: expandedConfig.cwd,
						env: {
							...getDefaultEnvironment(),
							...(expandedConfig.env || {}), // Now has expanded environment variables
						},
						stderr: "pipe",
					})

					transport.onerror = async (error) => {
						Logger.error(`Transport error for "${name}":`, error)
						const connection = this.findConnection(name, source)
						if (connection) {
							connection.server.status = "disconnected"
							McpHub.mcpServerKeys.delete(connection.server.uid || name)
							this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`)
						}
						await this.notifyWebviewOfServerChanges()
					}

					transport.onclose = async () => {
						const connection = this.findConnection(name, source)
						if (connection) {
							connection.server.status = "disconnected"
							McpHub.mcpServerKeys.delete(connection.server.uid || name)
						}
						await this.notifyWebviewOfServerChanges()
					}

					await transport.start()
					const stderrStream = transport.stderr
					if (stderrStream) {
						stderrStream.on("data", async (data: Buffer) => {
							const output = data.toString()
							const isInfoLog = !/\berror\b/i.test(output)

							if (isInfoLog) {
								Logger.log(`Server "${name}" info:`, output)
							} else {
								Logger.error(`Server "${name}" stderr:`, output)
								const connection = this.findConnection(name, source)
								if (connection) {
									this.appendErrorMessage(connection, output)
									if (connection.server.status === "disconnected") {
										await this.notifyWebviewOfServerChanges()
									}
								}
							}
						})
					} else {
						Logger.error(`No stderr stream for ${name}`)
					}
					transport.start = async () => {}
					break
				}
				case "sse": {
					const sseOptions = {
						authProvider,
						requestInit: {
							headers: expandedConfig.headers,
						},
					}
					const reconnectingEventSourceOptions = {
						max_retry_time: 5000,
						withCredentials: !!expandedConfig.headers?.["Authorization"],
						// IMPORTANT: Custom fetch function is required for SSE with OAuth
						// When we provide eventSourceInit, we override the SDK's default fetch
						// The SDK's default would call _commonHeaders() for auth, but since we're
						// overriding it, we must provide our own fetch that:
						// 1. Calls authProvider.tokens() dynamically (not captured once)
						// 2. Gets fresh tokens for each connection/reconnection
						// 3. Allows the SDK to auto-refresh expired tokens
						// Without this, tokens would be stale and fail after expiry
						fetch: authProvider
							? async (url: string | URL, init?: RequestInit) => {
									const tokens = await authProvider.tokens() // Dynamic - gets fresh tokens
									const headers = new Headers(init?.headers)
									if (tokens?.access_token) {
										headers.set("Authorization", `Bearer ${tokens.access_token}`)
									}
									return fetch(url.toString(), { ...init, headers })
								}
							: undefined,
					}
					// Use ReconnectingEventSource for auto-reconnection on connection drops
					global.EventSource = ReconnectingEventSource
					transport = new SSEClientTransport(new URL(expandedConfig.url), {
						...sseOptions,
						eventSourceInit: reconnectingEventSourceOptions,
					})

					transport.onerror = async (error) => {
						Logger.error(`Transport error for "${name}":`, error)
						const connection = this.findConnection(name, source)
						if (connection) {
							connection.server.status = "disconnected"
							McpHub.mcpServerKeys.delete(connection.server.uid || name)
							this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`)
						}
						await this.notifyWebviewOfServerChanges()
					}
					break
				}
				case "streamableHttp": {
					// Use ReconnectingEventSource for auto-reconnection on connection drops
					global.EventSource = ReconnectingEventSource

					// Custom fetch wrapper that treats 404 as 405 for GET requests.
					// The MCP SDK sends a GET request to check for SSE stream support.
					// Per MCP spec, servers should return 405 if they don't support SSE,
					// but many servers (incorrectly) return 404. The SDK only handles 405
					// gracefully, so we normalize 404 -> 405 to fix compatibility.
					// See: https://github.com/modelcontextprotocol/typescript-sdk/issues/1150
					const streamableHttpFetch: typeof fetch = async (url, init) => {
						const response = await fetch(url, init)
						if (init?.method === "GET" && response.status === 404) {
							return new Response(response.body, {
								status: 405,
								statusText: "Method Not Allowed",
								headers: response.headers,
							})
						}
						return response
					}

					transport = new StreamableHTTPClientTransport(new URL(expandedConfig.url), {
						authProvider,
						requestInit: {
							headers: expandedConfig.headers ?? undefined,
						},
						fetch: streamableHttpFetch,
					})

					const reconnectHandler = new StreamableHttpReconnectHandler(name, {
						findConnection: () => this.findConnection(name, source),
						deleteConnection: () => this.deleteConnection(name),
						connectToServer: () => this.connectToServer(name, config, source),
						notifyWebviewOfServerChanges: () => this.notifyWebviewOfServerChanges(),
						appendErrorMessage: (conn, msg) => this.appendErrorMessage(conn as McpConnection, msg),
						deleteServerKey: (uid) => McpHub.mcpServerKeys.delete(uid),
						delay: (ms) => setTimeoutPromise(ms),
					})

					transport.onerror = (error) => reconnectHandler.handleError(error)
					break
				}
				default:
					throw new Error(`Unknown transport type: ${(config as any).type}`)
			}

			const connection: McpConnection = {
				server: {
					name,
					config: configForStorage,
					status: "connecting",
					disabled: config.disabled,
					uid: this.getMcpServerKey(name),
					oauthRequired: false,
					oauthAuthStatus: "authenticated",
				},
				client,
				transport,
				authProvider,
			}
			this.connections.push(connection)

			// Connect - wrap in try-catch to detect OAuth requirement
			try {
				await client.connect(transport)
			} catch (error) {
				if (error instanceof UnauthorizedError) {
					// Server requires OAuth authentication
					Logger.log(`Server "${name}" requires OAuth authentication`)
					const unauthConnection: McpConnection = {
						server: {
							name,
							config: JSON.stringify(config),
							status: "disconnected",
							disabled: false,
							oauthRequired: true,
							oauthAuthStatus: "unauthenticated",
							error: "This MCP server requires authentication to get started.",
							uid: this.getMcpServerKey(name),
						},
						client,
						transport,
						authProvider, // CRITICAL: Keep authProvider so it's available when user authenticates!
					}
					// Replace the connection with unauthenticated version
					this.connections = this.connections.filter((conn) => conn.server.name !== name)
					this.connections.push(unauthConnection)
					await this.notifyWebviewOfServerChanges()
					return // Don't throw, just mark as needs auth
				}
				// Re-throw other errors
				throw error
			}

			connection.server.status = "connected"
			connection.server.error = ""

			// Register notification handler for real-time messages
			//Logger.log(`[MCP Debug] Setting up notification handlers for server: ${name}`)
			//Logger.log(`[MCP Debug] Client instance:`, connection.client)
			//Logger.log(`[MCP Debug] Transport type:`, config.type)

			// Try to set notification handler using the client's method
			try {
				// Import the notification schema from MCP SDK
				const { z } = await import("zod")

				// Define the notification schema for notifications/message
				const NotificationMessageSchema = z.object({
					method: z.literal("notifications/message"),
					params: z
						.object({
							level: z.enum(["debug", "info", "warning", "error"]).optional(),
							logger: z.string().optional(),
							data: z.string().optional(),
							message: z.string().optional(),
						})
						.optional(),
				})

				// Set the notification handler
				connection.client.setNotificationHandler(NotificationMessageSchema as any, async (notification: any) => {
					//Logger.log(`[MCP Notification] ${name}:`, JSON.stringify(notification, null, 2))

					const params = notification.params || {}
					const level = params.level || "info"
					const data = params.data || params.message || ""
					const logger = params.logger || ""

					//Logger.log(`[MCP Message Notification] ${name}: level=${level}, data=${data}, logger=${logger}`)

					// Format the message
					const message = logger ? `[${logger}] ${data}` : data

					// Send notification directly to active task if callback is set
					if (this.notificationCallback) {
						//Logger.log(`[MCP Debug] Sending notification to active task: ${message}`)
						this.notificationCallback(name, level, message)
					} else {
						// Fallback: store for later retrieval
						//Logger.log(`[MCP Debug] No active task, storing notification: ${message}`)
						this.pendingNotifications.push({
							serverName: name,
							level,
							message,
							timestamp: Date.now(),
						})
					}
				})
				//Logger.log(`[MCP Debug] Successfully set notifications/message handler for ${name}`)

				// Also set a fallback handler for any other notification types
				connection.client.fallbackNotificationHandler = async (notification: any) => {
					//Logger.log(`[MCP Fallback Notification] ${name}:`, JSON.stringify(notification, null, 2))

					// Show in VS Code for visibility
					HostProvider.window.showMessage({
						type: ShowMessageType.INFORMATION,
						message: `MCP ${name}: ${notification.method || "unknown"} - ${JSON.stringify(notification.params || {})}`,
					})
				}
				//Logger.log(`[MCP Debug] Successfully set fallback notification handler for ${name}`)
			} catch (error) {
				Logger.error(`[MCP Debug] Error setting notification handlers for ${name}:`, error)
			}

			// Initial fetch of tools, resources, and prompts
			connection.server.tools = await this.fetchToolsList(name)
			connection.server.resources = await this.fetchResourcesList(name)
			connection.server.resourceTemplates = await this.fetchResourceTemplatesList(name)
			connection.server.prompts = await this.fetchPromptsList(name)
		} catch (error) {
			// Update status with error
			const connection = this.findConnection(name, source)
			if (connection) {
				connection.server.status = "disconnected"
				this.appendErrorMessage(connection, error instanceof Error ? error.message : String(error))
			}
			throw error
		}
	}

	private appendErrorMessage(connection: McpConnection, error: string) {
		const newError = connection.server.error ? `${connection.server.error}\n${error}` : error
		connection.server.error = newError //.slice(0, 800)
	}

	private async fetchToolsList(serverName: string): Promise<McpTool[]> {
		try {
			const connection = this.connections.find((conn) => conn.server.name === serverName)

			if (!connection) {
				throw new Error(`No connection found for server: ${serverName}`)
			}

			// Disabled servers don't have clients, so return empty tools list
			if (connection.server.disabled || !connection.client) {
				return []
			}

			const response = await connection.client.request({ method: "tools/list" }, ListToolsResultSchema, {
				timeout: DEFAULT_REQUEST_TIMEOUT_MS,
			})

			// Get autoApprove settings
			const { settings: config } = await this.readWritableMcpSettingsForServer(serverName)
			const autoApproveConfig = config.mcpServers[serverName]?.autoApprove || []

			// Mark tools as always allowed based on settings
			const tools = (response?.tools || []).map((tool) => ({
				...tool,
				autoApprove: autoApproveConfig.includes(tool.name),
			}))

			return tools
		} catch (error) {
			Logger.error(`Failed to fetch tools for ${serverName}:`, error)
			return []
		}
	}

	private async fetchResourcesList(serverName: string): Promise<McpResource[]> {
		try {
			const connection = this.connections.find((conn) => conn.server.name === serverName)

			// Disabled servers don't have clients, so return empty resources list
			if (!connection || connection.server.disabled || !connection.client) {
				return []
			}

			const response = await connection.client.request({ method: "resources/list" }, ListResourcesResultSchema, {
				timeout: DEFAULT_REQUEST_TIMEOUT_MS,
			})
			return response?.resources || []
		} catch (_error) {
			// Logger.error(`Failed to fetch resources for ${serverName}:`, error)
			return []
		}
	}

	private async fetchResourceTemplatesList(serverName: string): Promise<McpResourceTemplate[]> {
		try {
			const connection = this.connections.find((conn) => conn.server.name === serverName)

			// Disabled servers don't have clients, so return empty resource templates list
			if (!connection || connection.server.disabled || !connection.client) {
				return []
			}

			const response = await connection.client.request(
				{ method: "resources/templates/list" },
				ListResourceTemplatesResultSchema,
				{
					timeout: DEFAULT_REQUEST_TIMEOUT_MS,
				},
			)

			return response?.resourceTemplates || []
		} catch (_error) {
			// Logger.error(`Failed to fetch resource templates for ${serverName}:`, error)
			return []
		}
	}

	private async fetchPromptsList(serverName: string): Promise<McpPrompt[]> {
		try {
			const connection = this.connections.find((conn) => conn.server.name === serverName)

			// Disabled servers don't have clients, so return empty prompts list
			if (!connection || connection.server.disabled || !connection.client) {
				return []
			}

			const response = await connection.client.request({ method: "prompts/list" }, ListPromptsResultSchema, {
				timeout: DEFAULT_REQUEST_TIMEOUT_MS,
			})

			return (response?.prompts || []).map((prompt) => ({
				name: prompt.name,
				title: prompt.title,
				description: prompt.description,
				arguments: prompt.arguments?.map((arg) => ({
					name: arg.name,
					description: arg.description,
					required: arg.required,
				})),
			}))
		} catch (_error) {
			return []
		}
	}

	async deleteConnection(name: string): Promise<void> {
		const connection = this.connections.find((conn) => conn.server.name === name)
		if (connection) {
			try {
				// Only close transport and client if they exist (disabled servers don't have them)
				if (connection.transport) {
					await connection.transport.close()
				}
				if (connection.client) {
					await connection.client.close()
				}
			} catch (error) {
				Logger.error(`Failed to close transport for ${name}:`, error)
			}
			this.connections = this.connections.filter((conn) => conn.server.name !== name)
		}
	}

	async clearOAuthForConnection(name: string): Promise<void> {
		const connection = this.connections.find((conn) => conn.server.name === name)
		if (connection) {
			try {
				const config = JSON.parse(connection.server.config)
				if (config.url) {
					await this.mcpOAuthManager.clearServerAuth(name, config.url)
				}
			} catch (error) {
				Logger.error(`Failed to clear OAuth data for ${name}:`, error)
			}
		}
	}

	async updateServerConnectionsRPC(newServers: Record<string, McpServerConfig>): Promise<void> {
		this.isConnecting = true
		this.removeAllFileWatchers()
		const currentNames = new Set(this.connections.map((conn) => conn.server.name))
		const newNames = new Set(Object.keys(newServers))

		// Delete removed servers
		for (const name of currentNames) {
			if (!newNames.has(name)) {
				await this.deleteConnection(name)
				Logger.log(`Deleted MCP server: ${name}`)
			}
		}

		// Update or add servers
		for (const [name, config] of Object.entries(newServers)) {
			const currentConnection = this.connections.find((conn) => conn.server.name === name)

			if (!currentConnection) {
				// New server
				try {
					if (config.type === "stdio") {
						this.setupFileWatcher(name, config)
					}
					await this.connectToServer(name, config, "rpc")
				} catch (error) {
					Logger.error(`Failed to connect to new MCP server ${name}:`, error)
				}
			} else if (this.configsRequireRestart(JSON.parse(currentConnection.server.config), config)) {
				// Existing server with changed connection config (excludes Cline-specific settings)
				try {
					if (config.type === "stdio") {
						this.setupFileWatcher(name, config)
					}
					await this.deleteConnection(name) // Don't clear OAuth - just reconnecting with new config
					await this.connectToServer(name, config, "rpc")
					Logger.log(`Reconnected MCP server with updated config: ${name}`)
				} catch (error) {
					Logger.error(`Failed to reconnect MCP server ${name}:`, error)
				}
			} else {
				// Only Cline-specific settings changed - update in-memory state without restart
				const autoApprove = config.autoApprove || []
				if (currentConnection.server.tools) {
					currentConnection.server.tools = currentConnection.server.tools.map((tool) => ({
						...tool,
						autoApprove: autoApprove.includes(tool.name),
					}))
				}
				// Also update Cline-specific settings in the stored config.
				// This handles the case where someone manually edits the MCP settings file -
				// the file watcher triggers this code path, and we need to sync the in-memory
				// config with the file without restarting the server.
				const currentConfig = JSON.parse(currentConnection.server.config)
				currentConfig.autoApprove = config.autoApprove
				currentConfig.timeout = config.timeout
				currentConnection.server.config = JSON.stringify(currentConfig)
			}
		}

		this.isConnecting = false
	}

	async updateServerConnections(newServers: Record<string, McpServerConfig>): Promise<void> {
		this.isConnecting = true
		this.removeAllFileWatchers()
		const currentNames = new Set(this.connections.map((conn) => conn.server.name))
		const newNames = new Set(Object.keys(newServers))

		// Track if any connection-level changes occurred (excludes Cline-specific settings)
		let connectionChangesOccurred = false

		// Delete removed servers
		for (const name of currentNames) {
			if (!newNames.has(name)) {
				await this.clearOAuthForConnection(name) // Clear OAuth data first
				await this.deleteConnection(name) // Then delete connection
				Logger.log(`Deleted MCP server: ${name}`)
				connectionChangesOccurred = true
			}
		}

		// Update or add servers
		for (const [name, config] of Object.entries(newServers)) {
			const currentConnection = this.connections.find((conn) => conn.server.name === name)

			if (!currentConnection) {
				// New server
				try {
					if (config.type === "stdio") {
						this.setupFileWatcher(name, config)
					}
					await this.connectToServer(name, config, "internal")
					connectionChangesOccurred = true
				} catch (error) {
					Logger.error(`Failed to connect to new MCP server ${name}:`, error)
				}
			} else if (this.configsRequireRestart(JSON.parse(currentConnection.server.config), config)) {
				// Existing server with changed connection config (excludes Cline-specific settings)
				try {
					// Set status to "connecting" and notify webview before restart (same pattern as restartConnection)
					currentConnection.server.status = "connecting"
					currentConnection.server.error = ""
					await this.notifyWebviewOfServerChanges()

					if (config.type === "stdio") {
						this.setupFileWatcher(name, config)
					}
					await this.deleteConnection(name)
					await this.connectToServer(name, config, "internal")
					Logger.log(`Reconnected MCP server with updated config: ${name}`)
					connectionChangesOccurred = true
				} catch (error) {
					Logger.error(`Failed to reconnect MCP server ${name}:`, error)
				}
			} else {
				// Only Cline-specific settings changed - update in-memory state without restart
				// Don't set connectionChangesOccurred since the RPC already returned the updated state
				const autoApprove = config.autoApprove || []
				if (currentConnection.server.tools) {
					currentConnection.server.tools = currentConnection.server.tools.map((tool) => ({
						...tool,
						autoApprove: autoApprove.includes(tool.name),
					}))
				}
				// Also update Cline-specific settings in the stored config
				const currentConfig = JSON.parse(currentConnection.server.config)
				currentConfig.autoApprove = config.autoApprove
				currentConfig.timeout = config.timeout
				currentConnection.server.config = JSON.stringify(currentConfig)
			}
		}

		// Only notify webview if actual connection changes occurred.
		// For Cline-specific settings changes, the RPC response already updated the webview,
		// so we skip notification to avoid race conditions.
		if (connectionChangesOccurred) {
			await this.notifyWebviewOfServerChanges()
		}
		this.isConnecting = false
	}

	/**
	 * Compares two MCP server configs to determine if a restart is required.
	 * Excludes Cline-specific settings since they don't affect the MCP server transport connection.
	 *
	 * ## Cline-specific settings (don't require restart):
	 * - `autoApprove`: tool approval list (UI setting)
	 * - `timeout`: request timeout (read at request time, not connection time)
	 *
	 * ## MCP SDK connection settings (require restart):
	 * - `type`, `command`, `args`, `cwd`, `env`, `url`, `headers`, `disabled`
	 *
	 * ## Adding new Cline-specific settings:
	 * When adding a new setting that doesn't require server restart:
	 * 1. Add it to the destructuring below to exclude from comparison
	 * 2. Add it to `isUpdatingClineSettings` flag usage in the update function
	 * 3. Update in-memory state (e.g., `connection.server.config`) in the update function
	 * 4. Update the schema in `src/services/mcp/schemas.ts` if needed
	 */
	private configsRequireRestart(oldConfig: McpServerConfig, newConfig: McpServerConfig): boolean {
		// Exclude Cline-specific settings from comparison (add new ones here)
		const {
			autoApprove: _oldAutoApprove,
			timeout: _oldTimeout,
			remoteConfigured: _oldRemoteConfigured,
			...oldConnectionConfig
		} = oldConfig
		const {
			autoApprove: _newAutoApprove,
			timeout: _newTimeout,
			remoteConfigured: _newRemoteConfigured,
			...newConnectionConfig
		} = newConfig
		return !deepEqual(oldConnectionConfig, newConnectionConfig)
	}

	private setupFileWatcher(name: string, config: Extract<McpServerConfig, { type: "stdio" }>) {
		const filePath = config.args?.find((arg: string) => arg.includes("build/index.js"))
		if (filePath) {
			// we use chokidar instead of onDidSaveTextDocument because it doesn't require the file to be open in the editor. The settings config is better suited for onDidSave since that will be manually updated by the user or CodeVibe (and we want to detect save events, not every file change)
			const watcher = chokidar.watch(filePath, {
				// persistent: true,
				// ignoreInitial: true,
				// awaitWriteFinish: true, // This helps with atomic writes
			})

			watcher.on("change", () => {
				Logger.log(`Detected change in ${filePath}. Restarting server ${name}...`)
				this.restartConnection(name)
			})

			this.fileWatchers.set(name, watcher)
		}
	}

	private removeAllFileWatchers() {
		this.fileWatchers.forEach((watcher) => watcher.close())
		this.fileWatchers.clear()
	}

	async restartConnectionRPC(serverName: string): Promise<McpServer[]> {
		this.isConnecting = true

		// Get existing connection and update its status
		const connection = this.connections.find((conn) => conn.server.name === serverName)
		const inMemoryConfig = connection?.server.config
		if (inMemoryConfig) {
			connection.server.status = "connecting"
			connection.server.error = ""
			await setTimeoutPromise(500) // artificial delay to show user that server is restarting
			try {
				await this.deleteConnection(serverName)
				// Try to connect again using existing config
				await this.connectToServer(serverName, JSON.parse(inMemoryConfig), "rpc")
			} catch (error) {
				Logger.error(`Failed to restart connection for ${serverName}:`, error)
			}
		}

		this.isConnecting = false

		await this.readAllMcpSettingsFiles()
		return this.getSortedMcpServers(this.lastServerOrder)
	}

	async restartConnection(serverName: string): Promise<void> {
		this.isConnecting = true

		// Get existing connection and update its status
		const connection = this.connections.find((conn) => conn.server.name === serverName)
		const config = connection?.server.config
		if (config) {
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: `Restarting ${serverName} MCP server...`,
			})
			connection.server.status = "connecting"
			connection.server.error = ""
			await this.notifyWebviewOfServerChanges()
			await setTimeoutPromise(500) // artificial delay to show user that server is restarting
			try {
				await this.deleteConnection(serverName)
				// Try to connect again using existing config
				await this.connectToServer(serverName, JSON.parse(config), "internal")
				HostProvider.window.showMessage({
					type: ShowMessageType.INFORMATION,
					message: `${serverName} MCP server connected`,
				})
			} catch (error) {
				Logger.error(`Failed to restart connection for ${serverName}:`, error)
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: `Failed to connect to ${serverName} MCP server`,
				})
			}
		}

		await this.notifyWebviewOfServerChanges()
		this.isConnecting = false
	}

	/**
	 * Gets sorted MCP servers based on the order defined in settings
	 * @param serverOrder Array of server names in the order they appear in settings
	 * @returns Array of McpServer objects sorted according to settings order
	 */
	private getSortedMcpServers(serverOrder: string[]): McpServer[] {
		return [...this.connections]
			.sort((a, b) => {
				const indexA = serverOrder.indexOf(a.server.name)
				const indexB = serverOrder.indexOf(b.server.name)
				if (indexA === -1 && indexB === -1) {
					return a.server.name.localeCompare(b.server.name)
				}
				if (indexA === -1) {
					return 1
				}
				if (indexB === -1) {
					return -1
				}
				return indexA - indexB
			})
			.map((connection) => ({
				...connection.server,
				settingsSource: this.serverSettingsSources.get(connection.server.name) ?? "cline",
				settingsPath: this.serverSettingsFiles.get(connection.server.name),
			}))
	}

	private async notifyWebviewOfServerChanges(): Promise<void> {
		// Servers are sorted by native settings first, then imported Cursor settings.
		if (this.lastServerOrder.length === 0) {
			await this.readAllMcpSettingsFiles()
		}

		// Get sorted servers
		const sortedServers = this.getSortedMcpServers(this.lastServerOrder)

		// Send update using gRPC stream
		await sendMcpServersUpdate({
			mcpServers: convertMcpServersToProtoMcpServers(sortedServers),
		})
	}

	async sendLatestMcpServers() {
		await this.notifyWebviewOfServerChanges()
	}

	async getLatestMcpServersRPC(): Promise<McpServer[]> {
		const settings = await this.readAndValidateMcpSettingsFile()
		if (!settings) {
			// Return empty array if settings can't be read or validated
			return []
		}

		return this.getSortedMcpServers(this.lastServerOrder)
	}

	// Using server

	// Public methods for server management

	public async toggleServerDisabledRPC(serverName: string, disabled: boolean): Promise<McpServer[]> {
		try {
			const { settingsPath, settings: config } = await this.readWritableMcpSettingsForServer(serverName)

			if (config.mcpServers[serverName]) {
				config.mcpServers[serverName].disabled = disabled

				await fs.writeFile(settingsPath, JSON.stringify(config, null, 2))

				const connection = this.connections.find((conn) => conn.server.name === serverName)
				if (connection) {
					connection.server.disabled = disabled
					// When enabling a server, set status to "connecting" so UI shows yellow indicator
					if (!disabled) {
						connection.server.status = "connecting"
						connection.server.error = ""
					}
				}

				await this.readAllMcpSettingsFiles()
				return this.getSortedMcpServers(this.lastServerOrder)
			}
			Logger.error(`Server "${serverName}" not found in MCP configuration`)
			throw new Error(`Server "${serverName}" not found in MCP configuration`)
		} catch (error) {
			Logger.error("Failed to update server disabled state:", error)
			if (error instanceof Error) {
				Logger.error("Error details:", error.message, error.stack)
			}
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Failed to update server state: ${error instanceof Error ? error.message : String(error)}`,
			})
			throw error
		}
	}

	async readResource(serverName: string, uri: string): Promise<McpResourceResponse> {
		const connection = this.connections.find((conn) => conn.server.name === serverName)
		if (!connection) {
			throw new Error(`No connection found for server: ${serverName}`)
		}
		if (connection.server.disabled) {
			throw new Error(`Server "${serverName}" is disabled`)
		}

		return await connection.client.request(
			{
				method: "resources/read",
				params: {
					uri,
				},
			},
			ReadResourceResultSchema,
		)
	}

	async getPrompt(
		serverName: string,
		promptName: string,
		promptArguments?: Record<string, string>,
	): Promise<McpPromptResponse> {
		const connection = this.connections.find((conn) => conn.server.name === serverName)
		if (!connection) {
			throw new Error(`No connection found for server: ${serverName}`)
		}
		if (connection.server.disabled) {
			throw new Error(`Server "${serverName}" is disabled`)
		}
		if (!connection.client) {
			throw new Error(`No client available for server: ${serverName}`)
		}

		const response = await connection.client.request(
			{
				method: "prompts/get",
				params: {
					name: promptName,
					arguments: promptArguments,
				},
			},
			GetPromptResultSchema,
			{
				timeout: DEFAULT_REQUEST_TIMEOUT_MS,
			},
		)

		return {
			description: response.description,
			messages: response.messages.map((msg) => ({
				role: msg.role,
				content: msg.content as McpPromptResponse["messages"][0]["content"],
			})),
		}
	}

	async callTool(
		serverName: string,
		toolName: string,
		toolArguments: Record<string, unknown> | undefined,
		ulid: string,
	): Promise<McpToolCallResponse> {
		const connection = this.connections.find((conn) => conn.server.name === serverName)
		if (!connection) {
			throw new Error(
				`No connection found for server: ${serverName}. Please make sure to use MCP servers available under 'Connected MCP Servers'.`,
			)
		}

		if (connection.server.disabled) {
			throw new Error(`Server "${serverName}" is disabled and cannot be used`)
		}

		let timeout = secondsToMs(DEFAULT_MCP_TIMEOUT_SECONDS) // sdk expects ms

		try {
			const config = JSON.parse(connection.server.config)
			const parsedConfig = ServerConfigSchema.parse(config)
			timeout = secondsToMs(parsedConfig.timeout)
		} catch (error) {
			Logger.error(`Failed to parse timeout configuration for server ${serverName}: ${error}`)
		}

		this.telemetryService.captureMcpToolCall(
			ulid,
			serverName,
			toolName,
			"started",
			undefined,
			toolArguments ? Object.keys(toolArguments) : undefined,
		)

		try {
			const result = await connection.client.request(
				{
					method: "tools/call",
					params: {
						name: toolName,
						arguments: toolArguments ?? {},
					},
				},
				CallToolResultSchema,
				{
					timeout,
				},
			)

			this.telemetryService.captureMcpToolCall(
				ulid,
				serverName,
				toolName,
				"success",
				undefined,
				toolArguments ? Object.keys(toolArguments) : undefined,
			)

			return {
				...result,
				content: result.content ?? [],
			}
		} catch (error) {
			this.telemetryService.captureMcpToolCall(
				ulid,
				serverName,
				toolName,
				"error",
				error instanceof Error ? error.message : String(error),
				toolArguments ? Object.keys(toolArguments) : undefined,
			)
			throw error
		}
	}

	/**
	 * RPC variant of toggleToolAutoApprove that returns the updated servers instead of notifying the webview
	 * @param serverName The name of the MCP server
	 * @param toolNames Array of tool names to toggle auto-approve for
	 * @param shouldAllow Whether to enable or disable auto-approve
	 * @returns Array of updated MCP servers
	 */
	async toggleToolAutoApproveRPC(serverName: string, toolNames: string[], shouldAllow: boolean): Promise<McpServer[]> {
		// Set flag to prevent file watcher from triggering during our update
		this.isUpdatingClineSettings = true
		try {
			const { settingsPath, settings: config } = await this.readWritableMcpSettingsForServer(serverName)

			// Initialize autoApprove if it doesn't exist
			if (!config.mcpServers[serverName].autoApprove) {
				config.mcpServers[serverName].autoApprove = []
			}

			const autoApprove = config.mcpServers[serverName].autoApprove
			for (const toolName of toolNames) {
				const toolIndex = autoApprove.indexOf(toolName)

				if (shouldAllow && toolIndex === -1) {
					// Add tool to autoApprove list
					autoApprove.push(toolName)
				} else if (!shouldAllow && toolIndex !== -1) {
					// Remove tool from autoApprove list
					autoApprove.splice(toolIndex, 1)
				}
			}

			await fs.writeFile(settingsPath, JSON.stringify(config, null, 2))

			// Update the tools list to reflect the change
			const connection = this.connections.find((conn) => conn.server.name === serverName)
			if (connection && connection.server.tools) {
				// Update the autoApprove property of each tool in the in-memory server object
				connection.server.tools = connection.server.tools.map((tool) => ({
					...tool,
					autoApprove: autoApprove.includes(tool.name),
				}))
			}

			// Return sorted servers without notifying webview
			await this.readAllMcpSettingsFiles()
			return this.getSortedMcpServers(this.lastServerOrder)
		} catch (error) {
			Logger.error("Failed to update autoApprove settings:", error)
			throw error // Re-throw to ensure the error is properly handled
		} finally {
			// Clear flag after a delay to ensure file watcher event has been processed
			// The file watcher has a 100ms stabilityThreshold, so we wait a bit longer
			setTimeout(() => {
				this.isUpdatingClineSettings = false
			}, 300)
		}
	}

	async toggleToolAutoApprove(serverName: string, toolNames: string[], shouldAllow: boolean): Promise<void> {
		// Set flag to prevent file watcher from triggering during our update
		this.isUpdatingClineSettings = true
		try {
			const { settingsPath, settings: config } = await this.readWritableMcpSettingsForServer(serverName)

			// Initialize autoApprove if it doesn't exist
			if (!config.mcpServers[serverName].autoApprove) {
				config.mcpServers[serverName].autoApprove = []
			}

			const autoApprove = config.mcpServers[serverName].autoApprove
			for (const toolName of toolNames) {
				const toolIndex = autoApprove.indexOf(toolName)

				if (shouldAllow && toolIndex === -1) {
					// Add tool to autoApprove list
					autoApprove.push(toolName)
				} else if (!shouldAllow && toolIndex !== -1) {
					// Remove tool from autoApprove list
					autoApprove.splice(toolIndex, 1)
				}
			}

			await fs.writeFile(settingsPath, JSON.stringify(config, null, 2))

			// Update the tools list to reflect the change
			const connection = this.connections.find((conn) => conn.server.name === serverName)
			if (connection && connection.server.tools) {
				// Update the autoApprove property of each tool in the in-memory server object
				connection.server.tools = connection.server.tools.map((tool) => ({
					...tool,
					autoApprove: autoApprove.includes(tool.name),
				}))
				await this.notifyWebviewOfServerChanges()
			}
		} catch (error) {
			Logger.error("Failed to update autoApprove settings:", error)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "Failed to update autoApprove settings",
			})
			throw error // Re-throw to ensure the error is properly handled
		} finally {
			// Clear flag after a delay to ensure file watcher event has been processed
			setTimeout(() => {
				this.isUpdatingClineSettings = false
			}, 300)
		}
	}

	public async addRemoteServer(serverName: string, serverUrl: string, transportType = "streamableHttp"): Promise<McpServer[]> {
		// Set flag to prevent file watcher from triggering during our update
		this.isUpdatingClineSettings = true
		try {
			const mergedSettings = await this.readAndValidateMcpSettingsFile()
			const nativeSettings = await this.readNativeMcpSettingsFile()
			if (!mergedSettings || !nativeSettings) {
				throw new Error("Failed to read MCP settings")
			}

			if (mergedSettings.mcpServers[serverName]) {
				throw new Error(`An MCP server with the name "${serverName}" already exists`)
			}

			const serverConfig = {
				url: serverUrl,
				type: transportType,
				disabled: false,
				autoApprove: [],
			}

			// Expand environment variables for validation
			const expandedConfig = expandEnvironmentVariables(serverConfig)

			const urlValidation = z.string().url().safeParse(expandedConfig.url)
			if (!urlValidation.success) {
				throw new Error(`Invalid server URL: ${expandedConfig.url}. Please provide a valid URL.`)
			}

			const parsedConfig = ServerConfigSchema.parse(expandedConfig)

			nativeSettings.mcpServers[serverName] = parsedConfig
			mergedSettings.mcpServers[serverName] = parsedConfig
			const settingsPath = await this.getNativeMcpSettingsFilePath()
			this.serverSettingsFiles.set(serverName, settingsPath)
			this.serverSettingsSources.set(serverName, "cline")

			// We don't write the zod-transformed version to the file.
			// The above parse() call adds the transportType field to the server config
			// It would be fine if this was written, but we don't want to clutter up the file with internal details

			// ToDo: We could benefit from input / output types reflecting the non-transformed / transformed versions
			await fs.writeFile(
				settingsPath,
				JSON.stringify({ mcpServers: { ...nativeSettings.mcpServers, [serverName]: serverConfig } }, null, 2),
			)

			await this.reloadMcpServersFromSettings()

			return this.getSortedMcpServers(this.lastServerOrder)
		} catch (error) {
			Logger.error("Failed to add remote MCP server:", error)
			throw error
		} finally {
			// Clear flag after a delay to ensure file watcher event has been processed
			setTimeout(() => {
				this.isUpdatingClineSettings = false
			}, 300)
		}
	}

	public async addServerFromConfig(serverName: string, serverConfig: McpServerConfig): Promise<McpServer[]> {
		this.isUpdatingClineSettings = true
		try {
			const mergedSettings = await this.readAndValidateMcpSettingsFile()
			const nativeSettings = await this.readNativeMcpSettingsFile()
			if (!mergedSettings || !nativeSettings) {
				throw new Error("Failed to read MCP settings")
			}

			if (mergedSettings.mcpServers[serverName]) {
				throw new Error(`An MCP server with the name "${serverName}" already exists`)
			}

			const parsedConfig = ServerConfigSchema.parse(serverConfig)
			nativeSettings.mcpServers[serverName] = parsedConfig

			const settingsPath = await this.getNativeMcpSettingsFilePath()
			this.serverSettingsFiles.set(serverName, settingsPath)
			this.serverSettingsSources.set(serverName, "cline")
			await fs.writeFile(settingsPath, JSON.stringify({ mcpServers: nativeSettings.mcpServers }, null, 2))

			await this.reloadMcpServersFromSettings()
			return this.getSortedMcpServers(this.lastServerOrder)
		} catch (error) {
			Logger.error("Failed to add MCP server config:", error)
			throw error
		} finally {
			setTimeout(() => {
				this.isUpdatingClineSettings = false
			}, 300)
		}
	}

	/**
	 * RPC variant of deleteServer that returns the updated server list directly
	 * @param serverName The name of the server to delete
	 * @returns Array of remaining MCP servers
	 */
	public async deleteServerRPC(serverName: string): Promise<McpServer[]> {
		// Set flag to prevent file watcher from triggering during our update
		this.isUpdatingClineSettings = true
		try {
			// Clear OAuth data BEFORE removing from config (while we still have the connection/URL)
			await this.clearOAuthForConnection(serverName)

			const { settingsPath, settings: config } = await this.readWritableMcpSettingsForServer(serverName)
			if (!config.mcpServers || typeof config.mcpServers !== "object") {
				config.mcpServers = {}
			}

			if (config.mcpServers[serverName]) {
				delete config.mcpServers[serverName]
				const updatedConfig = {
					mcpServers: config.mcpServers,
				}
				await fs.writeFile(settingsPath, JSON.stringify(updatedConfig, null, 2))
				this.serverSettingsFiles.delete(serverName)
				this.serverSettingsSources.delete(serverName)
				await this.reloadMcpServersFromSettings()

				// Get the servers in their correct order from settings
				return this.getSortedMcpServers(this.lastServerOrder)
			}
			throw new Error(`${serverName} not found in MCP configuration`)
		} catch (error) {
			Logger.error(`Failed to delete MCP server: ${error instanceof Error ? error.message : String(error)}`)
			throw error
		} finally {
			// Clear flag after a delay to ensure file watcher event has been processed
			setTimeout(() => {
				this.isUpdatingClineSettings = false
			}, 300)
		}
	}

	public async updateServerTimeoutRPC(serverName: string, timeout: number): Promise<McpServer[]> {
		// Set flag to prevent file watcher from triggering during our update
		this.isUpdatingClineSettings = true
		try {
			// Validate timeout against schema
			const setConfigResult = BaseConfigSchema.shape.timeout.safeParse(timeout)
			if (!setConfigResult.success) {
				throw new Error(`Invalid timeout value: ${timeout}. Must be at minimum ${MIN_MCP_TIMEOUT_SECONDS} seconds.`)
			}

			const { settingsPath, settings: config } = await this.readWritableMcpSettingsForServer(serverName)

			if (!config.mcpServers?.[serverName]) {
				throw new Error(`Server "${serverName}" not found in settings`)
			}

			config.mcpServers[serverName] = {
				...config.mcpServers[serverName],
				timeout,
			}

			await fs.writeFile(settingsPath, JSON.stringify(config, null, 2))

			// Update in-memory config to reflect the new timeout
			const connection = this.connections.find((conn) => conn.server.name === serverName)
			if (connection) {
				const currentConfig = JSON.parse(connection.server.config)
				currentConfig.timeout = timeout
				connection.server.config = JSON.stringify(currentConfig)
			}

			await this.readAllMcpSettingsFiles()
			return this.getSortedMcpServers(this.lastServerOrder)
		} catch (error) {
			Logger.error("Failed to update server timeout:", error)
			if (error instanceof Error) {
				Logger.error("Error details:", error.message, error.stack)
			}
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Failed to update server timeout: ${error instanceof Error ? error.message : String(error)}`,
			})
			throw error
		} finally {
			// Clear flag after a delay to ensure file watcher event has been processed
			setTimeout(() => {
				this.isUpdatingClineSettings = false
			}, 300)
		}
	}

	/**
	 * Get and clear pending notifications
	 * @returns Array of pending notifications
	 */
	getPendingNotifications(): Array<{
		serverName: string
		level: string
		message: string
		timestamp: number
	}> {
		const notifications = [...this.pendingNotifications]
		this.pendingNotifications = []
		return notifications
	}

	/**
	 * Set the notification callback for real-time notifications
	 * @param callback Function to call when notifications arrive
	 */
	setNotificationCallback(callback: (serverName: string, level: string, message: string) => void): void {
		this.notificationCallback = callback
		//Logger.log("[MCP Debug] Notification callback set")
	}

	/**
	 * Clear the notification callback
	 */
	clearNotificationCallback(): void {
		this.notificationCallback = undefined
		//Logger.log("[MCP Debug] Notification callback cleared")
	}

	/**
	 * Initiates OAuth flow for a server
	 * Opens browser to authorization URL
	 */
	async initiateOAuth(serverName: string): Promise<void> {
		const connection = this.connections.find((conn) => conn.server.name === serverName)
		if (!connection) {
			throw new Error(`No connection found for server: ${serverName}`)
		}

		// Extract serverUrl from config
		const config = JSON.parse(connection.server.config)
		const serverUrl = config.url
		if (!serverUrl) {
			throw new Error(`No URL found in config for server: ${serverName}`)
		}

		// Start OAuth flow - opens the SDK-generated authorization URL in browser
		await this.mcpOAuthManager.startOAuthFlow(serverName, serverUrl)
	}

	/**
	 * Completes OAuth flow after callback
	 * Validates state, calls finishAuth, and reconnects
	 */
	async completeOAuth(serverHash: string, code: string, state: string): Promise<void> {
		// Find the connection by matching the server hash
		const connection = this.connections.find((conn) => {
			const config = JSON.parse(conn.server.config)
			if (config.url) {
				const hash = getServerAuthHash(conn.server.name, config.url)
				return hash === serverHash
			}
			return false
		})

		if (!connection) {
			throw new Error(`No connection found for server hash: ${serverHash}`)
		}

		// Validate state for CSRF protection.
		if (!this.mcpOAuthManager.validateAndClearState(serverHash, state)) {
			throw new Error("Invalid OAuth state - possible CSRF attack")
		}

		// Call finishAuth on the transport - SDK handles token exchange
		// finishAuth is only available on SSE and StreamableHTTP transports
		if (connection.transport instanceof SSEClientTransport || connection.transport instanceof StreamableHTTPClientTransport) {
			await connection.transport.finishAuth(code)
		} else {
			throw new Error("OAuth is only supported for SSE and HTTP transports")
		}

		Logger.log(`[McpOAuth] Authentication completed for ${connection.server.name}`)

		// Update server status
		connection.server.oauthAuthStatus = "authenticated"
		connection.server.oauthRequired = true
		connection.server.error = ""

		// Restart connection to complete setup with authenticated transport
		await this.restartConnection(connection.server.name)
	}

	async dispose(): Promise<void> {
		this.removeAllFileWatchers()
		for (const connection of this.connections) {
			try {
				await this.deleteConnection(connection.server.name)
			} catch (error) {
				Logger.error(`Failed to close connection for ${connection.server.name}:`, error)
			}
		}
		this.connections = []
		if (this.settingsWatcher) {
			await this.settingsWatcher.close()
		}
		if (this.cursorSettingsWatcher) {
			await this.cursorSettingsWatcher.close()
		}
	}
}
