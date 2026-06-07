import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	buildCursorMcpInstallRequest,
	type CursorMcpInstallRequest,
	normalizeCursorMcpSettingsObject,
	resolveGlobalCursorMcpSettingsPath,
} from "@cline/core";
import { resolveMcpSettingsPath } from "@cline/shared/storage";
import { workspaceRoot } from "./deps";
import type { JsonRecord } from "./types";

export function readMcpServersResponse(): JsonRecord {
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
	const sourcePath =
		input.source === "global"
			? resolveGlobalCursorMcpSettingsPath(input.userHome)
			: resolveCursorMcpSettingsPath(input.workspaceRoot);
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
		...(Array.isArray(transport.args) ? { argCount: transport.args.length } : {}),
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

export function setMcpServerDisabled(
	name: string,
	disabled: boolean,
): JsonRecord {
	const { servers } = readServersMap();
	const current = servers[name];
	if (!current || typeof current !== "object") {
		throw new Error(`unknown MCP server: ${name}`);
	}
	servers[name] = { ...(current as JsonRecord), disabled };
	writeMcpServersMap(servers);
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
	servers[name] = next;
	writeMcpServersMap(servers);
	return readMcpServersResponse();
}

export function deleteMcpServer(name: string): JsonRecord {
	if (!name) throw new Error("server name is required");
	const { servers } = readServersMap();
	delete servers[name];
	writeMcpServersMap(servers);
	return readMcpServersResponse();
}
