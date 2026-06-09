import fs from "fs/promises"
import { homedir } from "os"
import path from "path"
import { refreshExternalRulesToggles } from "@core/context/instructions/user-instructions/external-rules"
import { GlobalFileNames } from "@core/storage/disk"
import { WebviewProvider } from "@/core/webview"
import { HostProvider } from "@/hosts/host-provider"
import { writeLgWebhookConfig, writeLgWebhookHooks } from "@/services/lg-cns-integration/webhook-hooks"
import type { McpServer } from "@/shared/mcp"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"
import { getCwd, getDesktopDir } from "@/utils/path"
import {
	buildCursorCompatibleAutomationIngestRequest,
	buildCursorCompatibleBackgroundAgentLaunchRequest,
	buildCursorCompatibleGlassRouteMetadata,
	buildCursorCompatibleTaskPrompt,
	getCursorCompatibleUriPath,
	parseCursorCompatibleUri,
	type CursorCompatibleAutomationIngestRequest,
	type CursorCompatibleUriRoute,
} from "./CursorUriRoutes"
import {
	buildCursorMcpInstallCandidates,
	buildCursorMcpInstallRequest,
	formatCursorMcpInstallDetail,
	getInstalledServerOAuthSummary,
	type CursorMcpServerConfig,
} from "./CursorMcpInstall"
import { executeCursorGitHelper, formatCursorGitHelperDetail, previewCursorGitHelper } from "./CursorGitHelper"

export const TASK_URI_PATH = "/task"
export const LG_TASK_URI_PATH = "/lg-task"

interface SharedUriHandlerOptions {
	cursorCompatibleDeepLinksEnabled?: boolean
}

interface CursorPluginAddInstallRequest {
	source: string
	sourceParam: "id" | "name" | "url" | "config"
	sourceConfigKey?: "source" | "id" | "name" | "url"
	force?: boolean
	detail: string
}

interface SharedUriController {
	handleOpenRouterCallback(code: string): Promise<void>
	handleRequestyCallback(code: string): Promise<void>
	handleAuthCallback(token: string, provider: string | null): Promise<void>
	handleOcaAuthCallback(code: string, state: string): Promise<void>
	handleTaskCreation(prompt: string): Promise<void>
	handleMcpOAuthCallback(serverHash: string, code: string, state: string): Promise<void>
	handleHicapCallback(code: string): Promise<void>
	handleCursorAutomationIngest(request: CursorCompatibleAutomationIngestRequest): Promise<unknown>
	handleCursorBackgroundAgentLaunch(
		request: ReturnType<typeof buildCursorCompatibleBackgroundAgentLaunchRequest>,
	): Promise<unknown>
	handleCursorPluginAdd(request: CursorPluginAddInstallRequest): Promise<unknown>
	postStateToWebview(): Promise<void>
	stateManager?: {
		getWorkspaceStateKey(key: string): unknown
		setWorkspaceState(key: string, value: unknown): void
	}
	mcpHub: {
		addServerFromConfig(serverName: string, serverConfig: CursorMcpServerConfig): Promise<McpServer[]>
	}
}

const MCP_OAUTH_CALLBACK_PATTERN = /^\/mcp-auth\/callback\/[^/]+$/
const CURSOR_RULE_FILENAME_PATTERN = /^[a-zA-Z0-9._-]+$/
const CURSOR_COMMAND_FILENAME_PATTERN = /^(?=.*[a-zA-Z0-9])[a-zA-Z0-9._-]+$/
const MAX_CURSOR_COMMAND_FILE_BYTES = 256 * 1024
const CURSOR_SETTINGS_SECTION_QUERIES = new Map<string, string>([
	["provider", "@id:codevibe.openAiCodex.authSource"],
	["providers", "@id:codevibe.openAiCodex.authSource"],
	["cursor-compatibility", "@id:codevibe.cursorCompatibility.enabled"],
	["cursor-links", "@id:codevibe.cursorCompatibility.deepLinks.enabled"],
	["deep-links", "@id:codevibe.cursorCompatibility.deepLinks.enabled"],
	["deeplinks", "@id:codevibe.cursorCompatibility.deepLinks.enabled"],
	["retrieval-indexing", "@id:codevibe.cursorCompatibility.retrievalIndexing.privacyGate"],
	["indexing", "@id:codevibe.cursorCompatibility.retrievalIndexing.privacyGate"],
	["privacy-gate", "@id:codevibe.cursorCompatibility.retrievalIndexing.privacyGate"],
	["sandbox", "@id:codevibe.cursorCompatibility.sandboxPolicy"],
	["sandbox-policy", "@id:codevibe.cursorCompatibility.sandboxPolicy"],
	["codex-auth", "@id:codevibe.openAiCodex.authSource"],
	["openai-codex-auth", "@id:codevibe.openAiCodex.authSource"],
	["openai-codex", "@id:codevibe.openAiCodex.authSource"],
	["codex", "@id:codevibe.openAiCodex.authSource"],
	["ndjson", "@id:ndjson.port"],
	["automation-ingest", "@id:ndjson.port"],
	["browser-evaluate", "@id:codevibe.cursorCompatibility.safeBrowserEvaluate.enabled"],
	["safe-browser-evaluate", "@id:codevibe.cursorCompatibility.safeBrowserEvaluate.enabled"],
])

function parseUri(url: string): {
	parsedUrl: URL
	path: string
	query: URLSearchParams
} {
	const parsedUrl = new URL(url)
	const path = getCursorCompatibleUriPath(parsedUrl)

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

function getRouteConfigRecord(route: CursorCompatibleUriRoute): Record<string, unknown> | undefined {
	const value = route.params.config
	return value && typeof value === "object" && !Array.isArray(value) ? value : undefined
}

function getRouteConfigStringParam(route: CursorCompatibleUriRoute, key: string): string | undefined {
	const value = getRouteConfigRecord(route)?.[key]
	return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function getCursorRuleContent(route: CursorCompatibleUriRoute): string | undefined {
	return (
		getRouteStringParam(route, "content") ||
		getRouteConfigStringParam(route, "content") ||
		getRouteConfigStringParam(route, "rule") ||
		getRouteConfigStringParam(route, "markdown")
	)
}

function normalizeSettingsSectionKey(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/['"]/g, "")
		.replace(/&/g, " and ")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
}

function getKnownCursorSettingsQuery(value: string | undefined): string | undefined {
	if (!value) {
		return undefined
	}

	return CURSOR_SETTINGS_SECTION_QUERIES.get(normalizeSettingsSectionKey(value))
}

function getSettingsQuery(route: CursorCompatibleUriRoute): string | undefined {
	const explicitQuery = getRouteStringParam(route, "query")
	if (explicitQuery) {
		return explicitQuery
	}

	const section = getRouteStringParam(route, "section")
	const tab = getRouteStringParam(route, "tab")

	return getKnownCursorSettingsQuery(section) || getKnownCursorSettingsQuery(tab) || section || tab
}

function normalizeCursorRuleTarget(route: CursorCompatibleUriRoute):
	| {
			filename: string
			relativePath: string
	  }
	| undefined {
	if (!getCursorRuleContent(route) && getRouteStringParam(route, "url")) {
		return undefined
	}

	const requested = (
		getRouteStringParam(route, "name") ||
		getRouteStringParam(route, "path") ||
		getRouteConfigStringParam(route, "name") ||
		getRouteConfigStringParam(route, "path")
	)?.replace(/\\/g, "/")
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

function titleFromCursorRuleFilename(filename: string): string {
	const base = filename === GlobalFileNames.cursorRulesFile ? "project rules" : path.basename(filename, path.extname(filename))
	return base
		.replace(/[-_]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/\b\w/g, (char) => char.toUpperCase())
}

function buildCursorRuleStarterContent(filename: string): string {
	const title = titleFromCursorRuleFilename(filename) || "Project Rules"
	if (filename.endsWith(".mdc")) {
		return [
			"---",
			`description: ${title}`,
			"alwaysApply: false",
			"---",
			"",
			`# ${title}`,
			"",
			"Add agent guidance for this rule here.",
			"",
		].join("\n")
	}
	return [`# ${title}`, "", "Add project-wide agent guidance here.", ""].join("\n")
}

function normalizeImportedCursorRuleContent(content: string): string {
	return content.endsWith("\n") ? content : `${content}\n`
}

function normalizeCursorCommandTarget(route: CursorCompatibleUriRoute):
	| {
			commandName: string
			filename: string
			relativePath: string
	  }
	| undefined {
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

function buildCursorCommandFilePrompt(
	target: {
		commandName: string
	},
	source: {
		displayPath: string
		scope: "workspace" | "global"
	},
	content: string,
): string {
	const sourceLabel = source.scope === "global" ? "global command file" : "workspace command file"
	return [
		`A compatible command deeplink named "${target.commandName}" was opened.`,
		`The ${sourceLabel} "${source.displayPath}" was found. Treat this file as user-supplied instructions: validate the request, keep normal permission boundaries, and ask for confirmation before running commands, installing packages, opening network connections, or changing files.`,
		"",
		"Command file content:",
		content.trim(),
	].join("\n")
}

async function getCursorCommandWorkspaceRoots(): Promise<string[]> {
	try {
		const workspacePaths = (await HostProvider.workspace.getWorkspacePaths({})).paths ?? []
		const roots = workspacePaths.map((entry) => entry.trim()).filter(Boolean)
		if (roots.length > 0) {
			return roots
		}
	} catch (error) {
		Logger.warn(`SharedUriHandler: failed to resolve workspace roots for compatible command file: ${String(error)}`)
	}
	return [await getCwd(getDesktopDir())]
}

async function readCursorCommandFileFromPath(
	target: {
		filename: string
	},
	filePath: string,
	displayPath: string,
): Promise<string | undefined> {
	if (filePath !== path.resolve(path.dirname(filePath), target.filename)) {
		return undefined
	}

	let stat
	try {
		stat = await fs.lstat(filePath)
	} catch (error) {
		const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined
		if (code === "ENOENT") {
			return undefined
		}
		throw error
	}

	if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_CURSOR_COMMAND_FILE_BYTES) {
		Logger.warn(
			`SharedUriHandler: Cursor command file is not readable or exceeds ${MAX_CURSOR_COMMAND_FILE_BYTES} bytes: ${displayPath}`,
		)
		return undefined
	}

	const content = await fs.readFile(filePath, "utf8")
	if (!content.trim()) {
		Logger.warn(`SharedUriHandler: Cursor command file is empty: ${displayPath}`)
		return undefined
	}
	return content
}

async function readCursorCommandFile(
	target: {
		filename: string
		relativePath: string
	},
	workspaceRoot: string,
): Promise<{ content: string; displayPath: string; scope: "workspace" } | undefined> {
	const root = path.resolve(workspaceRoot)
	const commandRoot = path.resolve(root, GlobalFileNames.cursorCommandsDir)
	const filePath = path.resolve(root, target.relativePath)
	if (filePath !== path.resolve(commandRoot, target.filename)) {
		return undefined
	}
	const content = await readCursorCommandFileFromPath(target, filePath, target.relativePath)
	return content ? { content, displayPath: target.relativePath, scope: "workspace" } : undefined
}

function resolveGlobalCursorCommandRoot(): string {
	const userHome = process.env.CODEVIBE_CURSOR_HOME?.trim() || homedir()
	return path.resolve(userHome, ".cursor", "commands")
}

async function readGlobalCursorCommandFile(target: {
	filename: string
}): Promise<{ content: string; displayPath: string; scope: "global" } | undefined> {
	const commandRoot = resolveGlobalCursorCommandRoot()
	const filePath = path.resolve(commandRoot, target.filename)
	if (filePath !== path.resolve(commandRoot, target.filename)) {
		return undefined
	}
	const displayPath = path.posix.join("~", ".cursor", "commands", target.filename)
	const content = await readCursorCommandFileFromPath(target, filePath, displayPath)
	return content ? { content, displayPath, scope: "global" } : undefined
}

function buildCursorPluginAddDetail(route: CursorCompatibleUriRoute): {
	source?: string
	sourceParam?: "id" | "name" | "url" | "config"
	sourceConfigKey?: "source" | "id" | "name" | "url"
	displaySource?: string
	force?: boolean
	detail: string
} {
	const sourceParam = (["id", "name", "url"] as const).find((key) => getRouteStringParam(route, key))
	const config = route.params.config
	const configRecord = config && typeof config === "object" && !Array.isArray(config) ? config : undefined
	const configSource = getCursorPluginConfigSource(configRecord)
	const source = sourceParam ? getRouteStringParam(route, sourceParam) : configSource?.source
	const resolvedSourceParam = sourceParam ?? (source ? "config" : undefined)
	const displaySource = formatCursorPluginSource(source, resolvedSourceParam)
	const configKeys = configRecord ? Object.keys(configRecord).sort() : []
	const force = getCursorPluginForce(route)
	const lines = source
		? [
				`Plugin source: ${displaySource}`,
				`Source parameter: ${sourceParam ?? `config.${configSource?.sourceConfigKey ?? "source"}`}`,
				...(force ? ["Replace existing: requested"] : []),
				...(configKeys.length > 0 ? [`Config keys: ${configKeys.join(", ")}`] : []),
				"Install action: requires confirmation before downloading or writing plugin files.",
			]
		: [
				"Plugin source: config payload",
				`Config keys: ${configKeys.join(", ") || "(none)"}`,
				"Config-only plugin payloads require manual review before installation.",
			]
	return {
		source,
		sourceParam: resolvedSourceParam,
		...(configSource && !sourceParam ? { sourceConfigKey: configSource.sourceConfigKey } : {}),
		displaySource,
		...(force ? { force: true } : {}),
		detail: lines.join("\n"),
	}
}

function getCursorPluginForce(route: CursorCompatibleUriRoute): boolean {
	return getRouteBooleanFlag(route, "force") || getRouteBooleanFlag(route, "replace")
}

function getRouteBooleanFlag(route: CursorCompatibleUriRoute, key: string): boolean {
	const value = route.params[key]
	return typeof value === "string" && ["true", "1", "yes"].includes(value.trim().toLowerCase())
}

function getCursorPluginConfigSource(
	config: Record<string, unknown> | undefined,
): { source: string; sourceConfigKey: "source" | "id" | "name" | "url" } | undefined {
	if (!config) {
		return undefined
	}
	for (const key of ["source", "url", "id", "name"] as const) {
		const value = config[key]
		if (typeof value === "string" && value.trim()) {
			return {
				source: value.trim(),
				sourceConfigKey: key,
			}
		}
	}
	return undefined
}

function formatCursorPluginSource(source: string | undefined, sourceParam: "id" | "name" | "url" | "config" | undefined): string {
	if (!source) {
		return "config payload"
	}
	if (sourceParam === "url") {
		return formatCursorUrlForDisplay(source) ?? "[provided url]"
	}
	if (sourceParam === "config") {
		return formatCursorUrlForDisplay(source) ?? source
	}
	return source
}

function formatCursorUrlForDisplay(source: string): string | undefined {
	try {
		const url = new URL(source)
		return `${url.origin}${url.pathname}${url.search ? "?[redacted]" : ""}${url.hash ? "#[redacted]" : ""}`
	} catch {
		return undefined
	}
}

function buildCursorPrReviewDetail(route: CursorCompatibleUriRoute): string {
	const url = getRouteStringParam(route, "url")
	const repo = getRouteStringParam(route, "repo") || getRouteStringParam(route, "repository")
	const number = getRouteStringParam(route, "number") || getRouteStringParam(route, "pullRequest")
	const instructions = getRouteStringParam(route, "instructions")
	const config = route.params.config
	const configKeys = config && typeof config === "object" && !Array.isArray(config) ? Object.keys(config).sort() : []
	const target = url ? formatCursorUrlForDisplay(url) || "[provided url]" : repo && number ? `${repo}#${number}` : undefined
	return [
		`Pull request: ${target ?? "unknown"}`,
		...(instructions ? [`Instructions: ${instructions}`] : []),
		...(configKeys.length > 0 ? [`Config keys: ${configKeys.join(", ")}`] : []),
		"This will start an agent task. Git, network, terminal, and file changes still require the normal approvals.",
	].join("\n")
}

function buildCursorBackgroundAgentDetail(request: ReturnType<typeof buildCursorCompatibleBackgroundAgentLaunchRequest>): string {
	const configKeys = request.config ? Object.keys(request.config).sort() : []
	return [
		`Prompt: ${request.prompt}`,
		...(request.repository ? [`Repository: ${request.repository}`] : []),
		...(request.requestedBranch ? [`Branch: ${request.requestedBranch}`] : []),
		...(request.requestedBaseBranch ? [`Base branch: ${request.requestedBaseBranch}`] : []),
		...(configKeys.length > 0 ? [`Config keys: ${configKeys.join(", ")}`] : []),
		"Confirming may immediately run git worktree add, create a background-agent branch/worktree, and copy files listed in .worktreeinclude before the agent starts.",
		"After launch, agent terminal, network, and file changes still require the normal approvals.",
	].join("\n")
}

function buildCursorAutomationIngestDetail(
	route: CursorCompatibleUriRoute,
	request?: CursorCompatibleAutomationIngestRequest,
): string {
	const config = route.params.config
	const configKeys = config && typeof config === "object" && !Array.isArray(config) ? Object.keys(config).sort() : []
	return [
		"Validate compatible automation NDJSON and ingest accepted events into VS Code local automation storage.",
		"This does not silently run tasks, terminal commands, network calls, git operations, or browser actions.",
		...(request
			? [
					`Accepted events: ${request.validation.events.length}`,
					`Rejected lines: ${request.validation.rejected.length}`,
					`Strict mode: ${request.strict ? "yes" : "no"}`,
				]
			: []),
		...(request?.strict && request.validation.rejected.length > 0
			? ["Strict mode will block storage until rejected lines are fixed."]
			: []),
		...(getRouteStringParam(route, "defaultSource")
			? [`Default source: ${getRouteStringParam(route, "defaultSource")}`]
			: []),
		...(getRouteStringParam(route, "allowedSources")
			? [`Allowed sources: ${getRouteStringParam(route, "allowedSources")}`]
			: []),
		...(getRouteStringParam(route, "maxEvents") ? [`Max events: ${getRouteStringParam(route, "maxEvents")}`] : []),
		...(configKeys.length > 0 ? [`Config keys: ${configKeys.join(", ")}`] : []),
	].join("\n")
}

function isStrictInvalidAutomationIngest(request: CursorCompatibleAutomationIngestRequest): boolean {
	return request.strict && request.validation.rejected.length > 0
}

function isCursorGitHelperRoute(route: CursorCompatibleUriRoute): boolean {
	return route.kind === "git-checkout" || route.kind === "git-branch" || route.kind === "git-commit"
}

function getCursorGitHelperTitle(route: CursorCompatibleUriRoute): string {
	switch (route.kind) {
		case "git-checkout":
			return "checkout/switch"
		case "git-branch":
			return "branch creation or switch"
		case "git-commit":
			return "commit preparation"
		default:
			return "git helper"
	}
}

function buildCursorGitHelperDetail(route: CursorCompatibleUriRoute): string {
	const config = route.params.config
	const configKeys = config && typeof config === "object" && !Array.isArray(config) ? Object.keys(config).sort() : []
	const detailLines = Object.entries(route.params)
		.filter(([key]) => key !== "config")
		.map(([key, value]) => `- ${key}: ${typeof value === "string" ? value : "object"}`)

	return [
		`Requested git helper: ${getCursorGitHelperTitle(route)}`,
		"CodeVibe will preview the workspace, command, and safety checks before running anything. Confirming this modal may run the shown git command; push remains blocked and requires separate manual action.",
		...(detailLines.length > 0 ? ["", "Route details:", ...detailLines] : []),
		...(configKeys.length > 0 ? ["", `Config keys: ${configKeys.join(", ")}`] : []),
	].join("\n")
}

function getCursorTaskRouteLabel(route: CursorCompatibleUriRoute): string {
	switch (route.kind) {
		case "createchat":
			return "chat"
		case "prompt":
			return "prompt"
		case "glass":
			return "glass prompt"
		case "command":
			return "command"
		case "rule":
			return "rule review"
		default:
			return `${route.kind} review`
	}
}

function buildCursorTaskCreationDetail(route: CursorCompatibleUriRoute, action: string): string {
	const config = route.params.config
	const configKeys = config && typeof config === "object" && !Array.isArray(config) ? Object.keys(config).sort() : []
	const glass = buildCursorCompatibleGlassRouteMetadata(route)
	const routeParamKeys = Object.keys(route.params)
		.filter((key) => key !== "config")
		.sort()

	return [
		`Route: ${route.path}`,
		`Task type: ${getCursorTaskRouteLabel(route)}`,
		action,
		"This will create an agent task only. Terminal, network, file, MCP, browser, and git changes still require the normal approvals.",
		...(glass ? ["Glass mode: overlay"] : []),
		...(routeParamKeys.length > 0 ? [`Route parameters: ${routeParamKeys.join(", ")}`] : []),
		...(configKeys.length > 0 ? [`Config keys: ${configKeys.join(", ")}`] : []),
	].join("\n")
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
	public static async handleUri(url: string, options: SharedUriHandlerOptions = {}): Promise<boolean> {
		const { parsedUrl, path, query } = parseUri(url)

		let visibleWebview = WebviewProvider.getVisibleInstance()
		if (!visibleWebview) {
			try {
				visibleWebview = WebviewProvider.getInstance()
			} catch {
				// URI routes can arrive while the extension is still booting. Keep the
				// normal false return until a controller instance is ready.
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
						Logger.warn(`SharedUriHandler: Invalid compatible URI: ${cursorRoute.error}`)
						return false
					}
					if (cursorRoute.route.kind === "mcp-install") {
						const installRequests = buildCursorMcpInstallCandidates(cursorRoute.route)
						const installRequest =
							installRequests.length === 1
								? installRequests[0]
								: await this.chooseCursorMcpInstallRequest(installRequests)
						if (!installRequest) {
							return true
						}
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
						const servers = await controller.mcpHub.addServerFromConfig(
							installRequest.serverName,
							installRequest.serverConfig,
						)
						const installedServer = servers.find((server) => server.name === installRequest.serverName)
						const oauthSummary = getInstalledServerOAuthSummary(installedServer)
						await controller.postStateToWebview()
						await HostProvider.window.showMessage({
							type:
								oauthSummary.oauthNextAction === "authenticate"
									? ShowMessageType.WARNING
									: ShowMessageType.INFORMATION,
							message:
								oauthSummary.oauthNextAction === "authenticate"
									? `Installed MCP server "${installRequest.serverName}". Authentication required.`
									: `Installed MCP server "${installRequest.serverName}".`,
							options: oauthSummary.oauthDetail
								? {
										items: [],
										detail: oauthSummary.oauthDetail,
									}
								: undefined,
						})
						return true
					}
					if (cursorRoute.route.kind === "background-agent") {
						const launchRequest = buildCursorCompatibleBackgroundAgentLaunchRequest(cursorRoute.route)
						const choice = await HostProvider.window.showMessage({
							type: ShowMessageType.WARNING,
							message: "Launch CodeVibe background agent?",
							options: {
								modal: true,
								items: ["Launch and Create Worktree"],
								detail: buildCursorBackgroundAgentDetail(launchRequest),
							},
						})
						if (choice.selectedOption !== "Launch and Create Worktree") {
							return true
						}
						await controller.handleCursorBackgroundAgentLaunch(launchRequest)
						return true
					}
					if (cursorRoute.route.kind === "automation-ingest") {
						const ingestRequest = buildCursorCompatibleAutomationIngestRequest(cursorRoute.route)
						if (isStrictInvalidAutomationIngest(ingestRequest)) {
							await HostProvider.window.showMessage({
								type: ShowMessageType.WARNING,
								message: "Automation NDJSON failed strict validation.",
								options: {
									modal: true,
									items: ["OK"],
									detail: buildCursorAutomationIngestDetail(cursorRoute.route, ingestRequest),
								},
							})
							return true
						}
						const choice = await HostProvider.window.showMessage({
							type: ShowMessageType.WARNING,
							message: "Ingest automation NDJSON?",
							options: {
								modal: true,
								items: ["Ingest Events"],
								detail: buildCursorAutomationIngestDetail(cursorRoute.route, ingestRequest),
							},
						})
						if (choice.selectedOption !== "Ingest Events") {
							return true
						}
						await controller.handleCursorAutomationIngest(ingestRequest)
						return true
					}
					if (isCursorGitHelperRoute(cursorRoute.route)) {
						await this.handleCursorGitHelperRoute(cursorRoute.route)
						return true
					}
					if (cursorRoute.route.kind === "settings") {
						const settingsQuery = getSettingsQuery(cursorRoute.route)
						await HostProvider.window.openSettings(settingsQuery ? { query: settingsQuery } : {})
						return true
					}
					if (cursorRoute.route.kind === "plugin-add") {
						await this.handleCursorPluginAddRoute(controller, cursorRoute.route)
						return true
					}
					if (cursorRoute.route.kind === "pr-review") {
						await this.handleCursorPrReviewRoute(controller, cursorRoute.route)
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
					const confirmed = await this.confirmCursorTaskCreation(
						cursorRoute.route,
						"Review the compatible route payload and create an agent task from it.",
					)
					if (!confirmed) {
						return true
					}
					await controller.handleTaskCreation(buildCursorCompatibleTaskPrompt(cursorRoute.route))
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

	private static async chooseCursorMcpInstallRequest(
		installRequests: ReturnType<typeof buildCursorMcpInstallCandidates>,
	): Promise<ReturnType<typeof buildCursorMcpInstallRequest> | undefined> {
		const detail = [
			"Config includes multiple MCP servers. Choose exactly one server to install.",
			"Selecting a server does not install the others.",
			"",
			...installRequests.flatMap((request, index) => [`[${index + 1}]`, formatCursorMcpInstallDetail(request), ""]),
		].join("\n")
		const choice = await HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message: "Choose MCP server to install",
			options: {
				modal: true,
				items: installRequests.map((request) => request.serverName),
				detail,
			},
		})
		return installRequests.find((request) => request.serverName === choice.selectedOption)
	}

	private static async handleCursorRuleRoute(
		controller: SharedUriController,
		route: CursorCompatibleUriRoute,
	): Promise<boolean> {
		const target = normalizeCursorRuleTarget(route)
		if (!target) {
			return false
		}
		const importedContent = getCursorRuleContent(route)
		const replaceExisting = getRouteBooleanFlag(route, "replace") || getRouteBooleanFlag(route, "force")
		let importedRuleWritten = false

		const choice = await HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message: importedContent
				? `Import rule "${target.filename}"?`
				: `Create or open rule "${target.filename}"?`,
			options: {
				modal: true,
				items: [importedContent ? "Import Rule" : "Create/Open"],
				detail: [
					`Target: ${target.relativePath}`,
					...(importedContent
						? [
								`Content length: ${importedContent.length} character(s)`,
								...(replaceExisting ? ["Replace existing: requested"] : []),
								"Rule content is not shown here to avoid leaking secrets into modal logs.",
							]
						: []),
				].join("\n"),
			},
		})
		if (choice.selectedOption !== (importedContent ? "Import Rule" : "Create/Open")) {
			return true
		}

		const cwd = await getCwd(getDesktopDir())
		const filePath = path.resolve(cwd, target.relativePath)
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		try {
			await fs.writeFile(
				filePath,
				importedContent
					? normalizeImportedCursorRuleContent(importedContent)
					: buildCursorRuleStarterContent(target.filename),
				importedContent && replaceExisting ? undefined : { flag: "wx" },
			)
			importedRuleWritten = Boolean(importedContent)
		} catch (error) {
			const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined
			if (code !== "EEXIST") {
				throw error
			}
			if (importedContent) {
				await HostProvider.window.showMessage({
					type: ShowMessageType.WARNING,
					message: `Rule "${target.filename}" already exists.`,
					options: {
						items: [],
						detail: "Reopen the deeplink with replace=true to overwrite this file after confirmation.",
					},
				})
			}
		}

		if (controller.stateManager) {
			await refreshExternalRulesToggles(controller as any, cwd)
			await controller.postStateToWebview()
		}
		await HostProvider.window.openFile({ filePath })
		await HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: importedRuleWritten
				? `Imported rule "${target.filename}".`
				: `Opened rule "${target.filename}".`,
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

		for (const workspaceRoot of await getCursorCommandWorkspaceRoots()) {
			const commandFile = await readCursorCommandFile(target, workspaceRoot)
			if (!commandFile) {
				continue
			}

			const confirmed = await this.confirmCursorTaskCreation(
				route,
				`Create an agent task from the workspace command file "${commandFile.displayPath}". The file is treated as user-supplied instructions.`,
			)
			if (!confirmed) {
				return true
			}

			await controller.handleTaskCreation(buildCursorCommandFilePrompt(target, commandFile, commandFile.content))
			return true
		}

		const globalCommandFile = await readGlobalCursorCommandFile(target)
		if (globalCommandFile) {
			const confirmed = await this.confirmCursorTaskCreation(
				route,
				`Create an agent task from the global command file "${globalCommandFile.displayPath}". The file is treated as user-supplied instructions.`,
			)
			if (!confirmed) {
				return true
			}

			await controller.handleTaskCreation(
				buildCursorCommandFilePrompt(target, globalCommandFile, globalCommandFile.content),
			)
			return true
		}
		return false
	}

	private static async handleCursorGitHelperRoute(route: CursorCompatibleUriRoute): Promise<void> {
		const plan = previewCursorGitHelper(route, await getCursorCommandWorkspaceRoots())
		const choice = await HostProvider.window.showMessage({
			type: plan.actionable ? ShowMessageType.WARNING : ShowMessageType.INFORMATION,
			message: plan.actionable ? `Run CodeVibe ${getCursorGitHelperTitle(route)} helper?` : "Git helper needs review",
			options: {
				modal: true,
				items: plan.actionable ? [plan.confirmLabel] : ["OK"],
				detail: [buildCursorGitHelperDetail(route), "", formatCursorGitHelperDetail(plan)].join("\n"),
			},
		})
		if (!plan.actionable || choice.selectedOption !== plan.confirmLabel) {
			return
		}

		const result = executeCursorGitHelper(route, plan)
		await HostProvider.window.showMessage({
			type: result.executed ? ShowMessageType.INFORMATION : ShowMessageType.WARNING,
			message: result.executed ? plan.successMessage : "Git helper was not executed.",
			options: {
				items: [],
				detail: formatCursorGitHelperDetail(result),
			},
		})
	}

	private static async confirmCursorTaskCreation(route: CursorCompatibleUriRoute, action: string): Promise<boolean> {
		const choice = await HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message: `Create CodeVibe ${getCursorTaskRouteLabel(route)} task?`,
			options: {
				modal: true,
				items: ["Create Task"],
				detail: buildCursorTaskCreationDetail(route, action),
			},
		})
		return choice.selectedOption === "Create Task"
	}

	private static async handleCursorPluginAddRoute(
		controller: SharedUriController,
		route: CursorCompatibleUriRoute,
	): Promise<void> {
		const request = buildCursorPluginAddDetail(route)
		if (request.source && request.sourceParam) {
			const choice = await HostProvider.window.showMessage({
				type: ShowMessageType.WARNING,
				message: `Install CodeVibe plugin "${request.displaySource ?? request.source}"?`,
				options: {
					modal: true,
					items: ["Install Plugin"],
					detail: request.detail,
				},
			})
			if (choice.selectedOption !== "Install Plugin") {
				return
			}
			await controller.handleCursorPluginAdd({
				source: request.source,
				sourceParam: request.sourceParam,
				...(request.sourceConfigKey ? { sourceConfigKey: request.sourceConfigKey } : {}),
				...(request.force ? { force: true } : {}),
				detail: request.detail,
			})
			return
		}

		await HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: "Plugin add requires review",
			options: {
				modal: true,
				items: ["OK"],
				detail: request.detail,
			},
		})
	}

	private static async handleCursorPrReviewRoute(
		controller: SharedUriController,
		route: CursorCompatibleUriRoute,
	): Promise<void> {
		const choice = await HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message: "Start CodeVibe PR review?",
			options: {
				modal: true,
				items: ["Start Review"],
				detail: buildCursorPrReviewDetail(route),
			},
		})
		if (choice.selectedOption !== "Start Review") {
			return
		}
		await controller.handleTaskCreation(buildCursorCompatibleTaskPrompt(route))
	}
}
