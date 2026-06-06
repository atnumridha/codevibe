import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { resolveMcpSettingsPath } from "@cline/shared/storage";
import { z } from "zod";
import {
	normalizeCursorMcpSettingsObject,
	type CursorMcpVariableContext,
} from "./cursor-mcp-normalization";
import type {
	McpManager,
	McpServerOAuthState,
	McpServerOAuthStatus,
	McpServerRegistration,
} from "./types";

const stringRecordSchema = z.record(z.string(), z.string());
const metadataSchema = z.record(z.string(), z.unknown());
const CURSOR_MCP_SETTINGS_RELATIVE_PATH = join(".cursor", "mcp.json");
const oauthStateSchema = z
	.object({
		clientInformation: z.record(z.string(), z.unknown()).optional(),
		tokens: z.record(z.string(), z.unknown()).optional(),
		codeVerifier: z.string().optional(),
		discoveryState: z.record(z.string(), z.unknown()).optional(),
		redirectUrl: z.string().url().optional(),
		lastError: z.string().optional(),
		lastAuthenticatedAt: z.number().int().positive().optional(),
	})
	.strip();

const stdioTransportSchema = z.object({
	type: z.literal("stdio"),
	command: z.string().min(1),
	args: z.array(z.string()).optional(),
	cwd: z.string().min(1).optional(),
	env: stringRecordSchema.optional(),
});

const sseTransportSchema = z.object({
	type: z.literal("sse"),
	url: z.string().url(),
	headers: stringRecordSchema.optional(),
});

const streamableHttpTransportSchema = z.object({
	type: z.literal("streamableHttp"),
	url: z.string().url(),
	headers: stringRecordSchema.optional(),
});

const mcpTransportSchema = z.discriminatedUnion("type", [
	stdioTransportSchema,
	sseTransportSchema,
	streamableHttpTransportSchema,
]);

const nestedRegistrationBodySchema = z.object({
	transport: mcpTransportSchema,
	disabled: z.boolean().optional(),
	metadata: metadataSchema.optional(),
	oauth: oauthStateSchema.optional(),
});

const legacyTransportTypeSchema = z
	.enum(["stdio", "sse", "http", "streamableHttp"])
	.optional();

const legacyRegistrationBaseSchema = z.object({
	type: z.enum(["stdio", "sse", "streamableHttp"]).optional(),
	transportType: legacyTransportTypeSchema,
	disabled: z.boolean().optional(),
	metadata: metadataSchema.optional(),
	oauth: oauthStateSchema.optional(),
});

function mapLegacyTransportType(
	transportType: z.infer<typeof legacyTransportTypeSchema>,
): "stdio" | "sse" | "streamableHttp" | undefined {
	if (!transportType) {
		return undefined;
	}
	if (transportType === "http") {
		return "streamableHttp";
	}
	return transportType;
}

const legacyStdioRegistrationSchema = legacyRegistrationBaseSchema
	.extend({
		command: z.string().min(1),
		args: z.array(z.string()).optional(),
		cwd: z.string().min(1).optional(),
		env: stringRecordSchema.optional(),
	})
	.superRefine((value, ctx) => {
		const resolvedType =
			value.type ?? mapLegacyTransportType(value.transportType);
		if (resolvedType && resolvedType !== "stdio") {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'Expected type "stdio" for command-based MCP server',
				path: ["type"],
			});
		}
	})
	.transform((value) => ({
		transport: {
			type: "stdio" as const,
			command: value.command,
			args: value.args,
			cwd: value.cwd,
			env: value.env,
		},
		disabled: value.disabled,
		metadata: value.metadata,
		oauth: value.oauth,
	}));

const legacyUrlRegistrationSchema = legacyRegistrationBaseSchema
	.extend({
		url: z.string().url(),
		headers: stringRecordSchema.optional(),
	})
	.superRefine((value, ctx) => {
		const resolvedType =
			value.type ?? mapLegacyTransportType(value.transportType) ?? "sse";
		if (resolvedType !== "sse" && resolvedType !== "streamableHttp") {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					'Expected type "sse" or "streamableHttp" for URL-based MCP server',
				path: ["type"],
			});
		}
	})
	.transform((value) => {
		const resolvedType =
			value.type ?? mapLegacyTransportType(value.transportType) ?? "sse";
		if (resolvedType === "streamableHttp") {
			return {
				transport: {
					type: "streamableHttp" as const,
					url: value.url,
					headers: value.headers,
				},
				disabled: value.disabled,
				metadata: value.metadata,
				oauth: value.oauth,
			};
		}
		return {
			transport: {
				type: "sse" as const,
				url: value.url,
				headers: value.headers,
			},
			disabled: value.disabled,
			metadata: value.metadata,
			oauth: value.oauth,
		};
	});

const mcpRegistrationBodySchema = z.union([
	nestedRegistrationBodySchema,
	legacyStdioRegistrationSchema,
	legacyUrlRegistrationSchema,
]);

const mcpSettingsSchema = z
	.object({
		mcpServers: z.record(z.string(), mcpRegistrationBodySchema),
	})
	.passthrough();

export interface McpSettingsFile {
	mcpServers: Record<string, Omit<McpServerRegistration, "name">>;
}

export interface LoadMcpSettingsOptions {
	filePath?: string;
	env?: Record<string, string | undefined>;
	userHome?: string;
	workspaceRoot?: string;
}

export interface ResolveMcpSettingsPathsOptions extends LoadMcpSettingsOptions {
	filePaths?: string[];
	includeCursorMcp?: boolean;
	includeGlobalCursorMcp?: boolean;
}

export type RegisterMcpServersFromSettingsOptions =
	ResolveMcpSettingsPathsOptions;

export interface McpServerRegistrationSource {
	filePath: string;
	registrations: McpServerRegistration[];
}

export interface SetMcpServerDisabledOptions {
	filePath?: string;
	name: string;
	disabled: boolean;
}

export function resolveDefaultMcpSettingsPath(): string {
	return resolveMcpSettingsPath();
}

export function resolveCursorMcpSettingsPath(workspaceRoot: string): string {
	const root = workspaceRoot.trim();
	if (!root) {
		throw new Error("Workspace root is required to resolve .cursor/mcp.json.");
	}
	return join(root, CURSOR_MCP_SETTINGS_RELATIVE_PATH);
}

export function resolveGlobalCursorMcpSettingsPath(userHome?: string): string {
	const home = userHome?.trim() || homedir();
	return join(home, CURSOR_MCP_SETTINGS_RELATIVE_PATH);
}

function dedupeSettingsPaths(paths: ReadonlyArray<string | undefined>): string[] {
	const seen = new Set<string>();
	const deduped: string[] = [];
	for (const candidate of paths) {
		const trimmed = candidate?.trim();
		if (!trimmed || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		deduped.push(trimmed);
	}
	return deduped;
}

export function resolveMcpSettingsPaths(
	options: ResolveMcpSettingsPathsOptions = {},
): string[] {
	if (options.filePaths?.length) {
		return dedupeSettingsPaths(options.filePaths);
	}
	if (options.filePath) {
		return dedupeSettingsPaths([options.filePath]);
	}

	const paths = [resolveDefaultMcpSettingsPath()];
	const workspaceRoot = options.workspaceRoot?.trim();
	if (workspaceRoot && options.includeCursorMcp !== false) {
		paths.push(resolveCursorMcpSettingsPath(workspaceRoot));
	}
	if (
		options.includeCursorMcp !== false &&
		options.includeGlobalCursorMcp !== false
	) {
		paths.push(resolveGlobalCursorMcpSettingsPath(options.userHome));
	}
	return dedupeSettingsPaths(paths);
}

function readJsonObject(filePath: string): Record<string, unknown> {
	const raw = readFileSync(filePath, "utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		const details = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Failed to parse MCP settings JSON at "${filePath}": ${details}`,
		);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Invalid MCP settings at "${filePath}": expected object.`);
	}
	return parsed as Record<string, unknown>;
}

function inferCursorMcpWorkspaceRoot(filePath: string): string | undefined {
	const normalizedPath = normalize(filePath);
	if (!normalizedPath.endsWith(CURSOR_MCP_SETTINGS_RELATIVE_PATH)) {
		return undefined;
	}
	return dirname(dirname(normalizedPath));
}

function getCursorMcpVariableContext(
	filePath: string,
	options: LoadMcpSettingsOptions,
): CursorMcpVariableContext {
	const normalizedPath = normalize(filePath);
	const normalizedGlobalPath = normalize(
		resolveGlobalCursorMcpSettingsPath(options.userHome),
	);
	return {
		env: options.env,
		userHome: options.userHome,
		workspaceRoot:
			options.workspaceRoot?.trim() ||
			(normalizedPath === normalizedGlobalPath
				? undefined
				: inferCursorMcpWorkspaceRoot(filePath)),
	};
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

function setOwnServerRecord(
	servers: Record<string, unknown>,
	name: string,
	value: Record<string, unknown>,
): void {
	Object.defineProperty(servers, name, {
		value,
		enumerable: true,
		configurable: true,
		writable: true,
	});
}

export function loadMcpSettingsFile(
	options: LoadMcpSettingsOptions = {},
): McpSettingsFile {
	const filePath = options.filePath ?? resolveDefaultMcpSettingsPath();
	const raw = readFileSync(filePath, "utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		const details = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Failed to parse MCP settings JSON at "${filePath}": ${details}`,
		);
	}
	const result = mcpSettingsSchema.safeParse(
		normalizeCursorMcpSettingsObject(
			parsed,
			getCursorMcpVariableContext(filePath, options),
		),
	);
	if (!result.success) {
		const details = result.error.issues
			.map((issue) => {
				const path = issue.path.join(".");
				return path ? `${path}: ${issue.message}` : issue.message;
			})
			.join("; ");
		throw new Error(`Invalid MCP settings at "${filePath}": ${details}`);
	}
	return result.data;
}

function loadRawMcpSettingsFile(filePath: string): Record<string, unknown> {
	const raw = readFileSync(filePath, "utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		const details = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Failed to parse MCP settings JSON at "${filePath}": ${details}`,
		);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Invalid MCP settings at "${filePath}": expected object`);
	}
	const settings = parsed as Record<string, unknown>;
	const servers = settings.mcpServers;
	if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
		throw new Error(
			`Invalid MCP settings at "${filePath}": mcpServers must be an object`,
		);
	}
	return settings;
}

export function normalizeMcpServerOAuthState(
	value: McpServerOAuthState | undefined,
): McpServerOAuthState | undefined {
	if (!value) {
		return undefined;
	}
	const normalized: McpServerOAuthState = {
		...(value.clientInformation
			? { clientInformation: value.clientInformation }
			: {}),
		...(value.tokens ? { tokens: value.tokens } : {}),
		...(value.codeVerifier ? { codeVerifier: value.codeVerifier } : {}),
		...(value.discoveryState ? { discoveryState: value.discoveryState } : {}),
		...(value.redirectUrl ? { redirectUrl: value.redirectUrl } : {}),
		...(value.lastError ? { lastError: value.lastError } : {}),
		...(value.lastAuthenticatedAt
			? { lastAuthenticatedAt: value.lastAuthenticatedAt }
			: {}),
	};
	return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function validateOauthState(value: unknown): McpServerOAuthState | undefined {
	if (value === undefined) {
		return undefined;
	}
	const result = oauthStateSchema.safeParse(value);
	if (!result.success) {
		return undefined;
	}
	return normalizeMcpServerOAuthState(result.data);
}

export function hasMcpSettingsFile(
	options: ResolveMcpSettingsPathsOptions = {},
): boolean {
	return resolveMcpSettingsPaths(options).some((filePath) =>
		existsSync(filePath),
	);
}

function toMcpServerRegistrations(
	config: McpSettingsFile,
): McpServerRegistration[] {
	return Object.entries(config.mcpServers).map(([name, value]) => ({
		name,
		transport: value.transport,
		disabled: value.disabled,
		metadata: value.metadata,
		oauth: value.oauth,
	}));
}

export function resolveMcpServerRegistrations(
	options: LoadMcpSettingsOptions = {},
): McpServerRegistration[] {
	const config = loadMcpSettingsFile(options);
	return toMcpServerRegistrations(config);
}

export function resolveMcpServerRegistrationSources(
	options: ResolveMcpSettingsPathsOptions = {},
): McpServerRegistrationSource[] {
	const explicitPaths = Boolean(options.filePath || options.filePaths?.length);
	const filePaths = resolveMcpSettingsPaths(options).filter(
		(filePath) => explicitPaths || existsSync(filePath),
	);
	const seenServerNames = new Set<string>();
	const sources: McpServerRegistrationSource[] = [];

	for (const filePath of filePaths) {
		const registrations = resolveMcpServerRegistrations({
			filePath,
			env: options.env,
			userHome: options.userHome,
			workspaceRoot: options.workspaceRoot,
		}).filter(
			(registration) => {
				if (seenServerNames.has(registration.name)) {
					return false;
				}
				seenServerNames.add(registration.name);
				return true;
			},
		);
		if (registrations.length > 0) {
			sources.push({ filePath, registrations });
		}
	}

	return sources;
}

export function setMcpServerDisabled(
	options: SetMcpServerDisabledOptions,
): void {
	const filePath = options.filePath ?? resolveDefaultMcpSettingsPath();
	const name = options.name.trim();
	if (!name) {
		throw new Error("MCP server settings toggle requires a server name.");
	}
	const settings = readJsonObject(filePath);
	const serversValue = settings.mcpServers;
	if (
		!serversValue ||
		typeof serversValue !== "object" ||
		Array.isArray(serversValue)
	) {
		throw new Error(
			`Invalid MCP settings at "${filePath}": mcpServers must be an object.`,
		);
	}
	const servers = { ...(serversValue as Record<string, unknown>) };
	const current = getOwnServerRecord(servers, name);
	if (!current) {
		throw new Error(`Unknown MCP server: ${name}`);
	}
	const next = { ...current };
	if (options.disabled) {
		next.disabled = true;
	} else {
		delete next.disabled;
	}
	setOwnServerRecord(servers, name, next);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(
		filePath,
		`${JSON.stringify({ ...settings, mcpServers: servers }, null, 2)}\n`,
	);
}

export function getMcpServerOAuthState(
	serverName: string,
	options: LoadMcpSettingsOptions = {},
): McpServerOAuthState | undefined {
	const config = loadMcpSettingsFile(options);
	if (!Object.hasOwn(config.mcpServers, serverName)) {
		return undefined;
	}
	return normalizeMcpServerOAuthState(config.mcpServers[serverName]?.oauth);
}

export function updateMcpServerOAuthState(
	serverName: string,
	updater: (current: McpServerOAuthState) => McpServerOAuthState,
	options: LoadMcpSettingsOptions = {},
): McpServerOAuthState {
	const filePath = options.filePath ?? resolveDefaultMcpSettingsPath();
	const settings = loadRawMcpSettingsFile(filePath);
	const servers = settings.mcpServers as Record<string, unknown>;
	const server = getOwnServerRecord(servers, serverName);
	if (!server) {
		throw new Error(`Unknown MCP server: ${serverName}`);
	}

	const current = validateOauthState(server.oauth) ?? {};
	const updated = normalizeMcpServerOAuthState(updater(current));
	if (updated) {
		server.oauth = updated;
	} else {
		delete server.oauth;
	}

	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
	return updated ?? {};
}

export function listMcpServerOAuthStatuses(
	options: LoadMcpSettingsOptions = {},
): McpServerOAuthStatus[] {
	const registrations = resolveMcpServerRegistrations(options);
	return registrations
		.map((registration) => {
			const oauthSupported = registration.transport.type !== "stdio";
			const accessToken = registration.oauth?.tokens?.access_token;
			return {
				serverName: registration.name,
				oauthSupported,
				oauthConfigured:
					oauthSupported &&
					typeof accessToken === "string" &&
					accessToken.trim().length > 0,
				lastError: registration.oauth?.lastError,
				lastAuthenticatedAt: registration.oauth?.lastAuthenticatedAt,
			};
		})
		.sort((left, right) => left.serverName.localeCompare(right.serverName));
}

export async function registerMcpServersFromSettingsFile(
	manager: Pick<McpManager, "registerServer">,
	options: RegisterMcpServersFromSettingsOptions = {},
): Promise<McpServerRegistration[]> {
	const registrations = resolveMcpServerRegistrationSources(options).flatMap(
		(source) => source.registrations,
	);
	for (const registration of registrations) {
		await manager.registerServer(registration);
	}
	return registrations;
}
