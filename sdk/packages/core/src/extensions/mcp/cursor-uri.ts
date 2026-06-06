const MAX_CURSOR_URI_PARAM_LENGTH = 16_384;
const MAX_CURSOR_URI_CONFIG_JSON_LENGTH = 64 * 1024;
const MAX_MCP_SERVER_NAME_LENGTH = 128;
const RESERVED_MCP_SERVER_NAMES = new Set([
	"__proto__",
	"constructor",
	"prototype",
]);

export interface CursorMcpInstallRequest {
	serverName: string;
	serverConfig: Record<string, unknown>;
	source: "config" | "direct";
}

export class CursorMcpInstallError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CursorMcpInstallError";
	}
}

function getString(
	value: string | Record<string, unknown> | undefined,
): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getFirstString(
	...values: Array<string | Record<string, unknown> | undefined>
): string | undefined {
	for (const value of values) {
		const candidate = getString(value);
		if (candidate) return candidate;
	}
	return undefined;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function decodeBase64JsonConfig(value: string): Record<string, unknown> {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
	const raw = Buffer.from(padded, "base64").toString("utf8");
	if (raw.length > MAX_CURSOR_URI_CONFIG_JSON_LENGTH) {
		throw new CursorMcpInstallError("config JSON exceeds maximum length");
	}
	const parsed = JSON.parse(raw) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new CursorMcpInstallError("config must decode to a JSON object");
	}
	return parsed as Record<string, unknown>;
}

function parseCursorMcpInstallParams(
	uri: string,
): Record<string, string | Record<string, unknown>> {
	const parsedUrl = new URL(uri);
	if (parsedUrl.pathname !== "/mcp/install") {
		throw new CursorMcpInstallError(
			`Expected /mcp/install route, received ${parsedUrl.pathname || "/"}`,
		);
	}

	const query = new URLSearchParams(parsedUrl.search.slice(1).replace(/\+/g, "%2B"));
	const values: Record<string, string | Record<string, unknown>> = {};
	for (const [key, value] of query.entries()) {
		if (!key || key.length > 128) {
			throw new CursorMcpInstallError("query parameter name is invalid");
		}
		if (Object.hasOwn(values, key)) {
			throw new CursorMcpInstallError(`duplicate query parameter: ${key}`);
		}
		if (value.length > MAX_CURSOR_URI_PARAM_LENGTH) {
			throw new CursorMcpInstallError(`query parameter is too large: ${key}`);
		}
		values[key] = key === "config" ? decodeBase64JsonConfig(value) : value;
	}

	if (
		!getFirstString(
			values.name,
			values.server,
			values.id,
			values.url,
			values.command,
			values.package,
		) &&
		!values.config
	) {
		throw new CursorMcpInstallError("one MCP identifier or config is required");
	}

	return values;
}

function normalizeMcpServerName(value: string | undefined, required: true): string;
function normalizeMcpServerName(
	value: string | undefined,
	required: false,
): string | undefined;
function normalizeMcpServerName(
	value: string | undefined,
	required: boolean,
): string | undefined {
	const normalized = value?.trim();
	if (!normalized) {
		if (required) {
			throw new CursorMcpInstallError("MCP server name is required");
		}
		return undefined;
	}
	if (normalized.length > MAX_MCP_SERVER_NAME_LENGTH) {
		throw new CursorMcpInstallError(
			`MCP server name must be ${MAX_MCP_SERVER_NAME_LENGTH} characters or fewer`,
		);
	}
	if (RESERVED_MCP_SERVER_NAMES.has(normalized) || /[\x00-\x1f/\\]/.test(normalized)) {
		throw new CursorMcpInstallError("MCP server name contains unsafe characters");
	}
	return normalized;
}

function safeNameCandidate(value: string): string {
	return value
		.trim()
		.replace(/^@/, "")
		.replace(/[^a-zA-Z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, MAX_MCP_SERVER_NAME_LENGTH);
}

function deriveDirectServerName(
	params: Record<string, string | Record<string, unknown>>,
): string {
	const packageName = getString(params.package);
	if (packageName) {
		return normalizeMcpServerName(safeNameCandidate(packageName), true);
	}

	const url = getString(params.url);
	if (url) {
		try {
			const parsed = new URL(url);
			const pathName = parsed.pathname.split("/").filter(Boolean).pop();
			return normalizeMcpServerName(
				safeNameCandidate(
					pathName ? `${parsed.hostname}-${pathName}` : parsed.hostname,
				),
				true,
			);
		} catch {
			return normalizeMcpServerName(safeNameCandidate(url), true);
		}
	}

	const command = getString(params.command);
	if (command) {
		return normalizeMcpServerName(
			safeNameCandidate(command.split(/\s+/)[0] || command),
			true,
		);
	}

	throw new CursorMcpInstallError("MCP server name is required");
}

function selectConfiguredServer(
	entries: Array<[string, unknown]>,
	requestedName: string | undefined,
): [string, Record<string, unknown>] {
	if (requestedName) {
		const entry = entries.find(([name]) => name === requestedName);
		if (!entry) {
			throw new CursorMcpInstallError(
				`MCP config does not contain server "${requestedName}"`,
			);
		}
		return [normalizeMcpServerName(entry[0], true), validateServerConfig(entry[1])];
	}

	if (entries.length !== 1) {
		throw new CursorMcpInstallError(
			"MCP config contains multiple servers; include name, server, or id to choose one",
		);
	}

	return [
		normalizeMcpServerName(entries[0][0], true),
		validateServerConfig(entries[0][1]),
	];
}

function buildDirectServerConfig(
	params: Record<string, string | Record<string, unknown>>,
	config: Record<string, unknown> | undefined,
): Record<string, unknown> {
	const rawConfig = config && !config.mcpServers ? { ...config } : {};
	const url = getString(params.url);
	const command = getString(params.command);
	const packageName = getString(params.package);

	if (url) {
		return {
			...rawConfig,
			url,
			type:
				(rawConfig.type as string | undefined) ??
				(rawConfig.transportType === "http" ? "streamableHttp" : undefined) ??
				"streamableHttp",
			disabled: rawConfig.disabled ?? false,
			autoApprove: rawConfig.autoApprove ?? [],
		};
	}

	if (command) {
		return {
			...rawConfig,
			command,
			type: "stdio",
			disabled: rawConfig.disabled ?? false,
			autoApprove: rawConfig.autoApprove ?? [],
		};
	}

	if (packageName) {
		return {
			...rawConfig,
			command: "npx",
			args: ["-y", packageName],
			type: "stdio",
			disabled: rawConfig.disabled ?? false,
			autoApprove: rawConfig.autoApprove ?? [],
		};
	}

	throw new CursorMcpInstallError(
		"MCP install requires config, url, command, or package",
	);
}

function assertStringRecord(value: unknown, label: string): void {
	if (value === undefined) return;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new CursorMcpInstallError(`${label} must be an object`);
	}
	for (const [key, item] of Object.entries(value)) {
		if (typeof item !== "string") {
			throw new CursorMcpInstallError(`${label}.${key} must be a string`);
		}
	}
}

function validateServerConfig(value: unknown): Record<string, unknown> {
	const config = getRecord(value);
	if (!config) {
		throw new CursorMcpInstallError(
			"Invalid MCP server config: expected object",
		);
	}

	const transport = getRecord(config.transport);
	const transportConfig = transport ?? config;
	const type = String(
		transportConfig.type ??
			(transportConfig.transportType === "http"
				? "streamableHttp"
				: transportConfig.transportType) ??
			(transportConfig.url ? "sse" : "stdio"),
	);

	if (type === "stdio") {
		if (
			typeof transportConfig.command !== "string" ||
			!transportConfig.command.trim()
		) {
			throw new CursorMcpInstallError(
				"Invalid MCP server config: command is required for stdio",
			);
		}
		if (
			transportConfig.args !== undefined &&
			(!Array.isArray(transportConfig.args) ||
				transportConfig.args.some((item) => typeof item !== "string"))
		) {
			throw new CursorMcpInstallError(
				"Invalid MCP server config: args must be strings",
			);
		}
		assertStringRecord(transportConfig.env, "env");
		return config;
	}

	if (type === "sse" || type === "streamableHttp") {
		if (typeof transportConfig.url !== "string") {
			throw new CursorMcpInstallError(
				"Invalid MCP server config: url is required",
			);
		}
		new URL(transportConfig.url);
		assertStringRecord(transportConfig.headers, "headers");
		return config;
	}

	throw new CursorMcpInstallError(
		`Invalid MCP server config: unsupported type "${type}"`,
	);
}

export function buildCursorMcpInstallRequest(
	uri: string,
): CursorMcpInstallRequest {
	const params = parseCursorMcpInstallParams(uri);
	const config = getRecord(params.config);
	const requestedName = normalizeMcpServerName(
		getFirstString(params.name, params.server, params.id),
		false,
	);

	if (
		config?.mcpServers &&
		typeof config.mcpServers === "object" &&
		!Array.isArray(config.mcpServers)
	) {
		const entries = Object.entries(config.mcpServers);
		if (entries.length === 0) {
			throw new CursorMcpInstallError(
				"MCP config must include at least one server",
			);
		}
		const [serverName, serverConfig] = selectConfiguredServer(
			entries,
			requestedName,
		);
		return { serverName, serverConfig, source: "config" };
	}

	const serverConfig = validateServerConfig(
		buildDirectServerConfig(params, config),
	);
	const serverName = requestedName ?? deriveDirectServerName(params);
	return { serverName, serverConfig, source: "direct" };
}

export function formatCursorMcpInstallDetail(
	request: CursorMcpInstallRequest,
): string {
	const config = request.serverConfig;
	const transport = getRecord(config.transport) ?? config;
	const lines = [
		`Server: ${request.serverName}`,
		`Transport: ${transport.type ?? "stdio"}`,
	];
	if (typeof transport.url === "string") {
		lines.push(`URL: ${transport.url}`);
	}
	if (typeof transport.command === "string") {
		lines.push(
			`Command: ${transport.command}${
				Array.isArray(transport.args) ? ` ${transport.args.join(" ")}` : ""
			}`,
		);
	}
	if (transport.env && typeof transport.env === "object") {
		lines.push(
			`Environment keys: ${Object.keys(transport.env).sort().join(", ") || "(none)"}`,
		);
	}
	if (transport.headers && typeof transport.headers === "object") {
		lines.push(
			`Header keys: ${Object.keys(transport.headers).sort().join(", ") || "(none)"}`,
		);
	}
	return lines.join("\n");
}
