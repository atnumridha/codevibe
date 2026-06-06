import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
	type McpServerOAuthState,
	resolveDefaultMcpSettingsPath,
} from "@cline/core";

export interface McpServerEntry {
	name: string;
	transport: McpTransport;
	disabled?: boolean;
	oauth?: McpServerOAuthState;
}

export type McpTransport =
	| {
			type: "stdio";
			command: string;
			args?: string[];
			env?: Record<string, string>;
	  }
	| { type: "sse"; url: string; headers?: Record<string, string> }
	| { type: "streamableHttp"; url: string; headers?: Record<string, string> };

export function getSettingsPath(): string {
	return resolveDefaultMcpSettingsPath();
}

export function loadServers(): McpServerEntry[] {
	const path = getSettingsPath();
	if (!existsSync(path)) return [];
	try {
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw) as {
			mcpServers?: Record<string, unknown>;
		};
		const servers = parsed.mcpServers ?? {};
		if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
			return [];
		}
		return Object.entries(servers).map(([name, value]) => {
			const entry = value as Record<string, unknown>;
			const transport = (entry.transport ?? entry) as McpTransport;
			const oauth =
				entry.oauth &&
				typeof entry.oauth === "object" &&
				!Array.isArray(entry.oauth)
					? (entry.oauth as McpServerOAuthState)
					: undefined;
			return {
				name,
				transport,
				disabled: entry.disabled === true,
				oauth,
			};
		});
	} catch {
		return [];
	}
}

function readRawSettingsForWrite(): Record<string, unknown> {
	const path = getSettingsPath();
	if (!existsSync(path)) return {};

	let parsed: unknown;
	try {
		const raw = readFileSync(path, "utf-8");
		parsed = JSON.parse(raw) as unknown;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Cannot modify MCP settings because ${path} contains invalid JSON: ${reason}`,
		);
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(
			`Cannot modify MCP settings because ${path} must contain a JSON object`,
		);
	}

	return parsed as Record<string, unknown>;
}

function readRawServersForWrite(
	settings: Record<string, unknown>,
): Record<string, unknown> {
	const servers = settings.mcpServers;
	if (servers === undefined) return {};
	if (servers && typeof servers === "object" && !Array.isArray(servers)) {
		return { ...(servers as Record<string, unknown>) };
	}
	throw new Error(
		"Cannot modify MCP settings because mcpServers must be a JSON object",
	);
}

function getOwnServerRecord(
	servers: Record<string, unknown>,
	name: string,
): Record<string, unknown> | undefined {
	if (!Object.hasOwn(servers, name)) {
		return undefined;
	}
	const value = servers[name];
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	return value as Record<string, unknown>;
}

function writeServers(
	settings: Record<string, unknown>,
	servers: Record<string, unknown>,
): void {
	const path = getSettingsPath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		`${JSON.stringify({ ...settings, mcpServers: servers }, null, 2)}\n`,
	);
}

export function addServer(name: string, transport: McpTransport): void {
	const settings = readRawSettingsForWrite();
	const servers = readRawServersForWrite(settings);
	servers[name] = { transport };
	writeServers(settings, servers);
}

export function addServerRecord(
	name: string,
	record: Record<string, unknown>,
): void {
	const settings = readRawSettingsForWrite();
	const servers = readRawServersForWrite(settings);
	servers[name] = record;
	writeServers(settings, servers);
}

export function removeServer(name: string): boolean {
	const settings = readRawSettingsForWrite();
	const servers = readRawServersForWrite(settings);
	if (!(name in servers)) return false;
	delete servers[name];
	writeServers(settings, servers);
	return true;
}

export function updateServer(name: string, transport: McpTransport): void {
	const settings = readRawSettingsForWrite();
	const servers = readRawServersForWrite(settings);
	const existing =
		servers[name] && typeof servers[name] === "object"
			? (servers[name] as Record<string, unknown>)
			: {};
	servers[name] = { ...existing, transport };
	writeServers(settings, servers);
}

export function clearServerOAuth(name: string): void {
	const settings = readRawSettingsForWrite();
	const servers = readRawServersForWrite(settings);
	const existing = getOwnServerRecord(servers, name);
	if (!existing) {
		return;
	}
	delete existing.oauth;
	servers[name] = existing;
	writeServers(settings, servers);
}

export function toggleServer(name: string, disabled: boolean): void {
	const settings = readRawSettingsForWrite();
	const servers = readRawServersForWrite(settings);
	const existing =
		servers[name] && typeof servers[name] === "object"
			? (servers[name] as Record<string, unknown>)
			: {};
	if (disabled) {
		existing.disabled = true;
	} else {
		delete existing.disabled;
	}
	servers[name] = existing;
	writeServers(settings, servers);
}
