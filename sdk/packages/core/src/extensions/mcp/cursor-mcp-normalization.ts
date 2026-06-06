import { homedir } from "node:os";
import { basename, sep } from "node:path";

export interface CursorMcpVariableContext {
	env?: Record<string, string | undefined>;
	userHome?: string;
	workspaceRoot?: string;
	pathSeparator?: string;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function normalizeCursorMcpTransportType(
	value: unknown,
): "stdio" | "sse" | "streamableHttp" | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase().replace(/[-_]/g, "");
	if (!normalized) return undefined;
	if (normalized === "stdio") return "stdio";
	if (normalized === "sse") return "sse";
	if (normalized === "http" || normalized === "streamablehttp") {
		return "streamableHttp";
	}
	return undefined;
}

function expandCursorMcpString(
	value: string,
	context: CursorMcpVariableContext,
): string {
	const env = context.env ?? process.env;
	const userHome = context.userHome ?? homedir();
	const workspaceRoot = context.workspaceRoot?.trim();
	const pathSeparator = context.pathSeparator ?? sep;

	return value.replace(/\$\{([^}]+)\}/g, (match, rawName) => {
		const name = String(rawName).trim();
		if (name.startsWith("env:")) {
			const envName = name.slice("env:".length).trim();
			return env[envName] ?? match;
		}
		if (name === "userHome") return userHome;
		if (name === "workspaceFolder") return workspaceRoot || match;
		if (name === "workspaceFolderBasename") {
			return workspaceRoot ? basename(workspaceRoot) : match;
		}
		if (name === "pathSeparator" || name === "/") return pathSeparator;
		return match;
	});
}

function expandCursorMcpValue<T>(value: T, context: CursorMcpVariableContext): T {
	if (typeof value === "string") {
		return expandCursorMcpString(value, context) as T;
	}
	if (Array.isArray(value)) {
		return value.map((item) => expandCursorMcpValue(item, context)) as T;
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			out[key] = expandCursorMcpValue(item, context);
		}
		return out as T;
	}
	return value;
}

function normalizeTransportAliasFields<T extends Record<string, unknown>>(
	value: T,
): T {
	const normalizedType = normalizeCursorMcpTransportType(
		value.type ?? value.transportType,
	);
	if (!normalizedType) return value;
	const { transportType: _transportType, type: _type, ...serverFields } = value;
	return {
		...serverFields,
		type: normalizedType,
	};
}

export function normalizeCursorMcpServerConfig(
	value: unknown,
	context: CursorMcpVariableContext = {},
): unknown {
	const serverConfig = getRecord(value);
	if (!serverConfig) return value;

	const expanded = expandCursorMcpValue(serverConfig, context);
	const transport = getRecord(expanded.transport);
	if (!transport) {
		return normalizeTransportAliasFields(expanded);
	}
	const { transport: _transport, ...serverFields } = expanded;

	return normalizeTransportAliasFields({
		...serverFields,
		...transport,
	});
}

export function normalizeCursorMcpSettingsObject(
	value: unknown,
	context: CursorMcpVariableContext = {},
): unknown {
	const settings = getRecord(value);
	const servers = getRecord(settings?.mcpServers);
	if (!settings || !servers) return value;

	const normalizedServers: Record<string, unknown> = {};
	for (const [name, config] of Object.entries(servers)) {
		normalizedServers[name] = normalizeCursorMcpServerConfig(config, context);
	}
	return {
		...settings,
		mcpServers: normalizedServers,
	};
}
