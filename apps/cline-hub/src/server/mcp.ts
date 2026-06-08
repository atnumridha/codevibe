import {
	existsSync,
	mkdirSync,
	readFileSync,
	watch,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
	authorizeMcpServerOAuth,
	buildCursorMcpInstallRequest,
	type CursorMcpInstallRequest,
	normalizeCursorMcpSettingsObject,
	resolveGlobalCursorMcpSettingsPath,
} from "@cline/core";
import { resolveMcpSettingsPath } from "@cline/shared/storage";
import { workspaceRoot } from "./deps";
import type { JsonRecord } from "./types";
import { openExternalUrl, toPositiveInt } from "./utils";

type McpOAuthStatus =
	| "unsupported"
	| "disabled"
	| "available"
	| "needs_auth"
	| "authenticated"
	| "error";

type AuthorizeMcpServerOAuthFn = typeof authorizeMcpServerOAuth;
type McpSettingsSource = "cline" | "cursor-workspace" | "cursor-global";

interface AuthorizeMcpServerOAuthForHubDeps {
	authorize?: AuthorizeMcpServerOAuthFn;
	openUrl?: (url: string) => void | Promise<void>;
}

interface ReadMcpServersResponseOptions {
	workspaceRoot?: string;
	userHome?: string;
}

interface WatchMcpServersOptions extends ReadMcpServersResponseOptions {
	debounceMs?: number;
	onChange: (payload: JsonRecord) => void;
	onError?: (error: Error, path: string) => void;
	watchFile?: WatchFileFn;
}

export interface McpServersWatcher {
	close(): void;
	watchedPaths(): string[];
}

interface McpServerSource {
	settingsPath: string;
	settingsSource: McpSettingsSource;
	sourceLabel: string;
	servers: JsonRecord;
}

interface McpServerWriteTarget {
	settingsPath: string;
	settingsSource: McpSettingsSource;
	servers: JsonRecord;
}

interface McpSourcePathTarget {
	settingsPath: string;
	settingsSource: McpSettingsSource;
}

interface WatchTarget {
	watchPath: string;
	fileName: string;
}

type WatchFileFn = (
	path: string,
	options: { persistent: false },
	listener: (eventType: string, fileName: string | Buffer | null) => void,
) => CloseableWatcher;

type CloseableWatcher = {
	close(): void;
	on?: (event: "error", listener: (error: Error) => void) => unknown;
};

export function readMcpServersResponse(
	options: ReadMcpServersResponseOptions = {},
): JsonRecord {
	const settingsPath = resolveMcpSettingsPath();
	const hasSettingsFile = existsSync(settingsPath);
	const sourceErrors: JsonRecord[] = [];
	const skippedServers: JsonRecord[] = [];
	const entries: JsonRecord[] = [];
	const seenServers = new Map<string, McpSettingsSource>();

	for (const source of getReadableMcpServerSources(options, sourceErrors)) {
		for (const [name, body] of Object.entries(source.servers)) {
			if (seenServers.has(name)) {
				skippedServers.push({
					name,
					settingsSource: source.settingsSource,
					settingsPath: source.settingsPath,
					shadowedBy: seenServers.get(name),
				});
				continue;
			}
			seenServers.set(name, source.settingsSource);
			entries.push(buildMcpServerResponseEntry(name, body, source));
		}
	}

	return {
		settingsPath,
		hasSettingsFile,
		servers: entries,
		sources: getReadableMcpSourceSummaries(options),
		...(skippedServers.length > 0 ? { skippedServers } : {}),
		...(sourceErrors.length > 0 ? { sourceErrors } : {}),
	};
}

export function mcpServersChangedPayload(
	reason = "change",
	options: ReadMcpServersResponseOptions = {},
): JsonRecord {
	return {
		type: "mcp_servers_changed",
		reason,
		timestamp: Date.now(),
		...readMcpServersResponse(options),
	};
}

export function createMcpServersWatcher(
	options: WatchMcpServersOptions,
): McpServersWatcher {
	const debounceMs = Math.max(25, options.debounceMs ?? 150);
	const sourceOptions: ReadMcpServersResponseOptions = {
		...(options.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : {}),
		...(options.userHome ? { userHome: options.userHome } : {}),
	};
	const watchFile: WatchFileFn =
		options.watchFile ??
		((path, watchOptions, listener) => watch(path, watchOptions, listener));
	let closed = false;
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	let watchers: CloseableWatcher[] = [];
	let activeWatchKey = "";
	let activeWatchedPaths: string[] = [];

	const closeActiveWatchers = () => {
		for (const watcher of watchers) {
			watcher.close();
		}
		watchers = [];
		activeWatchedPaths = [];
		activeWatchKey = "";
	};

	const armWatchers = () => {
		if (closed) {
			return;
		}
		const targets = uniqueMcpWatchTargets(getMcpWatchTargets(sourceOptions));
		const nextWatchKey = targets
			.map((target) => `${target.watchPath}\0${target.fileName}`)
			.sort()
			.join("\n");
		if (nextWatchKey === activeWatchKey) {
			return;
		}

		closeActiveWatchers();
		const activeTargets: WatchTarget[] = [];
		for (const target of targets) {
			try {
				const watcher = watchFile(
					target.watchPath,
					{ persistent: false },
					(eventType, fileName) => {
						if (isMcpWatchEventRelevant(target, fileName)) {
							scheduleChange(eventType || "change");
						}
					},
				);
				watcher.on?.("error", (error) => {
					options.onError?.(
						error instanceof Error ? error : new Error(String(error)),
						target.watchPath,
					);
				});
				watchers.push(watcher);
				activeTargets.push(target);
			} catch (error) {
				options.onError?.(
					error instanceof Error ? error : new Error(String(error)),
					target.watchPath,
				);
			}
		}
		activeWatchKey = activeTargets
			.map((target) => `${target.watchPath}\0${target.fileName}`)
			.sort()
			.join("\n");
		activeWatchedPaths = activeTargets
			.map((target) => target.watchPath)
			.filter((path, index, paths) => paths.indexOf(path) === index)
			.sort();
	};

	const scheduleChange = (reason: string) => {
		if (closed) {
			return;
		}
		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}
		debounceTimer = setTimeout(() => {
			debounceTimer = undefined;
			if (closed) {
				return;
			}
			armWatchers();
			options.onChange(mcpServersChangedPayload(reason, sourceOptions));
		}, debounceMs);
	};

	armWatchers();

	return {
		close() {
			closed = true;
			if (debounceTimer) {
				clearTimeout(debounceTimer);
				debounceTimer = undefined;
			}
			closeActiveWatchers();
		},
		watchedPaths() {
			return [...activeWatchedPaths];
		},
	};
}

export function writeMcpServersMap(servers: JsonRecord): void {
	const path = resolveMcpSettingsPath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`);
}

export function ensureMcpSettingsFile(): string {
	const path = resolveMcpSettingsPath();
	if (!existsSync(path)) {
		writeMcpServersMap({});
	}
	return path;
}

function readServersMap(): { path: string; servers: JsonRecord } {
	const path = ensureMcpSettingsFile();
	const parsed = JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
	return { path, servers: (parsed.mcpServers as JsonRecord | undefined) ?? {} };
}

type CursorMcpImportSource = "workspace" | "global";

function getRecordValue(value: unknown): JsonRecord | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as JsonRecord)
		: undefined;
}

function getMcpSourceLabel(source: McpSettingsSource): string {
	switch (source) {
		case "cursor-workspace":
			return "Workspace Cursor";
		case "cursor-global":
			return "Global Cursor";
		default:
			return "CodeVibe";
	}
}

function readMcpServersMapFromPath(settingsPath: string): JsonRecord {
	const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as JsonRecord;
	return getRecordValue(parsed.mcpServers) ?? {};
}

function readRawMcpSettingsFile(settingsPath: string): JsonRecord {
	const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as JsonRecord;
	const servers = getRecordValue(parsed.mcpServers);
	if (!servers) {
		throw new Error(
			`Invalid MCP settings at ${settingsPath}: mcpServers must be an object`,
		);
	}
	return parsed;
}

function writeRawMcpSettingsFile(
	settingsPath: string,
	settings: JsonRecord,
): void {
	mkdirSync(dirname(settingsPath), { recursive: true });
	writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

function getCursorMcpUserHome(
	options: ReadMcpServersResponseOptions = {},
): string | undefined {
	return (
		options.userHome?.trim() ||
		process.env.CODEVIBE_CURSOR_HOME?.trim() ||
		undefined
	);
}

function getMcpSourcePathTargets(
	options: ReadMcpServersResponseOptions = {},
): McpSourcePathTarget[] {
	const root = options.workspaceRoot?.trim() || workspaceRoot;
	const userHome = getCursorMcpUserHome(options);
	return [
		{
			settingsPath: resolveMcpSettingsPath(),
			settingsSource: "cline",
		},
		{
			settingsPath: resolveCursorMcpSettingsPath(root),
			settingsSource: "cursor-workspace",
		},
		{
			settingsPath: resolveGlobalCursorMcpSettingsPath(userHome),
			settingsSource: "cursor-global",
		},
	];
}

function getMcpWatchTargets(
	options: ReadMcpServersResponseOptions = {},
): WatchTarget[] {
	const targets: WatchTarget[] = [];
	for (const source of getMcpSourcePathTargets(options)) {
		const settingsDir = dirname(source.settingsPath);
		if (existsSync(settingsDir)) {
			targets.push({
				watchPath: settingsDir,
				fileName: basename(source.settingsPath),
			});
			continue;
		}
		const parentDir = dirname(settingsDir);
		if (existsSync(parentDir)) {
			targets.push({
				watchPath: parentDir,
				fileName: basename(settingsDir),
			});
		}
	}
	return targets;
}

function uniqueMcpWatchTargets(targets: WatchTarget[]): WatchTarget[] {
	const seen = new Set<string>();
	const unique: WatchTarget[] = [];
	for (const target of targets) {
		const key = `${target.watchPath}\0${target.fileName}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		unique.push(target);
	}
	return unique;
}

function isMcpWatchEventRelevant(
	target: WatchTarget,
	fileName: string | Buffer | null,
): boolean {
	if (!fileName) {
		return true;
	}
	return fileName.toString() === target.fileName;
}

function getCursorMcpSourcePath(input: {
	source: CursorMcpImportSource;
	workspaceRoot: string;
	userHome?: string;
}): string {
	return input.source === "global"
		? resolveGlobalCursorMcpSettingsPath(input.userHome)
		: resolveCursorMcpSettingsPath(input.workspaceRoot);
}

function readOptionalCursorMcpSource(input: {
	settingsPath: string;
	settingsSource: Extract<
		McpSettingsSource,
		"cursor-workspace" | "cursor-global"
	>;
	workspaceRoot?: string;
	userHome?: string;
	sourceErrors: JsonRecord[];
}): McpServerSource | undefined {
	if (!existsSync(input.settingsPath)) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(
			readFileSync(input.settingsPath, "utf8"),
		) as JsonRecord;
		const normalized = normalizeCursorMcpSettingsObject(parsed, {
			...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
			...(input.userHome ? { userHome: input.userHome } : {}),
		}) as JsonRecord;
		return {
			settingsPath: input.settingsPath,
			settingsSource: input.settingsSource,
			sourceLabel: getMcpSourceLabel(input.settingsSource),
			servers: getRecordValue(normalized.mcpServers) ?? {},
		};
	} catch (error) {
		input.sourceErrors.push({
			settingsPath: input.settingsPath,
			settingsSource: input.settingsSource,
			message: error instanceof Error ? error.message : String(error),
		});
		return undefined;
	}
}

function getReadableMcpSourceSummaries(
	options: ReadMcpServersResponseOptions = {},
): JsonRecord[] {
	const root = options.workspaceRoot?.trim() || workspaceRoot;
	const userHome = getCursorMcpUserHome(options);
	return [
		{
			settingsSource: "cline",
			sourceLabel: getMcpSourceLabel("cline"),
			settingsPath: resolveMcpSettingsPath(),
			exists: existsSync(resolveMcpSettingsPath()),
			writable: true,
		},
		{
			settingsSource: "cursor-workspace",
			sourceLabel: getMcpSourceLabel("cursor-workspace"),
			settingsPath: resolveCursorMcpSettingsPath(root),
			exists: existsSync(resolveCursorMcpSettingsPath(root)),
			writable: true,
		},
		{
			settingsSource: "cursor-global",
			sourceLabel: getMcpSourceLabel("cursor-global"),
			settingsPath: resolveGlobalCursorMcpSettingsPath(userHome),
			exists: existsSync(resolveGlobalCursorMcpSettingsPath(userHome)),
			writable: true,
		},
	];
}

function getReadableMcpServerSources(
	options: ReadMcpServersResponseOptions = {},
	sourceErrors: JsonRecord[] = [],
): McpServerSource[] {
	const sources: McpServerSource[] = [];
	const nativeSettingsPath = resolveMcpSettingsPath();
	if (existsSync(nativeSettingsPath)) {
		sources.push({
			settingsPath: nativeSettingsPath,
			settingsSource: "cline",
			sourceLabel: getMcpSourceLabel("cline"),
			servers: readMcpServersMapFromPath(nativeSettingsPath),
		});
	}

	const root = options.workspaceRoot?.trim() || workspaceRoot;
	const userHome = getCursorMcpUserHome(options);
	const workspaceCursorPath = getCursorMcpSourcePath({
		source: "workspace",
		workspaceRoot: root,
		userHome,
	});
	const workspaceCursorSource = readOptionalCursorMcpSource({
		settingsPath: workspaceCursorPath,
		settingsSource: "cursor-workspace",
		workspaceRoot: root,
		userHome,
		sourceErrors,
	});
	if (workspaceCursorSource) {
		sources.push(workspaceCursorSource);
	}

	const globalCursorPath = getCursorMcpSourcePath({
		source: "global",
		workspaceRoot: root,
		userHome,
	});
	const globalCursorSource = readOptionalCursorMcpSource({
		settingsPath: globalCursorPath,
		settingsSource: "cursor-global",
		userHome,
		sourceErrors,
	});
	if (globalCursorSource) {
		sources.push(globalCursorSource);
	}

	return sources;
}

function buildMcpServerResponseEntry(
	name: string,
	body: unknown,
	source: McpServerSource,
): JsonRecord {
	const record = getRecordValue(body) ?? {};
	const transport = getRecordValue(record.transport);
	const transportType = String(
		transport?.type ?? record.transportType ?? record.type ?? "stdio",
	).trim();
	const disabled = record.disabled === true;
	const oauth = getRecordValue(record.oauth);
	const oauthStatus = inferMcpOAuthStatus({
		transportType,
		disabled,
		oauth,
	});
	return {
		name,
		transportType,
		disabled,
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
		settingsPath: source.settingsPath,
		settingsSource: source.settingsSource,
		sourceLabel: source.sourceLabel,
		writable: true,
		canEdit: source.settingsSource === "cline",
		canDelete: source.settingsSource === "cline",
		oauthSupported: transportType !== "stdio",
		oauthConfigured: hasMcpOAuthAccessToken(oauth),
		oauthStatus,
		oauthLastError:
			typeof oauth?.lastError === "string" ? oauth.lastError : undefined,
		oauthLastAuthenticatedAt: getNumericValue(oauth?.lastAuthenticatedAt),
		metadata: record.metadata,
	};
}

function getNumericValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function hasMcpOAuthAccessToken(oauth: JsonRecord | undefined): boolean {
	const tokens = getRecordValue(oauth?.tokens);
	return (
		typeof tokens?.access_token === "string" &&
		tokens.access_token.trim().length > 0
	);
}

function inferMcpOAuthStatus(input: {
	transportType: string;
	disabled: boolean;
	oauth?: JsonRecord;
}): McpOAuthStatus {
	if (input.transportType === "stdio") {
		return "unsupported";
	}
	if (input.disabled) {
		return "disabled";
	}
	if (hasMcpOAuthAccessToken(input.oauth)) {
		return "authenticated";
	}
	const lastError =
		typeof input.oauth?.lastError === "string" ? input.oauth.lastError : "";
	if (!lastError.trim()) {
		return "available";
	}
	return /requires?\s+OAuth|authorization|unauthorized|401/i.test(lastError)
		? "needs_auth"
		: "error";
}

function resolveCursorMcpSettingsPath(root: string): string {
	return join(resolve(root), ".cursor", "mcp.json");
}

function readCursorMcpImportSource(args?: JsonRecord): {
	source: CursorMcpImportSource;
	userHome?: string;
} {
	const rawSource = typeof args?.source === "string" ? args.source.trim() : "";
	const source: CursorMcpImportSource =
		rawSource === "global" || args?.global === true ? "global" : "workspace";
	const userHome = process.env.CODEVIBE_CURSOR_HOME?.trim() || undefined;
	return { source, ...(userHome ? { userHome } : {}) };
}

function readCursorMcpServers(input: {
	source: CursorMcpImportSource;
	workspaceRoot: string;
	userHome?: string;
}): {
	sourcePath: string;
	servers: JsonRecord;
} {
	const sourcePath = getCursorMcpSourcePath(input);
	if (!existsSync(sourcePath)) {
		throw new Error(
			input.source === "global"
				? "No global ~/.cursor/mcp.json found"
				: "No .cursor/mcp.json found in the active workspace",
		);
	}
	const parsed = JSON.parse(readFileSync(sourcePath, "utf8")) as JsonRecord;
	const normalized = normalizeCursorMcpSettingsObject(parsed, {
		...(input.source === "global" && input.userHome
			? { userHome: input.userHome }
			: {}),
		...(input.source === "workspace"
			? { workspaceRoot: input.workspaceRoot }
			: {}),
	}) as JsonRecord;
	const servers = getRecordValue(normalized.mcpServers);
	if (!servers || Object.keys(servers).length === 0) {
		throw new Error(".cursor/mcp.json does not contain any MCP servers");
	}
	return { sourcePath, servers };
}

function resolveMcpServerWriteTarget(name: string): McpServerWriteTarget {
	const target = findMcpServerWriteTarget(name);
	if (!target) {
		throw new Error(`unknown MCP server: ${name}`);
	}
	return target;
}

function findMcpServerWriteTarget(
	name: string,
): McpServerWriteTarget | undefined {
	const sourceErrors: JsonRecord[] = [];
	for (const source of getReadableMcpServerSources({}, sourceErrors)) {
		if (Object.hasOwn(source.servers, name)) {
			return {
				settingsPath: source.settingsPath,
				settingsSource: source.settingsSource,
				servers: source.servers,
			};
		}
	}
	return undefined;
}

function updateServerInSettingsFile(
	target: McpServerWriteTarget,
	name: string,
	updater: (current: JsonRecord) => JsonRecord | undefined,
): void {
	const settings =
		target.settingsSource === "cline" && !existsSync(target.settingsPath)
			? { mcpServers: {} }
			: readRawMcpSettingsFile(target.settingsPath);
	const servers = getRecordValue(settings.mcpServers);
	if (!servers) {
		throw new Error(
			`Invalid MCP settings at ${target.settingsPath}: mcpServers must be an object`,
		);
	}
	const current = getRecordValue(servers[name]);
	if (!current) {
		throw new Error(`unknown MCP server: ${name}`);
	}
	const next = updater(current);
	if (next) {
		servers[name] = next;
	} else {
		delete servers[name];
	}
	writeRawMcpSettingsFile(target.settingsPath, settings);
}

function buildCursorMcpImportResponse(input: {
	confirmed: boolean;
	imported: boolean;
	source: CursorMcpImportSource;
	sourcePath: string;
	serverNames: string[];
	replacedNames?: string[];
}): JsonRecord {
	return {
		handled: true,
		route: "cursor-mcp-import",
		confirmed: input.confirmed,
		imported: input.imported,
		source: input.source,
		sourcePath: input.sourcePath,
		serverNames: input.serverNames,
		importedCount: input.imported ? input.serverNames.length : 0,
		replacedNames: input.replacedNames ?? [],
		...readMcpServersResponse(),
	};
}

export function importCursorMcpServers(args?: JsonRecord): JsonRecord {
	const importSource = readCursorMcpImportSource(args);
	const { sourcePath, servers: cursorServers } = readCursorMcpServers({
		source: importSource.source,
		workspaceRoot,
		userHome: importSource.userHome,
	});
	const serverNames = Object.keys(cursorServers).sort();
	if (args?.confirmed !== true) {
		return buildCursorMcpImportResponse({
			confirmed: false,
			imported: false,
			source: importSource.source,
			sourcePath,
			serverNames,
		});
	}

	const { servers: existingServers } = readServersMap();
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
					source:
						importSource.source === "global"
							? "global-cursor-mcp"
							: "workspace-mcp",
					path:
						importSource.source === "global"
							? "~/.cursor/mcp.json"
							: ".cursor/mcp.json",
					importedAt,
				},
			},
		};
	}
	writeMcpServersMap(nextServers);
	return buildCursorMcpImportResponse({
		confirmed: true,
		imported: true,
		source: importSource.source,
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

function readServerTransportType(server: JsonRecord | undefined): string {
	const transport = getRecordValue(server?.transport);
	return String(
		transport?.type ?? server?.transportType ?? server?.type ?? "stdio",
	).trim();
}

function readServerTransportUrl(
	server: JsonRecord | undefined,
): string | undefined {
	const transport = getRecordValue(server?.transport);
	const url = transport?.url ?? server?.url;
	return typeof url === "string" && url.trim() ? url.trim() : undefined;
}

function getPreservedOAuthState(
	current: JsonRecord | undefined,
	next: JsonRecord,
): JsonRecord | undefined {
	const oauth = getRecordValue(current?.oauth);
	if (!oauth) {
		return undefined;
	}
	const currentType = readServerTransportType(current);
	const nextType = readServerTransportType(next);
	if (currentType !== nextType || nextType === "stdio") {
		return undefined;
	}
	if (readServerTransportUrl(current) !== readServerTransportUrl(next)) {
		return undefined;
	}
	return oauth;
}

function buildCursorMcpInstallResponse(
	request: CursorMcpInstallRequest,
	input: {
		confirmed: boolean;
		installed: boolean;
		settingsPath: string;
		replaced: boolean;
	},
): JsonRecord {
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
		...(Array.isArray(transport.args)
			? { argCount: transport.args.length }
			: {}),
		...(env ? { envKeys: Object.keys(env).sort() } : {}),
		...(headers ? { headerKeys: Object.keys(headers).sort() } : {}),
		...readMcpServersResponse(),
	};
}

export function installCursorMcpServer(args?: JsonRecord): JsonRecord {
	const uri = typeof args?.uri === "string" ? args.uri.trim() : "";
	if (!uri) {
		throw new Error("cursor_mcp_install requires a non-empty uri");
	}
	const request = buildCursorMcpInstallRequest(uri);
	const { path, servers } = readServersMap();
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

export async function authorizeMcpServerOAuthForHub(
	args?: JsonRecord,
	deps: AuthorizeMcpServerOAuthForHubDeps = {},
): Promise<JsonRecord> {
	const serverName = String(args?.name ?? args?.serverName ?? "").trim();
	if (!serverName) {
		throw new Error("authorize_mcp_server_oauth requires a server name");
	}
	const target = resolveMcpServerWriteTarget(serverName);
	const settingsPath = target.settingsPath;
	const serverListening: JsonRecord[] = [];
	const serverClosed: JsonRecord[] = [];
	const authorize = deps.authorize ?? authorizeMcpServerOAuth;
	const result = await authorize({
		serverName,
		filePath: settingsPath,
		clientName: "cline-hub",
		clientVersion: "0.0.0",
		timeoutMs: toPositiveInt(args?.timeoutMs) ?? 110_000,
		successHtml:
			"<html><body><h1>MCP authorization complete</h1><p>You can return to CodeVibe.</p></body></html>",
		openUrl: deps.openUrl ?? openExternalUrl,
		onServerListening: (info) => {
			serverListening.push({
				host: info.host,
				port: info.port,
				callbackOrigin: safeUrlOrigin(info.callbackUrl) ?? "loopback",
			});
		},
		onServerClose: (info) => {
			serverClosed.push({
				host: info.host,
				port: info.port,
			});
		},
	});
	return {
		handled: true,
		route: "mcp-oauth",
		serverName: result.serverName,
		authorized: result.authorized,
		message: result.message,
		settingsPath,
		serverListening,
		serverClosed,
		...readMcpServersResponse(),
	};
}

export function setMcpServerDisabled(
	name: string,
	disabled: boolean,
): JsonRecord {
	const target = resolveMcpServerWriteTarget(name);
	updateServerInSettingsFile(target, name, (current) => ({
		...current,
		disabled,
	}));
	return readMcpServersResponse();
}

export function upsertMcpServer(input: JsonRecord): JsonRecord {
	const name = String(input.name ?? "").trim();
	if (!name) throw new Error("server name is required");
	const previousName = String(
		input.previousName ?? input.previous_name ?? "",
	).trim();
	const transportType = String(
		input.transportType ?? input.transport_type ?? "",
	).trim();
	const existingNameOwner = findMcpServerWriteTarget(name);
	const previousOwner = previousName
		? findMcpServerWriteTarget(previousName)
		: undefined;
	if (previousName) {
		if (!previousOwner || previousOwner.settingsSource !== "cline") {
			throw new Error(
				"Only CodeVibe MCP servers can be edited from the hub editor.",
			);
		}
		if (previousName !== name && existingNameOwner) {
			throw new Error(
				`MCP server "${name}" already exists in ${existingNameOwner.settingsSource} settings.`,
			);
		}
	} else if (existingNameOwner) {
		throw new Error(
			`MCP server "${name}" already exists in ${existingNameOwner.settingsSource} settings.`,
		);
	}
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
					disabled: input.disabled === true,
				}
			: {
					transport: {
						type: transportType === "sse" ? "sse" : "streamableHttp",
						url: input.url,
						headers: input.headers,
					},
					disabled: input.disabled === true,
				};
	const { servers } = readServersMap();
	if (previousName && previousName !== name) {
		delete servers[previousName];
	}
	const currentServer =
		!previousName || previousName === name
			? getRecordValue(servers[name])
			: undefined;
	const preservedOAuth = getPreservedOAuthState(currentServer, next);
	if (preservedOAuth) {
		next.oauth = preservedOAuth;
	}
	servers[name] = next;
	writeMcpServersMap(servers);
	return readMcpServersResponse();
}

export function deleteMcpServer(name: string): JsonRecord {
	if (!name) throw new Error("server name is required");
	const target = resolveMcpServerWriteTarget(name);
	updateServerInSettingsFile(target, name, () => undefined);
	return readMcpServersResponse();
}
