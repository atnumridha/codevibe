import { execFileSync, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import type {
	ClineAutomationNdjsonIngressResult,
	ClineAccountActionRequest,
	CursorAgentTaskRouteRequest,
	CursorAutomationIngestRouteRequest,
	CursorMcpInstallRequest,
	CursorPluginAddRouteRequest,
	CursorRuleRouteRequest,
	ProviderCapability,
	ProviderClient,
	ProviderProtocol,
	SaveProviderSettingsActionRequest,
} from "@cline/core";
import {
	addLocalProvider,
	buildCursorAgentTaskRouteRequest,
	buildCursorAutomationIngestRouteRequest,
	buildCursorMcpInstallRequest,
	buildCursorPluginAddRouteRequest,
	buildCursorRuleRouteRequest,
	ClineAccountService,
	ClineCore,
	createLocalHubScheduleRuntimeHandlers,
	createUserInstructionConfigService,
	discoverPluginModulePaths,
	ensureCustomProvidersLoaded,
	ensureHubServer,
	executeClineAccountAction,
	getCoreBuiltinToolCatalog,
	getLocalProviderModels,
	HubScheduleCommandService,
	HubScheduleService,
	listHookConfigFiles,
	listLocalProviders,
	listPluginTools,
	loginLocalProvider,
	installPlugin,
	normalizeOAuthProvider,
	normalizeCursorMcpSettingsObject,
	ProviderSettingsManager,
	readGlobalSettings,
	resolveLocalClineAuthToken,
	resolvePluginConfigSearchPaths,
	resolveSessionBackend,
	resolveAgentConfigSearchPaths as resolveSharedAgentConfigSearchPaths,
	SqliteSessionStore,
	saveLocalProviderOAuthCredentials,
	saveLocalProviderSettings,
	sendHubCommand,
	setDisabledPlugin,
	setDisabledTools,
	toggleDisabledTool,
	DefaultToolNames,
} from "@cline/core";
import type {
	CursorUriPreviewRequest,
	CursorUriPreviewResponse,
} from "@cline/shared";
import { getClineEnvironmentConfig } from "@cline/shared";
import { broadcastEvent, resolveSidecarAskQuestion } from "./context";
import {
	findArtifactUnderDir,
	readSessionManifest,
	resolveMcpSettingsPath,
	rootSessionIdFrom,
	sessionLogPath,
	sharedSessionDataDir,
} from "./paths";
import { readSessionHooks } from "./session-data/artifacts";
import { normalizeSessionTitle } from "./session-data/common";
import { discoverChatSessions } from "./session-data/discovery";
import { readSessionMessages } from "./session-data/messages";
import { searchWorkspaceFiles } from "./session-data/search";
import type {
	ChatSessionCommandRequest,
	JsonRecord,
	SidecarContext,
} from "./types";

const DEFAULT_CODEVIBE_PROVIDER_ID = "openai-codex";
const DEFAULT_CODEVIBE_MODEL_ID = "gpt-5.5";
const CURSOR_URI_LAUNCHABLE_AGENT_PATHS = new Set([
	"/createchat",
	"/background-agent",
	"/prompt",
	"/command",
	"/pr-review",
	"/glass",
	"/git/checkout",
	"/git/branch",
	"/git/commit",
]);

type CursorUriLaunchResponse = {
	handled: true;
	launched: true;
	route: string;
	path?: string;
	backgroundAgent: boolean;
	backgroundAgentDetails?: JsonRecord;
	sessionId: string;
	provider: string;
	model: string;
	mode: "plan";
	queued: true;
	metadata: JsonRecord;
	preview: CursorUriPreviewResponse;
};

type CursorAutomationIngestResponse = {
	handled: true;
	route: "automation-ingest";
	confirmed: boolean;
	ingested: boolean;
	valid: boolean;
	strict: boolean;
	strictFailed: boolean;
	eventCount: number;
	rejectedCount: number;
	queuedRunCount: number;
	duplicateCount: number;
	matchedSpecIds: string[];
	options: CursorAutomationIngestRouteRequest["options"];
	paramKeys: string[];
	configKeys: string[];
	events: CursorAutomationIngestRouteRequest["validation"]["events"];
	rejected: CursorAutomationIngestRouteRequest["validation"]["rejected"];
	workspaceRoot: string;
};

type CursorMcpInstallResponse = {
	handled: true;
	route: "mcp-install";
	confirmed: boolean;
	installed: boolean;
	serverName: string;
	source: CursorMcpInstallRequest["source"];
	transportType: string;
	settingsPath: string;
	replaced: boolean;
	urlOrigin?: string;
	command?: string;
	argCount?: number;
	envKeys?: string[];
	headerKeys?: string[];
};

type CursorRuleActionResponse = {
	handled: true;
	route: "rule";
	kind: CursorRuleRouteRequest["kind"];
	confirmed: boolean;
	actionable: boolean;
	created: boolean;
	opened: boolean;
	workspaceRoot: string;
	filename?: string;
	relativePath?: string;
	filePath?: string;
	reason?: string;
	name?: string;
	path?: string;
};

type CursorPluginAddResponse = {
	handled: true;
	route: "plugin-add";
	confirmed: boolean;
	installed: boolean;
	actionable: boolean;
	requiresReview: boolean;
	workspaceRoot: string;
	sourceParam?: CursorPluginAddRouteRequest["sourceParam"];
	sourceLabel?: string;
	reason?: string;
	detail?: string;
	paramKeys: string[];
	configKeys: string[];
	installPath?: string;
	entryCount?: number;
	entryPaths?: string[];
};

type CursorGitActionResponse = {
	handled: true;
	route: "git";
	kind: CursorAgentTaskRouteRequest["kind"];
	confirmed: boolean;
	actionable: boolean;
	executed: boolean;
	workspaceRoot: string;
	paramKeys: string[];
	command?: string[];
	target?: string;
	branch?: string;
	base?: string;
	checkout?: boolean;
	message?: string;
	commitHash?: string;
	currentBranch?: string;
	dirty: boolean;
	reason?: string;
};

function readProviderSettingsUpdate(
	args: Record<string, unknown> | undefined,
): Partial<Omit<SaveProviderSettingsActionRequest, "action" | "providerId">> {
	return args?.settings && typeof args.settings === "object"
		? (args.settings as Partial<
				Omit<SaveProviderSettingsActionRequest, "action" | "providerId">
			>)
		: {};
}

function presentTrimmed(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

function readOpenAICodexAuthStatus(): JsonRecord {
	const manager = new ProviderSettingsManager();
	const state = manager.read();
	const entry = state.providers[DEFAULT_CODEVIBE_PROVIDER_ID];
	const settings = entry?.settings;
	const auth = settings?.auth;
	const accessToken = presentTrimmed(auth?.accessToken);
	const refreshToken = presentTrimmed(auth?.refreshToken);
	const apiKey = presentTrimmed(settings?.apiKey);
	const installationId = presentTrimmed(auth?.installationId);
	const clientVersion = presentTrimmed(auth?.clientVersion);
	const tokenSource =
		presentTrimmed(auth?.tokenSource) ?? presentTrimmed(entry?.tokenSource);
	const accountId = presentTrimmed(auth?.accountId);
	const expiresAt =
		typeof auth?.expiresAt === "number" && Number.isFinite(auth.expiresAt)
			? auth.expiresAt
			: undefined;
	const expiresAtIso =
		typeof expiresAt === "number"
			? new Date(expiresAt).toISOString()
			: undefined;

	return {
		provider: DEFAULT_CODEVIBE_PROVIDER_ID,
		connected: Boolean(accessToken ?? apiKey),
		accessTokenPresent: Boolean(accessToken),
		refreshTokenPresent: Boolean(refreshToken),
		apiKeyPresent: Boolean(apiKey),
		tokenSource,
		accountId,
		expiresAt,
		expiresAtIso,
		expired: typeof expiresAt === "number" ? expiresAt <= Date.now() : undefined,
		installationIdPresent: Boolean(installationId),
		clientVersion,
		lastUsed: state.lastUsedProvider === DEFAULT_CODEVIBE_PROVIDER_ID,
		settingsPath: manager.getFilePath(),
		updatedAt: entry?.updatedAt,
	};
}

// ---------------------------------------------------------------------------
// MCP settings helpers
// ---------------------------------------------------------------------------

function readMcpServersResponse(): JsonRecord {
	const settingsPath = resolveMcpSettingsPath();
	if (!existsSync(settingsPath)) {
		return { settingsPath, hasSettingsFile: false, servers: [] };
	}
	const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as JsonRecord;
	const servers = parsed.mcpServers as JsonRecord | undefined;
	const entries = Object.entries(servers ?? {}).map(([name, body]) => {
		const record = body as JsonRecord;
		const transport =
			record.transport && typeof record.transport === "object"
				? (record.transport as JsonRecord)
				: undefined;
		const transportType = String(
			transport?.type ?? record.transportType ?? record.type ?? "stdio",
		).trim();
		return {
			name,
			transportType,
			disabled: record.disabled === true,
			command:
				typeof transport?.command === "string"
					? transport.command
					: typeof record.command === "string"
						? record.command
						: undefined,
			args: Array.isArray(transport?.args)
				? transport.args
				: Array.isArray(record.args)
					? record.args
					: undefined,
			cwd:
				typeof transport?.cwd === "string"
					? transport.cwd
					: typeof record.cwd === "string"
						? record.cwd
						: undefined,
			env:
				transport?.env && typeof transport.env === "object"
					? transport.env
					: record.env && typeof record.env === "object"
						? record.env
						: undefined,
			url:
				typeof transport?.url === "string"
					? transport.url
					: typeof record.url === "string"
						? record.url
						: undefined,
			headers:
				transport?.headers && typeof transport.headers === "object"
					? transport.headers
					: record.headers && typeof record.headers === "object"
						? record.headers
						: undefined,
			metadata: record.metadata,
		};
	});
	return { settingsPath, hasSettingsFile: true, servers: entries };
}

function writeMcpServersMap(servers: JsonRecord): void {
	const path = resolveMcpSettingsPath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`);
}

function ensureMcpSettingsFile(): string {
	const path = resolveMcpSettingsPath();
	if (!existsSync(path)) {
		writeMcpServersMap({});
	}
	return path;
}

function resolveCursorMcpSettingsPath(workspaceRoot: string): string {
	return join(resolve(workspaceRoot), ".cursor", "mcp.json");
}

function getRecordValue(value: unknown): JsonRecord | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as JsonRecord)
		: undefined;
}

function readMcpServersMap(path: string): JsonRecord {
	if (!existsSync(path)) {
		return {};
	}
	const parsed = JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
	return getRecordValue(parsed.mcpServers) ?? {};
}

function readCursorWorkspaceMcpServers(workspaceRoot: string): {
	sourcePath: string;
	servers: JsonRecord;
} {
	const sourcePath = resolveCursorMcpSettingsPath(workspaceRoot);
	if (!existsSync(sourcePath)) {
		throw new Error("No .cursor/mcp.json found in the active workspace");
	}
	const parsed = JSON.parse(readFileSync(sourcePath, "utf8")) as JsonRecord;
	const normalized = normalizeCursorMcpSettingsObject(parsed, {
		workspaceRoot,
	}) as JsonRecord;
	const servers = getRecordValue(normalized.mcpServers);
	if (!servers || Object.keys(servers).length === 0) {
		throw new Error(".cursor/mcp.json does not contain any MCP servers");
	}
	return { sourcePath, servers };
}

function buildCursorMcpImportResponse(input: {
	confirmed: boolean;
	imported: boolean;
	sourcePath: string;
	serverNames: string[];
	replacedNames?: string[];
}): JsonRecord {
	return {
		handled: true,
		route: "cursor-mcp-import",
		confirmed: input.confirmed,
		imported: input.imported,
		sourcePath: input.sourcePath,
		serverNames: input.serverNames,
		importedCount: input.imported ? input.serverNames.length : 0,
		replacedNames: input.replacedNames ?? [],
		...readMcpServersResponse(),
	};
}

function importCursorMcpServers(
	ctx: SidecarContext,
	args?: Record<string, unknown>,
): JsonRecord {
	const { sourcePath, servers: cursorServers } = readCursorWorkspaceMcpServers(
		ctx.workspaceRoot,
	);
	const serverNames = Object.keys(cursorServers).sort();
	if (args?.confirmed !== true) {
		return buildCursorMcpImportResponse({
			confirmed: false,
			imported: false,
			sourcePath,
			serverNames,
		});
	}

	const settingsPath = ensureMcpSettingsFile();
	const existingServers = readMcpServersMap(settingsPath);
	const importedAt = new Date().toISOString();
	const nextServers: JsonRecord = { ...existingServers };
	const replacedNames: string[] = [];
	for (const name of serverNames) {
		const serverConfig = getRecordValue(cursorServers[name]);
		if (!serverConfig) {
			continue;
		}
		if (Object.hasOwn(existingServers, name)) {
			replacedNames.push(name);
		}
		const metadata = getRecordValue(serverConfig.metadata) ?? {};
		nextServers[name] = {
			...serverConfig,
			metadata: {
				...metadata,
				cursor: {
					source: "workspace-mcp",
					path: ".cursor/mcp.json",
					importedAt,
				},
			},
		};
	}
	writeMcpServersMap(nextServers);
	return buildCursorMcpImportResponse({
		confirmed: true,
		imported: true,
		sourcePath,
		serverNames,
		replacedNames,
	});
}

function safeUrlOrigin(value: string): string | undefined {
	try {
		return new URL(value).origin;
	} catch {
		return undefined;
	}
}

function buildCursorMcpInstallResponse(
	request: CursorMcpInstallRequest,
	input: {
		confirmed: boolean;
		installed: boolean;
		settingsPath: string;
		replaced: boolean;
	},
): CursorMcpInstallResponse {
	const transport =
		getRecordValue(request.serverConfig.transport) ?? request.serverConfig;
	const url = typeof transport.url === "string" ? transport.url : undefined;
	const command =
		typeof transport.command === "string" ? transport.command : undefined;
	const commandLabel = command && !/\s/.test(command) ? command : undefined;
	const env = getRecordValue(transport.env);
	const headers = getRecordValue(transport.headers);
	return {
		handled: true,
		route: "mcp-install",
		confirmed: input.confirmed,
		installed: input.installed,
		serverName: request.serverName,
		source: request.source,
		transportType: String(transport.type ?? "stdio"),
		settingsPath: input.settingsPath,
		replaced: input.replaced,
		...(url ? { urlOrigin: safeUrlOrigin(url) ?? "[provided]" } : {}),
		...(commandLabel ? { command: commandLabel } : {}),
		...(Array.isArray(transport.args) ? { argCount: transport.args.length } : {}),
		...(env ? { envKeys: Object.keys(env).sort() } : {}),
		...(headers ? { headerKeys: Object.keys(headers).sort() } : {}),
	};
}

function safeCursorPluginSourceLabel(
	source: string | undefined,
	sourceParam: CursorPluginAddRouteRequest["sourceParam"],
): string | undefined {
	if (!source) {
		return undefined;
	}
	if (sourceParam !== "url") {
		return source;
	}
	try {
		return new URL(source).origin;
	} catch {
		return "[provided]";
	}
}

function buildCursorPluginAddResponse(
	request: CursorPluginAddRouteRequest,
	input: {
		confirmed: boolean;
		installed: boolean;
		workspaceRoot: string;
		result?: { installPath: string; entryPaths: string[] };
	},
): CursorPluginAddResponse {
	const config = getRecordValue(request.params.config);
	const sourceLabel = safeCursorPluginSourceLabel(
		request.source,
		request.sourceParam,
	);
	return {
		handled: true,
		route: "plugin-add",
		confirmed: input.confirmed,
		installed: input.installed,
		actionable: !request.requiresReview && Boolean(request.source),
		requiresReview: request.requiresReview,
		workspaceRoot: input.workspaceRoot,
		...(request.sourceParam ? { sourceParam: request.sourceParam } : {}),
		...(sourceLabel ? { sourceLabel } : {}),
		...(request.reason ? { reason: request.reason } : {}),
		...(request.requiresReview ? { detail: request.detail } : {}),
		paramKeys: Object.keys(request.params).sort(),
		configKeys: Object.keys(config ?? {}).sort(),
		...(input.result
			? {
					installPath: input.result.installPath,
					entryCount: input.result.entryPaths.length,
					entryPaths: input.result.entryPaths,
				}
			: {}),
	};
}

function getCursorRouteString(
	params: Record<string, string | Record<string, unknown>>,
	key: string,
): string | undefined {
	const value = params[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getCursorRouteBoolean(
	params: Record<string, string | Record<string, unknown>>,
	key: string,
): boolean {
	const value = getCursorRouteString(params, key)?.toLowerCase();
	return value === "true" || value === "1" || value === "yes";
}

function splitCursorGitFiles(value: string | undefined): string[] {
	if (!value) {
		return [];
	}
	return value
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function assertSafeGitPathspecs(files: string[]): void {
	for (const file of files) {
		if (
			file.includes("\0") ||
			file.startsWith("/") ||
			file.split(/[\\/]+/).includes("..")
		) {
			throw new Error(`unsafe git pathspec: ${file}`);
		}
	}
}

function readGitStatusPorcelain(cwd: string): string {
	try {
		return execFileSync("git", ["status", "--porcelain"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`failed to read git status: ${message}`);
	}
}

function hasStagedGitChanges(cwd: string): boolean {
	const staged = execFileSync("git", ["diff", "--cached", "--name-only"], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
	return staged.length > 0;
}

function readGitCurrentBranch(cwd: string): string | undefined {
	try {
		const branch = execFileSync("git", ["branch", "--show-current"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
		return branch || undefined;
	} catch {
		return undefined;
	}
}

function getGitCommandOutput(args: string[], cwd: string): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

function titleFromCursorRuleFilename(filename: string): string {
	const base =
		filename === ".cursorrules"
			? "project rules"
			: basename(filename, extname(filename));
	return base
		.replace(/[-_]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildCursorRuleStarterContent(filename: string): string {
	const title = titleFromCursorRuleFilename(filename) || "Project Rules";
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
		].join("\n");
	}
	return [`# ${title}`, "", "Add project-wide agent guidance here.", ""].join(
		"\n",
	);
}

function resolveWorkspaceFilePath(
	workspaceRoot: string,
	relativePath: string,
): string {
	const root = resolve(workspaceRoot);
	const filePath = resolve(root, relativePath);
	if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
		throw new Error("Cursor rule target escaped the workspace root");
	}
	return filePath;
}

function removePathIfExists(
	path: string,
	options?: { recursive?: boolean },
): boolean {
	if (!path || !existsSync(path)) {
		return false;
	}
	rmSync(path, {
		force: true,
		recursive: options?.recursive === true,
	});
	return true;
}

async function listSessionsFromSidecarManager(
	ctx: SidecarContext,
	limit: number,
): Promise<unknown> {
	const max = Math.max(1, Math.floor(limit));
	if (ctx.sessionManager) {
		return await ctx.sessionManager.list(max, { hydrate: false });
	}

	const byId = new Map<string, JsonRecord>();
	const store = new SqliteSessionStore();
	const mergeSessionRecord = (
		sessionId: string,
		record: JsonRecord,
	): JsonRecord => {
		const persisted = store.get(sessionId) as unknown as JsonRecord | undefined;
		const metadata =
			record.metadata && typeof record.metadata === "object"
				? (record.metadata as JsonRecord)
				: undefined;
		return {
			...(persisted ?? {}),
			...record,
			sessionId,
			provider: record.provider ?? persisted?.provider ?? "",
			model: record.model ?? persisted?.model ?? "",
			cwd: record.cwd ?? persisted?.cwd ?? "",
			workspaceRoot:
				record.workspaceRoot ??
				persisted?.workspaceRoot ??
				persisted?.cwd ??
				"",
			prompt: record.prompt ?? persisted?.prompt ?? metadata?.prompt,
			parentSessionId:
				record.parentSessionId ??
				persisted?.parentSessionId ??
				metadata?.parentSessionId,
			parentAgentId:
				record.parentAgentId ??
				persisted?.parentAgentId ??
				metadata?.parentAgentId,
			agentId: record.agentId ?? persisted?.agentId ?? metadata?.agentId,
			conversationId:
				record.conversationId ??
				persisted?.conversationId ??
				metadata?.conversationId,
			isSubagent: record.isSubagent ?? persisted?.isSubagent ?? false,
			startedAt: record.startedAt ?? persisted?.startedAt ?? record.createdAt,
			updatedAt: record.updatedAt ?? persisted?.updatedAt,
			metadata: {
				...((persisted?.metadata && typeof persisted.metadata === "object"
					? persisted.metadata
					: {}) as JsonRecord),
				...(metadata ?? {}),
			},
		};
	};

	if (ctx.hubClient) {
		try {
			const reply = await ctx.hubClient.command("session.list", { limit: max });
			const sessions = Array.isArray(reply.payload?.sessions)
				? reply.payload.sessions
				: [];
			for (const item of sessions) {
				if (!item || typeof item !== "object") continue;
				const record = item as JsonRecord;
				const sessionId = String(record.sessionId ?? "").trim();
				if (sessionId)
					byId.set(sessionId, mergeSessionRecord(sessionId, record));
			}
		} catch {
			// Fall through to the local SQLite index.
		}
	}

	if (byId.size === 0) {
		for (const session of store.list(max)) {
			byId.set(session.sessionId, session as unknown as JsonRecord);
		}
	}

	for (const [sessionId, session] of ctx.liveSessions.entries()) {
		const existing = byId.get(sessionId);
		byId.set(sessionId, {
			...(existing ?? {}),
			sessionId,
			status: session.status,
			provider: session.config.provider ?? existing?.provider ?? "",
			model: session.config.model ?? existing?.model ?? "",
			cwd: session.config.cwd ?? existing?.cwd ?? "",
			workspaceRoot:
				session.config.workspaceRoot ??
				existing?.workspaceRoot ??
				existing?.cwd ??
				"",
			prompt: session.prompt ?? existing?.prompt,
			startedAt:
				existing?.startedAt ?? new Date(session.startedAt).toISOString(),
			endedAt:
				session.endedAt !== undefined
					? new Date(session.endedAt).toISOString()
					: existing?.endedAt,
			metadata: {
				...((existing?.metadata && typeof existing.metadata === "object"
					? existing.metadata
					: {}) as JsonRecord),
				...(session.title ? { title: session.title } : {}),
			},
		});
	}

	return Array.from(byId.values())
		.sort((left, right) => {
			const leftTime = Date.parse(
				String(left.updatedAt ?? left.startedAt ?? ""),
			);
			const rightTime = Date.parse(
				String(right.updatedAt ?? right.startedAt ?? ""),
			);
			return (
				(Number.isNaN(rightTime) ? 0 : rightTime) -
				(Number.isNaN(leftTime) ? 0 : leftTime)
			);
		})
		.slice(0, max);
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function listGitBranches(
	ctx: SidecarContext,
	cwd?: string,
): { current?: string; branches?: string[] } {
	const targetCwd = cwd?.trim() || ctx.workspaceRoot;
	const current = (() => {
		try {
			return execFileSync("git", ["branch", "--show-current"], {
				cwd: targetCwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
		} catch {
			return "";
		}
	})();
	try {
		const stdout = execFileSync(
			"git",
			["for-each-ref", "--format=%(refname:short)", "refs/heads"],
			{
				cwd: targetCwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			},
		);
		const branches = stdout
			.split("\n")
			.map((v) => v.trim())
			.filter(Boolean);
		return { current: current || undefined, branches };
	} catch {
		return { current: current || undefined, branches: [] };
	}
}

// ---------------------------------------------------------------------------
// Routine schedule helpers (in-process via shared hub server)
// ---------------------------------------------------------------------------

function toPositiveInt(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	const rounded = Math.trunc(value);
	return rounded > 0 ? rounded : undefined;
}

function asTrimmedString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function asTrimmedStringArray(value: unknown): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) {
		throw new Error("workspaceRoots must be an array of strings");
	}
	const entries = value.map((entry) => {
		if (typeof entry !== "string") {
			throw new Error("workspaceRoots must be an array of strings");
		}
		return entry.trim();
	});
	const roots = entries.filter(Boolean);
	return roots.length > 0 ? roots : undefined;
}

function readCursorUriPreviewRequest(
	ctx: SidecarContext,
	args?: Record<string, unknown>,
): CursorUriPreviewRequest {
	const uri = asTrimmedString(args?.uri);
	if (!uri) {
		throw new Error("cursor_uri_preview requires a non-empty uri");
	}
	const workspaceRoot =
		asTrimmedString(args?.workspaceRoot) ||
		asTrimmedString(ctx.workspaceRoot);
	const workspaceRoots = asTrimmedStringArray(args?.workspaceRoots);
	const maxCommandFileBytes = toPositiveInt(args?.maxCommandFileBytes);
	return {
		uri,
		...(workspaceRoot ? { workspaceRoot } : {}),
		...(workspaceRoots ? { workspaceRoots } : {}),
		...(maxCommandFileBytes ? { maxCommandFileBytes } : {}),
	};
}

async function handleCursorUriPreviewCommand(
	ctx: SidecarContext,
	args?: Record<string, unknown>,
): Promise<CursorUriPreviewResponse> {
	const input = readCursorUriPreviewRequest(ctx, args);
	if (ctx.hubClient) {
		return await ctx.hubClient.previewCursorUri(input);
	}
	await ensureHubServer({
		runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
	});
	const payload: Record<string, unknown> = { uri: input.uri };
	if (input.workspaceRoot) payload.workspaceRoot = input.workspaceRoot;
	if (input.workspaceRoots) payload.workspaceRoots = input.workspaceRoots;
	if (input.maxCommandFileBytes !== undefined) {
		payload.maxCommandFileBytes = input.maxCommandFileBytes;
	}
	const reply = await sendHubCommand(
		{},
		{
			clientId: "code-sidecar-cursor-preview",
			command: "cursor.uri.preview",
			payload,
		},
	);
	if (!reply.ok) {
		throw new Error(reply.error?.message ?? "cursor_uri_preview failed");
	}
	return (reply.payload ?? { handled: false }) as CursorUriPreviewResponse;
}

function getCursorPreviewString(
	preview: CursorUriPreviewResponse,
	key: string,
): string | undefined {
	const value = preview[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getCursorPreviewStringArray(
	preview: CursorUriPreviewResponse,
	key: string,
): string[] {
	const value = preview[key];
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((item) => (typeof item === "string" ? item.trim() : ""))
		.filter((item) => item.length > 0);
}

function getJsonStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((item) => (typeof item === "string" ? item.trim() : ""))
		.filter((item) => item.length > 0);
}

function getRouteParamString(
	params: Record<string, string | Record<string, unknown>>,
	key: string,
): string | undefined {
	const value = params[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getRouteConfigKeys(
	params: Record<string, string | Record<string, unknown>>,
): string[] {
	const config = params.config;
	return config && typeof config === "object" && !Array.isArray(config)
		? Object.keys(config).sort()
		: [];
}

function readCursorAgentTaskRouteDetails(uri: string): JsonRecord | undefined {
	try {
		const request = buildCursorAgentTaskRouteRequest(uri);
		const configKeys = getRouteConfigKeys(request.params);
		const details: JsonRecord = {
			kind: request.kind,
			path: request.path,
			paramKeys: Object.keys(request.params).sort(),
			...(configKeys.length > 0 ? { configKeys } : {}),
		};
		if (request.kind === "background-agent") {
			const backgroundDetails: JsonRecord = {};
			const repository =
				getRouteParamString(request.params, "repository") ??
				getRouteParamString(request.params, "repo");
			const requestedBranch = getRouteParamString(request.params, "branch");
			const requestedBaseBranch = getRouteParamString(
				request.params,
				"baseBranch",
			);
			if (repository) {
				backgroundDetails.repository = repository;
			}
			if (requestedBranch) {
				backgroundDetails.requestedBranch = requestedBranch;
			}
			if (requestedBaseBranch) {
				backgroundDetails.requestedBaseBranch = requestedBaseBranch;
			}
			if (configKeys.length > 0) {
				backgroundDetails.configKeys = configKeys;
			}
			if (Object.keys(backgroundDetails).length > 0) {
				details.backgroundAgentDetails = backgroundDetails;
			}
		}
		return details;
	} catch {
		return undefined;
	}
}

function isLaunchableCursorAgentPreview(
	preview: CursorUriPreviewResponse,
): boolean {
	const path = getCursorPreviewString(preview, "path");
	const route = getCursorPreviewString(preview, "route");
	return Boolean(
		getCursorPreviewString(preview, "taskPrompt") &&
			path &&
			(CURSOR_URI_LAUNCHABLE_AGENT_PATHS.has(path) ||
				(route === "command-file" && path === "/command")),
	);
}

function getCursorQueuedAgentToolPolicies(): JsonRecord {
	return {
		"*": { enabled: false, autoApprove: false },
		[DefaultToolNames.READ_FILES]: { enabled: true, autoApprove: true },
		[DefaultToolNames.SEARCH_CODEBASE]: { enabled: true, autoApprove: true },
	};
}

function buildCursorLaunchMetadata(
	preview: CursorUriPreviewResponse,
	uri: string,
): JsonRecord {
	const routeDetails = readCursorAgentTaskRouteDetails(uri);
	const route = getCursorPreviewString(preview, "route") ?? "unknown";
	const path = getCursorPreviewString(preview, "path");
	const backgroundAgent =
		route === "background-agent" || path === "/background-agent";
	const detailParamKeys = getJsonStringArray(routeDetails?.paramKeys);
	const detailConfigKeys = getJsonStringArray(routeDetails?.configKeys);
	const paramKeys =
		detailParamKeys.length > 0
			? detailParamKeys
			: getCursorPreviewStringArray(preview, "paramKeys");
	const configKeys =
		detailConfigKeys.length > 0
			? detailConfigKeys
			: getCursorPreviewStringArray(preview, "configKeys");
	const cursor: JsonRecord = {
		source: "cursor-uri",
		route,
		background: backgroundAgent,
	};
	if (path) {
		cursor.path = path;
	}
	if (paramKeys.length > 0) {
		cursor.paramKeys = paramKeys;
	}
	if (configKeys.length > 0) {
		cursor.configKeys = configKeys;
	}
	return {
		cursor,
		...(backgroundAgent ? { backgroundAgent: true } : {}),
		...(routeDetails?.backgroundAgentDetails
			? { backgroundAgentDetails: routeDetails.backgroundAgentDetails }
			: {}),
	};
}

async function handleCursorUriLaunchCommand(
	ctx: SidecarContext,
	args?: Record<string, unknown>,
): Promise<CursorUriLaunchResponse> {
	if (args?.confirmed !== true) {
		throw new Error("cursor_uri_launch requires confirmed=true");
	}
	const input = readCursorUriPreviewRequest(ctx, args);
	const preview = await handleCursorUriPreviewCommand(ctx, args);
	if (!preview.handled) {
		throw new Error("Cursor URI was not handled by the preview route");
	}
	const taskPrompt = getCursorPreviewString(preview, "taskPrompt");
	const route = getCursorPreviewString(preview, "route") ?? "unknown";
	if (!isLaunchableCursorAgentPreview(preview) || !taskPrompt) {
		throw new Error(
			`Cursor URI route "${route}" can be previewed but is not launchable from the desktop app yet`,
		);
	}

	const provider = asTrimmedString(args?.provider) ?? DEFAULT_CODEVIBE_PROVIDER_ID;
	const model = asTrimmedString(args?.model) ?? DEFAULT_CODEVIBE_MODEL_ID;
	const mode = "plan";
	const workspaceRoot = input.workspaceRoot ?? ctx.workspaceRoot;
	const cwd = workspaceRoot;
	const metadata = buildCursorLaunchMetadata(preview, input.uri);
	const backgroundAgent = metadata.backgroundAgent === true;
	const backgroundAgentDetails =
		metadata.backgroundAgentDetails &&
		typeof metadata.backgroundAgentDetails === "object" &&
		!Array.isArray(metadata.backgroundAgentDetails)
			? (metadata.backgroundAgentDetails as JsonRecord)
			: undefined;
	const { handleChatSessionCommand } = await import("./chat-session");
	const started = (await handleChatSessionCommand(ctx, {
		action: "start",
		config: {
			provider,
			model,
			mode,
			workspaceRoot,
			cwd,
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
			autoApproveTools: false,
			toolPolicies: getCursorQueuedAgentToolPolicies(),
			sessionMetadata: metadata,
		},
	})) as { sessionId?: unknown };
	const sessionId =
		typeof started.sessionId === "string" ? started.sessionId.trim() : "";
	if (!sessionId) {
		throw new Error("cursor_uri_launch failed to start a desktop session");
	}
	await handleChatSessionCommand(ctx, {
		action: "send",
		sessionId,
		prompt: taskPrompt,
		delivery: "queue",
	});

	return {
		handled: true,
		launched: true,
		route,
		...(getCursorPreviewString(preview, "path")
			? { path: getCursorPreviewString(preview, "path") }
			: {}),
		backgroundAgent,
		...(backgroundAgentDetails ? { backgroundAgentDetails } : {}),
		sessionId,
		provider,
		model,
		mode,
		queued: true,
		metadata,
		preview,
	};
}

function summarizeAutomationIngestResult(
	result: ClineAutomationNdjsonIngressResult | undefined,
): Pick<
	CursorAutomationIngestResponse,
	"queuedRunCount" | "duplicateCount" | "matchedSpecIds"
> {
	if (!result) {
		return {
			queuedRunCount: 0,
			duplicateCount: 0,
			matchedSpecIds: [],
		};
	}
	const matchedSpecIds = new Set<string>();
	let queuedRunCount = 0;
	let duplicateCount = 0;
	for (const entry of result.results) {
		if (entry.duplicate) {
			duplicateCount += 1;
		}
		queuedRunCount += entry.queuedRuns.length;
		for (const specId of entry.matchedSpecIds) {
			matchedSpecIds.add(specId);
		}
	}
	return {
		queuedRunCount,
		duplicateCount,
		matchedSpecIds: [...matchedSpecIds].sort(),
	};
}

function buildCursorAutomationIngestResponse(
	request: CursorAutomationIngestRouteRequest,
	input: {
		confirmed: boolean;
		workspaceRoot: string;
		result?: ClineAutomationNdjsonIngressResult;
	},
): CursorAutomationIngestResponse {
	const strictFailed = request.strict && request.validation.rejectedCount > 0;
	const valid = request.validation.eventCount > 0 && !strictFailed;
	const resultSummary = summarizeAutomationIngestResult(input.result);
	return {
		handled: true,
		route: "automation-ingest",
		confirmed: input.confirmed,
		ingested: Boolean(input.result),
		valid,
		strict: request.strict,
		strictFailed,
		eventCount: request.validation.eventCount,
		rejectedCount: request.validation.rejectedCount,
		queuedRunCount: resultSummary.queuedRunCount,
		duplicateCount: resultSummary.duplicateCount,
		matchedSpecIds: resultSummary.matchedSpecIds,
		options: request.options,
		paramKeys: request.paramKeys,
		configKeys: request.configKeys,
		events: request.validation.events,
		rejected: request.validation.rejected,
		workspaceRoot: input.workspaceRoot,
	};
}

async function handleCursorAutomationIngestCommand(
	ctx: SidecarContext,
	args?: Record<string, unknown>,
): Promise<CursorAutomationIngestResponse> {
	const input = readCursorUriPreviewRequest(ctx, args);
	const request = buildCursorAutomationIngestRouteRequest(input.uri);
	const workspaceRoot = input.workspaceRoot ?? ctx.workspaceRoot;
	const preview = buildCursorAutomationIngestResponse(request, {
		confirmed: args?.confirmed === true,
		workspaceRoot,
	});
	if (!preview.confirmed || !preview.valid) {
		return preview;
	}

	const core = await ClineCore.create({
		clientName: "code-desktop-cursor-automation-ingest",
		backendMode: "local",
		automation: {
			workspaceRoot,
		},
	});
	try {
		const result = core.automation.ingestNdjson(
			request.ndjson,
			request.options,
		);
		return buildCursorAutomationIngestResponse(request, {
			confirmed: true,
			workspaceRoot,
			result,
		});
	} finally {
		await core.dispose("cursor_automation_ingest_done");
	}
}

async function handleCursorMcpInstallCommand(
	_ctx: SidecarContext,
	args?: Record<string, unknown>,
): Promise<CursorMcpInstallResponse> {
	const input = readCursorUriPreviewRequest(_ctx, args);
	const request = buildCursorMcpInstallRequest(input.uri);
	const path = ensureMcpSettingsFile();
	const parsed = JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
	const servers = (parsed.mcpServers as JsonRecord | undefined) ?? {};
	const replaced = Object.hasOwn(servers, request.serverName);
	const confirmed = args?.confirmed === true;
	if (!confirmed) {
		return buildCursorMcpInstallResponse(request, {
			confirmed: false,
			installed: false,
			settingsPath: path,
			replaced,
		});
	}

	servers[request.serverName] = request.serverConfig;
	writeMcpServersMap(servers);
	return buildCursorMcpInstallResponse(request, {
		confirmed: true,
		installed: true,
		settingsPath: path,
		replaced,
	});
}

async function handleCursorRuleOpenCommand(
	ctx: SidecarContext,
	args?: Record<string, unknown>,
): Promise<CursorRuleActionResponse> {
	const input = readCursorUriPreviewRequest(ctx, args);
	const workspaceRoot = input.workspaceRoot ?? ctx.workspaceRoot;
	const request = buildCursorRuleRouteRequest(input.uri);
	const confirmed = args?.confirmed === true;
	if (request.kind === "review") {
		return {
			handled: true,
			route: "rule",
			kind: "review",
			confirmed,
			actionable: false,
			created: false,
			opened: false,
			workspaceRoot,
			reason: request.reason,
			...(request.name ? { name: request.name } : {}),
			...(request.path ? { path: request.path } : {}),
		};
	}

	const filePath = resolveWorkspaceFilePath(workspaceRoot, request.relativePath);
	const existed = existsSync(filePath);
	if (!confirmed) {
		return {
			handled: true,
			route: "rule",
			kind: "file",
			confirmed: false,
			actionable: true,
			created: false,
			opened: false,
			workspaceRoot,
			filename: request.filename,
			relativePath: request.relativePath,
			filePath,
		};
	}

	if (!existed) {
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, buildCursorRuleStarterContent(request.filename));
	}
	if (args?.open !== false) {
		openFileInEditor(filePath);
	}
	return {
		handled: true,
		route: "rule",
		kind: "file",
		confirmed: true,
		actionable: true,
		created: !existed,
		opened: args?.open !== false,
		workspaceRoot,
		filename: request.filename,
		relativePath: request.relativePath,
		filePath,
	};
}

async function handleCursorPluginAddCommand(
	ctx: SidecarContext,
	args?: Record<string, unknown>,
): Promise<CursorPluginAddResponse> {
	const input = readCursorUriPreviewRequest(ctx, args);
	const workspaceRoot = input.workspaceRoot ?? ctx.workspaceRoot;
	const request = buildCursorPluginAddRouteRequest(input.uri);
	const confirmed = args?.confirmed === true;
	const preview = buildCursorPluginAddResponse(request, {
		confirmed,
		installed: false,
		workspaceRoot,
	});
	if (!confirmed || !preview.actionable || !request.source) {
		return preview;
	}

	const result = await installPlugin({
		source: request.source,
		cwd: workspaceRoot,
		force: args?.force === true,
		io: {
			writeln: () => undefined,
			writeErr: () => undefined,
		},
	});
	return buildCursorPluginAddResponse(request, {
		confirmed: true,
		installed: true,
		workspaceRoot,
		result,
	});
}

async function handleCursorGitActionCommand(
	ctx: SidecarContext,
	args?: Record<string, unknown>,
): Promise<CursorGitActionResponse> {
	const input = readCursorUriPreviewRequest(ctx, args);
	const workspaceRoot = input.workspaceRoot ?? ctx.workspaceRoot;
	const request = buildCursorAgentTaskRouteRequest(input.uri);
	const confirmed = args?.confirmed === true;
	if (
		request.kind !== "git-checkout" &&
		request.kind !== "git-branch" &&
		request.kind !== "git-commit"
	) {
		throw new Error(`cursor_git_action does not support ${request.kind}`);
	}

	const status = readGitStatusPorcelain(workspaceRoot);
	const dirty = status.trim().length > 0;
	const baseResponse = {
		handled: true as const,
		route: "git" as const,
		kind: request.kind,
		confirmed,
		workspaceRoot,
		paramKeys: Object.keys(request.params).sort(),
		currentBranch: readGitCurrentBranch(workspaceRoot),
		dirty,
	};

	if (request.kind === "git-checkout") {
		const target =
			getCursorRouteString(request.params, "branch") ??
			getCursorRouteString(request.params, "ref") ??
			getCursorRouteString(request.params, "target") ??
			"";
		const command = ["git", "checkout", target];
		if (dirty) {
			return {
				...baseResponse,
				actionable: false,
				executed: false,
				target,
				command,
				reason: "Working tree has uncommitted changes; checkout needs manual review.",
			};
		}
		if (!confirmed) {
			return {
				...baseResponse,
				actionable: true,
				executed: false,
				target,
				command,
			};
		}
		getGitCommandOutput(["checkout", target], workspaceRoot);
		return {
			...baseResponse,
			actionable: true,
			executed: true,
			target,
			command,
			currentBranch: readGitCurrentBranch(workspaceRoot),
		};
	}

	if (request.kind === "git-branch") {
		const branch =
			getCursorRouteString(request.params, "name") ??
			getCursorRouteString(request.params, "branch") ??
			"";
		const base =
			getCursorRouteString(request.params, "baseBranch") ??
			getCursorRouteString(request.params, "base");
		const checkout = getCursorRouteBoolean(request.params, "checkout");
		const command = checkout
			? ["git", "checkout", "-b", branch, ...(base ? [base] : [])]
			: ["git", "branch", branch, ...(base ? [base] : [])];
		if (checkout && dirty) {
			return {
				...baseResponse,
				actionable: false,
				executed: false,
				branch,
				...(base ? { base } : {}),
				checkout,
				command,
				reason: "Working tree has uncommitted changes; branch checkout needs manual review.",
			};
		}
		if (!confirmed) {
			return {
				...baseResponse,
				actionable: true,
				executed: false,
				branch,
				...(base ? { base } : {}),
				checkout,
				command,
			};
		}
		getGitCommandOutput(command.slice(1), workspaceRoot);
		return {
			...baseResponse,
			actionable: true,
			executed: true,
			branch,
			...(base ? { base } : {}),
			checkout,
			command,
			currentBranch: readGitCurrentBranch(workspaceRoot),
		};
	}

	const message =
		getCursorRouteString(request.params, "message") ??
		getCursorRouteString(request.params, "summary");
	const files = splitCursorGitFiles(getCursorRouteString(request.params, "files"));
	const all = getCursorRouteBoolean(request.params, "all");
	const amend = getCursorRouteBoolean(request.params, "amend");
	const push = getCursorRouteBoolean(request.params, "push");
	const command = [
		"git",
		"commit",
		...(amend ? ["--amend"] : []),
		...(message ? ["-m", message] : []),
	];
	if (push) {
		return {
			...baseResponse,
			actionable: false,
			executed: false,
			...(message ? { message } : {}),
			command,
			reason: "Direct push from Cursor git commit deeplinks requires separate manual confirmation.",
		};
	}
	if (!message) {
		return {
			...baseResponse,
			actionable: false,
			executed: false,
			command,
			reason: "Git commit deeplink requires a message or summary before committing.",
		};
	}
	assertSafeGitPathspecs(files);
	if (!confirmed) {
		return {
			...baseResponse,
			actionable: true,
			executed: false,
			message,
			command,
		};
	}
	if (all) {
		getGitCommandOutput(["add", "-A"], workspaceRoot);
	} else if (files.length > 0) {
		getGitCommandOutput(["add", "--", ...files], workspaceRoot);
	}
	if (!hasStagedGitChanges(workspaceRoot)) {
		return {
			...baseResponse,
			actionable: false,
			executed: false,
			message,
			command,
			reason: "No staged changes are available to commit.",
		};
	}
	getGitCommandOutput(command.slice(1), workspaceRoot);
	const commitHash = getGitCommandOutput(["rev-parse", "--short", "HEAD"], workspaceRoot);
	return {
		...baseResponse,
		actionable: true,
		executed: true,
		message,
		command,
		commitHash,
		currentBranch: readGitCurrentBranch(workspaceRoot),
	};
}

async function handleRoutineScheduleCommand(
	command: string,
	args?: Record<string, unknown>,
): Promise<unknown> {
	let useLocalScheduleService = false;
	try {
		if (!useLocalScheduleService) {
			await ensureHubServer({
				runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			});
		}
	} catch {
		useLocalScheduleService = true;
	}
	const clientCommand = async (
		hubCommand: string,
		payload?: Record<string, unknown>,
	) => {
		const reply = useLocalScheduleService
			? await localRoutineScheduleCommand(hubCommand, payload)
			: await sendHubCommand(
					{},
					{
						clientId: "code-sidecar-routines",
						command: hubCommand as never,
						payload,
					},
				);
		if (!reply.ok) {
			throw new Error(
				reply.error?.message ?? `hub command failed: ${hubCommand}`,
			);
		}
		return (reply.payload ?? {}) as Record<string, unknown>;
	};
	try {
		if (command === "list_routine_schedules") {
			const [schedules, activeExecutions, upcomingRuns] = await Promise.all([
				clientCommand("schedule.list", {
					limit: toPositiveInt(args?.limit) ?? 200,
				}),
				clientCommand("schedule.active"),
				clientCommand("schedule.upcoming", { limit: 30 }),
			]);
			return {
				schedules: schedules.schedules ?? [],
				activeExecutions: activeExecutions.executions ?? [],
				upcomingRuns: upcomingRuns.runs ?? [],
			};
		}
		if (command === "create_routine_schedule") {
			const name = asTrimmedString(args?.name);
			const cronPattern = asTrimmedString(args?.cron_pattern);
			const prompt = asTrimmedString(args?.prompt);
			const workspaceRoot = asTrimmedString(args?.workspace_root);
			if (!name || !cronPattern || !prompt || !workspaceRoot) {
				throw new Error(
					"createSchedule requires name, cron_pattern, prompt, and workspace_root",
				);
			}
			const created = await clientCommand("schedule.create", {
				name,
				cronPattern,
				prompt,
				modelSelection: {
					providerId:
						asTrimmedString(args?.provider) ?? DEFAULT_CODEVIBE_PROVIDER_ID,
					modelId: asTrimmedString(args?.model) ?? DEFAULT_CODEVIBE_MODEL_ID,
				},
				mode: args?.mode === "plan" ? "plan" : "act",
				workspaceRoot,
				cwd: asTrimmedString(args?.cwd),
				systemPrompt: asTrimmedString(args?.system_prompt),
				maxIterations: toPositiveInt(args?.max_iterations),
				timeoutSeconds: toPositiveInt(args?.timeout_seconds),
				maxParallel: toPositiveInt(args?.max_parallel) ?? 1,
				enabled: args?.enabled !== false,
				tags:
					Array.isArray(args?.tags) && args.tags.length > 0
						? (args.tags as string[])
								.map((v: string) => v.trim())
								.filter((v: string) => v.length > 0)
						: undefined,
			});
			return { schedule: created.schedule ?? null };
		}
		const scheduleId = asTrimmedString(args?.schedule_id);
		if (!scheduleId) throw new Error(`${command} requires schedule_id`);
		if (command === "pause_routine_schedule") {
			const reply = await clientCommand("schedule.disable", { scheduleId });
			return { schedule: reply.schedule ?? null };
		}
		if (command === "resume_routine_schedule") {
			const reply = await clientCommand("schedule.enable", { scheduleId });
			return { schedule: reply.schedule ?? null };
		}
		if (command === "trigger_routine_schedule") {
			const reply = await clientCommand("schedule.trigger", { scheduleId });
			return { execution: reply.execution ?? null };
		}
		if (command === "delete_routine_schedule") {
			const reply = await clientCommand("schedule.delete", { scheduleId });
			return { deleted: reply.deleted === true };
		}
		throw new Error(`unsupported routine schedule command: ${command}`);
	} finally {
	}
}

let localRoutineScheduleService: HubScheduleService | undefined;
let localRoutineScheduleCommands: HubScheduleCommandService | undefined;

function getLocalRoutineScheduleCommands(): HubScheduleCommandService {
	if (!localRoutineScheduleService || !localRoutineScheduleCommands) {
		localRoutineScheduleService = new HubScheduleService({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		localRoutineScheduleCommands = new HubScheduleCommandService(
			localRoutineScheduleService,
		);
	}
	return localRoutineScheduleCommands;
}

async function localRoutineScheduleCommand(
	command: string,
	payload?: Record<string, unknown>,
) {
	return await getLocalRoutineScheduleCommands().handleCommand({
		version: "v1",
		clientId: "code-sidecar-routines-local",
		command: command as never,
		payload,
	});
}

// ---------------------------------------------------------------------------
// User instruction config listing through the core config service.
// ---------------------------------------------------------------------------

function resolveAgentConfigSearchPaths(workspaceRoot?: string): string[] {
	return resolveSharedAgentConfigSearchPaths(workspaceRoot);
}

async function listUserInstructionConfigs(
	workspaceRoot: string,
): Promise<JsonRecord> {
	const warnings: string[] = [];

	const loadUserInstructionSnapshot = async (
		type: "rule" | "skill" | "workflow",
	): Promise<unknown[]> => {
		const items: unknown[] = [];
		const service = createUserInstructionConfigService({
			skills: { workspacePath: workspaceRoot },
			rules: { workspacePath: workspaceRoot },
			workflows: { workspacePath: workspaceRoot },
		});
		try {
			await service.start();
			for (const record of service.listRecords(type)) {
				const item = record.item as unknown as JsonRecord;
				if (item.disabled === true) continue;
				items.push({
					id: record.id,
					name: item.name ?? record.id,
					instructions: item.instructions,
					path: record.filePath,
				});
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			warnings.push(`${type}: ${message}`);
		} finally {
			service.stop();
		}
		return items;
	};

	const loadAgents = (): unknown[] => {
		const agentsById = new Map<string, { name: string; path: string }>();
		const directories = resolveAgentConfigSearchPaths(workspaceRoot).filter(
			(d) => existsSync(d),
		);
		for (const directory of directories) {
			try {
				for (const entry of readdirSync(directory, { withFileTypes: true })) {
					if (!entry.isFile()) continue;
					const ext = extname(entry.name).toLowerCase();
					if (ext !== ".yml" && ext !== ".yaml") continue;
					const filePath = join(directory, entry.name);
					const raw = readFileSync(filePath, "utf8");
					const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
					const fm = fmMatch?.[1] ?? "";
					const nameMatch = fm.match(/^\s*name:\s*(.+?)\s*$/m);
					const parsedName = nameMatch?.[1]?.replace(/^["']|["']$/g, "").trim();
					const name =
						parsedName && parsedName.length > 0
							? parsedName
							: basename(entry.name, ext);
					const id = name.toLowerCase();
					if (!agentsById.has(id)) {
						agentsById.set(id, { name, path: filePath });
					}
				}
			} catch {
				// best-effort
			}
		}
		return [...agentsById.values()].sort((a, b) =>
			a.name.localeCompare(b.name),
		);
	};

	const loadHooks = (): unknown[] => {
		try {
			return listHookConfigFiles(workspaceRoot);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			warnings.push(`hooks: ${message}`);
			return [];
		}
	};

	const loadPlugins = (): Array<{
		name: string;
		path: string;
		enabled: boolean;
	}> => {
		const disabledPlugins = new Set(readGlobalSettings().disabledPlugins ?? []);
		const pluginsByPath = new Map<
			string,
			{ name: string; path: string; enabled: boolean }
		>();
		const directories = resolvePluginConfigSearchPaths(workspaceRoot).filter(
			(d) => existsSync(d),
		);
		for (const directory of directories) {
			try {
				for (const filePath of discoverPluginModulePaths(directory)) {
					if (pluginsByPath.has(filePath)) {
						continue;
					}
					pluginsByPath.set(filePath, {
						name: basename(filePath, extname(filePath)),
						path: filePath,
						enabled: !disabledPlugins.has(filePath),
					});
				}
			} catch {
				// best-effort
			}
		}
		return [...pluginsByPath.values()].sort((a, b) =>
			a.name.localeCompare(b.name),
		);
	};

	const [rules, workflows, skills, pluginTools] = await Promise.all([
		loadUserInstructionSnapshot("rule"),
		loadUserInstructionSnapshot("workflow"),
		loadUserInstructionSnapshot("skill"),
		listPluginTools({
			workspacePath: workspaceRoot,
			cwd: workspaceRoot,
		}),
	]);

	const disabledTools = new Set(readGlobalSettings().disabledTools ?? []);
	const builtinToolCatalog = getCoreBuiltinToolCatalog({
		disabledToolIds: disabledTools,
	});

	return {
		workspaceRoot,
		rules,
		workflows,
		skills,
		agents: loadAgents(),
		plugins: loadPlugins(),
		tools: [
			...builtinToolCatalog.map((tool) => ({
				id: tool.id,
				name: tool.id,
				description: tool.description,
				enabled:
					tool.defaultEnabled &&
					!tool.headlessToolNames.some((name) => disabledTools.has(name)),
				source: "builtin",
				headlessToolNames: tool.headlessToolNames,
			})),
			...pluginTools.map((tool) => ({
				id: `${tool.pluginName}:${tool.name}:${tool.path}`,
				name: tool.name,
				description: tool.description,
				enabled: tool.enabled,
				source: tool.source,
				path: tool.path,
				pluginName: tool.pluginName,
			})),
		],
		hooks: loadHooks(),
		mcp: readMcpServersResponse(),
		warnings,
	};
}

// ---------------------------------------------------------------------------
// Native OS commands
// ---------------------------------------------------------------------------

function pickWorkspaceDirectory(): string | null {
	const platform = process.platform;
	if (platform === "darwin") {
		try {
			const result = execFileSync(
				"osascript",
				[
					"-e",
					'set theFolder to choose folder with prompt "Select workspace directory"',
					"-e",
					"return POSIX path of theFolder",
				],
				{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
			).trim();
			return result || null;
		} catch {
			return null;
		}
	}
	// Linux — try zenity
	try {
		const result = execFileSync(
			"zenity",
			["--file-selection", "--directory", "--title=Select workspace directory"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		).trim();
		return result || null;
	} catch {
		return null;
	}
}

function openFileInEditor(filePath: string): void {
	const platform = process.platform;
	const cmd =
		platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
	const cmdArgs =
		platform === "win32" ? ["/c", "start", "", filePath] : [filePath];
	const child = spawn(cmd, cmdArgs, { stdio: "ignore", detached: true });
	child.unref();
}

// ---------------------------------------------------------------------------
// Main command router
// ---------------------------------------------------------------------------

export async function handleCommand(
	ctx: SidecarContext,
	command: string,
	args?: Record<string, unknown>,
): Promise<unknown> {
	// ── Chat session commands ──────────────────────────────────────────
	if (command === "chat_session_command") {
		const { handleChatSessionCommand } = await import("./chat-session");
		return await handleChatSessionCommand(
			ctx,
			(args?.request as ChatSessionCommandRequest | undefined) ??
				(args as ChatSessionCommandRequest),
		);
	}

	// ── Session data reading ──────────────────────────────────────────
	if (command === "read_session_messages") {
		return await readSessionMessages(
			ctx,
			String(args?.sessionId ?? ""),
			typeof args?.maxMessages === "number" ? args.maxMessages : 800,
		);
	}
	if (command === "read_session_hooks") {
		return await readSessionHooks(
			String(args?.sessionId ?? ""),
			typeof args?.limit === "number" ? args.limit : 300,
		);
	}

	// ── Process context ───────────────────────────────────────────────
	if (command === "get_process_context") {
		return { workspaceRoot: ctx.workspaceRoot, cwd: ctx.workspaceRoot };
	}
	if (command === "cursor_uri_preview") {
		return await handleCursorUriPreviewCommand(ctx, args);
	}
	if (command === "cursor_uri_launch") {
		return await handleCursorUriLaunchCommand(ctx, args);
	}
	if (command === "cursor_automation_ingest") {
		return await handleCursorAutomationIngestCommand(ctx, args);
	}
	if (command === "cursor_mcp_install") {
		return await handleCursorMcpInstallCommand(ctx, args);
	}
	if (command === "cursor_rule_open") {
		return await handleCursorRuleOpenCommand(ctx, args);
	}
	if (command === "cursor_plugin_add") {
		return await handleCursorPluginAddCommand(ctx, args);
	}
	if (command === "cursor_git_action") {
		return await handleCursorGitActionCommand(ctx, args);
	}
	if (command === "get_chat_ws_endpoint") {
		return "";
	}

	// ── Tool approvals (in-memory) ────────────────────────────────────
	if (command === "poll_tool_approvals") {
		const sessionId = String(args?.sessionId ?? "").trim();
		return Array.from(ctx.pendingApprovals.values())
			.filter((a) => a.item.sessionId === sessionId)
			.map((a) => a.item);
	}
	if (command === "respond_tool_approval") {
		const sessionId = String(args?.sessionId ?? "").trim();
		const requestId = String(args?.requestId ?? "").trim();
		if (!sessionId || !requestId) {
			throw new Error("sessionId and requestId are required");
		}
		const pending = ctx.pendingApprovals.get(requestId);
		if (pending) {
			pending.resolve({
				approved: Boolean(args?.approved),
				...(typeof args?.reason === "string" && args.reason.trim().length > 0
					? { reason: args.reason.trim() }
					: {}),
			});
		}
		ctx.pendingApprovals.delete(requestId);
		const remaining = Array.from(ctx.pendingApprovals.values())
			.filter((a) => a.item.sessionId === sessionId)
			.map((a) => a.item);
		broadcastEvent(ctx, "tool_approval_state", {
			sessionId,
			items: remaining,
		});
		return true;
	}
	if (command === "respond_ask_question") {
		const requestId = String(args?.requestId ?? "").trim();
		if (!requestId) {
			throw new Error("requestId is required");
		}
		const answer = String(args?.answer ?? "").trim();
		const resolved = resolveSidecarAskQuestion(ctx, requestId, answer);
		if (!resolved) {
			throw new Error(`unknown ask question request: ${requestId}`);
		}
		broadcastEvent(ctx, "ask_question_answered", { requestId });
		return true;
	}

	// ── Session discovery ─────────────────────────────────────────────
	if (command === "list_chat_sessions") {
		return discoverChatSessions(
			ctx,
			typeof args?.limit === "number" ? args.limit : 300,
		);
	}
	if (command === "list_cli_sessions") {
		return await listSessionsFromSidecarManager(
			ctx,
			typeof args?.limit === "number" ? args.limit : 300,
		);
	}
	if (command === "list_discovered_sessions") {
		return await listSessionsFromSidecarManager(
			ctx,
			typeof args?.limit === "number" ? args.limit : 300,
		);
	}
	if (command === "update_chat_session_title") {
		const sessionId = String(args?.sessionId ?? "").trim();
		if (!sessionId) throw new Error("session id is required");
		const title = normalizeSessionTitle(String(args?.title ?? ""));
		const backend = await resolveSessionBackend({ backendMode: "local" });
		const result = await backend.updateSession({ sessionId, title });
		if (!result.updated) throw new Error(`Session ${sessionId} not found`);
		const liveSession = ctx.liveSessions.get(sessionId);
		if (liveSession) liveSession.title = title;
		return true;
	}
	if (command === "delete_chat_session" || command === "delete_cli_session") {
		const sessionId = String(args?.sessionId ?? args?.session_id ?? "").trim();
		if (!sessionId) throw new Error("session id is required");
		console.error(
			`[sidecar:delete] request command=${command} sessionId=${sessionId}`,
		);
		const store = new SqliteSessionStore();
		const row = store.get(sessionId);
		const manifest = readSessionManifest(sessionId);
		let deleted = false;
		let deleteError: Error | null = null;
		try {
			if (ctx.sessionManager) {
				deleted = await ctx.sessionManager.delete(sessionId);
			} else {
				const backend = await resolveSessionBackend({ backendMode: "local" });
				const deleteSession = (
					backend as {
						deleteSession: (
							sessionId: string,
							cascade?: boolean,
						) => Promise<boolean | { deleted: boolean }>;
					}
				).deleteSession.bind(backend);
				const deleteResult = await deleteSession(sessionId, true);
				deleted =
					typeof deleteResult === "boolean"
						? deleteResult
						: deleteResult.deleted;
			}
		} catch (error) {
			deleteError = error instanceof Error ? error : new Error(String(error));
		}
		if (store.delete(sessionId, true)) {
			deleted = true;
		}
		ctx.liveSessions.delete(sessionId);
		const directoryCandidates = new Set<string>([
			join(sharedSessionDataDir(), sessionId),
		]);
		for (const path of [
			row?.messagesPath,
			typeof manifest?.messages_path === "string"
				? manifest.messages_path
				: null,
		]) {
			if (typeof path === "string" && path.trim().length > 0) {
				directoryCandidates.add(dirname(path));
			}
		}
		for (const path of [sessionLogPath(sessionId)]) {
			if (removePathIfExists(path, { recursive: true })) {
				deleted = true;
			}
		}
		for (const dir of directoryCandidates) {
			if (removePathIfExists(dir, { recursive: true })) {
				deleted = true;
			}
		}
		for (const path of [
			row?.messagesPath,
			typeof manifest?.messages_path === "string"
				? manifest.messages_path
				: null,
			join(sharedSessionDataDir(), sessionId, `${sessionId}.json`),
		].filter((v): v is string => typeof v === "string" && v.length > 0)) {
			if (removePathIfExists(path)) {
				deleted = true;
			}
		}
		for (const suffix of ["messages.json"]) {
			const fileName = `${sessionId}.${suffix}`;
			const found = findArtifactUnderDir(
				join(sharedSessionDataDir(), rootSessionIdFrom(sessionId)),
				fileName,
				4,
			);
			if (found && removePathIfExists(found)) {
				deleted = true;
			}
		}
		if (!deleted && deleteError) {
			console.error(
				`[sidecar:delete] failed sessionId=${sessionId} error=${deleteError.message}`,
			);
			throw deleteError;
		}
		console.error(
			`[sidecar:delete] result sessionId=${sessionId} deleted=${deleted}`,
		);
		if (deleted) {
			broadcastEvent(ctx, "session_deleted", {
				sessionId,
				command,
				deleted: true,
			});
		}
		return deleted;
	}

	// ── Workspace file search ─────────────────────────────────────────
	if (command === "search_workspace_files") {
		return await searchWorkspaceFiles(ctx, args);
	}

	// ── Cline account ──────────────────────────────────────────────────
	if (command === "cline_account") {
		const operation = String(args?.operation ?? "").trim();
		if (!operation) throw new Error("operation is required");
		const manager = new ProviderSettingsManager();
		const settings = manager.getProviderSettings("cline");
		const accountService = new ClineAccountService({
			apiBaseUrl:
				settings?.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl,
			getAuthToken: async () => resolveLocalClineAuthToken(settings),
		});
		return await executeClineAccountAction(
			args as ClineAccountActionRequest,
			accountService,
		);
	}
	if (command === "openai_codex_auth_status") {
		return readOpenAICodexAuthStatus();
	}

	// ── Provider management ────────────────────────────────────────────
	if (command === "list_provider_catalog") {
		const manager = new ProviderSettingsManager();
		await ensureCustomProvidersLoaded(manager);
		return await listLocalProviders(manager);
	}
	if (command === "list_provider_models") {
		const manager = new ProviderSettingsManager();
		return await getLocalProviderModels(
			String(args?.provider ?? ""),
			manager.getProviderConfig(String(args?.provider ?? "").trim()),
		);
	}
	if (command === "save_provider_settings") {
		const manager = new ProviderSettingsManager();
		return saveLocalProviderSettings(manager, {
			...readProviderSettingsUpdate(args),
			providerId: String(args?.provider ?? ""),
			enabled: typeof args?.enabled === "boolean" ? args.enabled : undefined,
			apiKey: typeof args?.api_key === "string" ? args.api_key : undefined,
			baseUrl: typeof args?.base_url === "string" ? args.base_url : undefined,
		});
	}
	if (command === "add_provider") {
		const manager = new ProviderSettingsManager();
		await ensureCustomProvidersLoaded(manager);
		return await addLocalProvider(manager, {
			providerId: String(args?.provider_id ?? ""),
			name: String(args?.name ?? ""),
			baseUrl: String(args?.base_url ?? ""),
			apiKey: typeof args?.api_key === "string" ? args.api_key : undefined,
			headers:
				args?.headers && typeof args.headers === "object"
					? (args.headers as Record<string, string>)
					: undefined,
			timeoutMs:
				typeof args?.timeout_ms === "number" ? args.timeout_ms : undefined,
			models: Array.isArray(args?.models)
				? (args.models as string[])
				: undefined,
			defaultModelId:
				typeof args?.default_model_id === "string"
					? args.default_model_id
					: undefined,
			modelsSourceUrl:
				typeof args?.models_source_url === "string"
					? args.models_source_url
					: undefined,
			protocol:
				typeof args?.protocol === "string"
					? (args.protocol as ProviderProtocol)
					: undefined,
			client:
				typeof args?.client === "string"
					? (args.client as ProviderClient)
					: undefined,
			capabilities: Array.isArray(args?.capabilities)
				? (args.capabilities as ProviderCapability[])
				: undefined,
		});
	}
	if (command === "run_provider_oauth_login") {
		const providerId = normalizeOAuthProvider(String(args?.provider ?? ""));
		const manager = new ProviderSettingsManager();
		const existing = manager.getProviderSettings(providerId);
		const credentials = await loginLocalProvider(
			providerId,
			existing,
			(url) => {
				const platform = process.platform;
				const spawned =
					platform === "darwin"
						? spawn("open", [url], { stdio: "ignore", detached: true })
						: platform === "win32"
							? spawn("cmd", ["/c", "start", "", url], {
									stdio: "ignore",
									detached: true,
								})
							: spawn("xdg-open", [url], {
									stdio: "ignore",
									detached: true,
								});
				spawned.unref();
			},
		);
		const saved = saveLocalProviderOAuthCredentials(
			manager,
			providerId,
			existing,
			credentials,
		);
		return {
			provider: providerId,
			accessToken: saved.auth?.accessToken ?? saved.apiKey ?? "",
		};
	}

	// ── MCP server management ─────────────────────────────────────────
	if (command === "list_mcp_servers") {
		return readMcpServersResponse();
	}
	if (command === "import_cursor_mcp_servers") {
		return importCursorMcpServers(ctx, args);
	}
	if (command === "set_mcp_server_disabled") {
		const path = ensureMcpSettingsFile();
		const parsed = JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
		const servers = (parsed.mcpServers as JsonRecord | undefined) ?? {};
		const name = String(args?.name ?? "").trim();
		const current = servers[name];
		if (!current || typeof current !== "object") {
			throw new Error(`unknown MCP server: ${name}`);
		}
		servers[name] = {
			...(current as JsonRecord),
			disabled: Boolean(args?.disabled),
		};
		writeMcpServersMap(servers);
		return readMcpServersResponse();
	}
	if (command === "upsert_mcp_server") {
		const input =
			args?.input && typeof args.input === "object"
				? (args.input as JsonRecord)
				: (args as JsonRecord);
		const name = String(input.name ?? "").trim();
		if (!name) throw new Error("server name is required");
		const previousName = String(
			input.previousName ?? input.previous_name ?? "",
		).trim();
		const transportType = String(
			input.transportType ?? input.transport_type ?? "",
		).trim();
		const next: JsonRecord =
			transportType === "stdio"
				? {
						transport: {
							type: "stdio",
							command: input.command,
							args: input.args,
							cwd: input.cwd,
							env: input.env,
						},
						disabled: Boolean(input.disabled),
						metadata: input.metadata,
					}
				: {
						transport: {
							type: transportType,
							url: input.url,
							headers: input.headers,
						},
						disabled: Boolean(input.disabled),
						metadata: input.metadata,
					};
		const path = ensureMcpSettingsFile();
		const parsed = JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
		const servers = (parsed.mcpServers as JsonRecord | undefined) ?? {};
		if (previousName && previousName !== name) {
			delete servers[previousName];
		}
		servers[name] = next;
		writeMcpServersMap(servers);
		return readMcpServersResponse();
	}
	if (command === "delete_mcp_server") {
		const path = ensureMcpSettingsFile();
		const parsed = JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
		const servers = (parsed.mcpServers as JsonRecord | undefined) ?? {};
		delete servers[String(args?.name ?? "")];
		writeMcpServersMap(servers);
		return readMcpServersResponse();
	}
	if (command === "ensure_mcp_settings_file") {
		return ensureMcpSettingsFile();
	}

	// ── Git operations ─────────────────────────────────────────────────
	if (command === "get_git_branch") {
		const branches = listGitBranches(
			ctx,
			typeof args?.cwd === "string" ? args.cwd : undefined,
		);
		return { branch: branches.current };
	}
	if (command === "list_git_branches") {
		return listGitBranches(
			ctx,
			typeof args?.cwd === "string" ? args.cwd : undefined,
		);
	}
	if (command === "checkout_git_branch") {
		const cwd = typeof args?.cwd === "string" ? args.cwd : undefined;
		const branch = String(args?.branch ?? "").trim();
		if (!branch) throw new Error("branch is required");
		execFileSync("git", ["checkout", branch], {
			cwd: cwd?.trim() || ctx.workspaceRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { branch };
	}

	// ── Routine schedules ─────────────────────────────────────────────
	if (
		command === "list_routine_schedules" ||
		command === "create_routine_schedule" ||
		command === "pause_routine_schedule" ||
		command === "resume_routine_schedule" ||
		command === "trigger_routine_schedule" ||
		command === "delete_routine_schedule"
	) {
		return await handleRoutineScheduleCommand(command, args);
	}

	// ── User instruction configs ──────────────────────────────────────
	if (command === "list_user_instruction_configs") {
		return await listUserInstructionConfigs(ctx.workspaceRoot);
	}
	if (command === "toggle_disabled_plugin_tool") {
		const toolName = String(args?.name ?? "").trim();
		if (!toolName) {
			throw new Error("tool name is required");
		}
		toggleDisabledTool(toolName);
		return await listUserInstructionConfigs(ctx.workspaceRoot);
	}
	if (command === "set_tool_disabled") {
		const rawNames = Array.isArray(args?.names) ? args.names : [args?.name];
		const toolNames = rawNames
			.map((name) => String(name ?? "").trim())
			.filter(Boolean);
		if (toolNames.length === 0) {
			throw new Error("tool name is required");
		}
		setDisabledTools(toolNames, args?.disabled === true);
		return await listUserInstructionConfigs(ctx.workspaceRoot);
	}
	if (command === "set_plugin_disabled") {
		const pluginPath = String(args?.path ?? "").trim();
		if (!pluginPath) {
			throw new Error("plugin path is required");
		}
		setDisabledPlugin(pluginPath, args?.disabled === true);
		return await listUserInstructionConfigs(ctx.workspaceRoot);
	}

	// ── Native OS commands ────────────────────────────────────────────
	if (command === "pick_workspace_directory") {
		return pickWorkspaceDirectory();
	}
	if (command === "open_mcp_settings_file") {
		const path = ensureMcpSettingsFile();
		openFileInEditor(path);
		return path;
	}

	throw new Error(`unsupported desktop command: ${command}`);
}
