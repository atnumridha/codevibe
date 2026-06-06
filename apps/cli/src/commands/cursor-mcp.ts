import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
	buildCursorAgentTaskRouteRequest,
	buildCursorPluginAddRouteRequest,
	buildCursorRuleRouteRequest,
	buildCursorSettingsRouteRequest,
	buildCursorMcpInstallRequest,
	DefaultToolNames,
	formatCursorMcpInstallDetail,
	HubSessionClient,
	resolveCursorCommandFileRouteRequest,
} from "@cline/core";
import type {
	ChatRunTurnRequest,
	ChatStartSessionRequest,
} from "@cline/shared";
import { resolveGlobalSettingsPath } from "@cline/shared/storage";
import {
	addServerRecord,
	getSettingsPath,
	loadServers,
} from "../wizards/mcp/settings";
import { ensureCliHubServer } from "../utils/hub-runtime";
import { installPlugin } from "./plugin";

const BACKGROUND_AGENT_DISPATCH_ACK_TIMEOUT_MS = 5_000;

export type BackgroundAgentHubResolution = {
	url: string;
	authToken: string;
};

export type BackgroundAgentSessionClient = {
	connect?: () => Promise<void>;
	startRuntimeSession: (
		request: ChatStartSessionRequest,
	) => Promise<{ sessionId: string }>;
	sendRuntimeSession: (
		sessionId: string,
		request: ChatRunTurnRequest,
		options?: { timeoutMs?: number | null },
	) => Promise<unknown>;
	dispose?: () => Promise<void>;
	close?: () => void;
};

export type BackgroundAgentSessionClientFactoryOptions = {
	address: string;
	authToken: string;
	workspaceRoot: string;
	cwd: string;
};

export interface CursorMcpInstallCommandOptions {
	uri: string;
	confirmed?: boolean;
	json?: boolean;
	cwd?: string;
	providerId?: string;
	modelId?: string;
	apiKey?: string;
	ensureBackgroundAgentHub?: (
		workspaceRoot: string,
	) => Promise<BackgroundAgentHubResolution>;
	createBackgroundAgentSessionClient?: (
		options: BackgroundAgentSessionClientFactoryOptions,
	) => BackgroundAgentSessionClient;
	io: {
		writeln: (text?: string) => void;
		writeErr: (text: string) => void;
	};
}

function writeCommandError(
	options: CursorMcpInstallCommandOptions,
	message: string,
): number {
	if (options.json) {
		options.io.writeln(JSON.stringify({ installed: false, error: message }));
	} else {
		options.io.writeErr(message);
	}
	return 1;
}

function getBackgroundAgentToolPolicies(): NonNullable<
	ChatStartSessionRequest["toolPolicies"]
> {
	return {
		"*": { enabled: false, autoApprove: false },
		[DefaultToolNames.READ_FILES]: { enabled: true, autoApprove: true },
		[DefaultToolNames.SEARCH_CODEBASE]: { enabled: true, autoApprove: true },
	};
}

function writeUriError(
	options: CursorMcpInstallCommandOptions,
	message: string,
): number {
	if (options.json) {
		options.io.writeln(JSON.stringify({ handled: false, error: message }));
	} else {
		options.io.writeErr(message);
	}
	return 1;
}

function writeSettingsRoute(options: CursorMcpInstallCommandOptions): number {
	const request = buildCursorSettingsRouteRequest(options.uri);
	const settingsPath = resolveGlobalSettingsPath();
	if (options.json) {
		options.io.writeln(
			JSON.stringify({
				handled: true,
				route: "settings",
				settingsPath,
				query: request.query,
				sourceParam: request.sourceParam,
			}),
		);
		return 0;
	}

	options.io.writeln(`Settings file: ${settingsPath}`);
	if (request.query) {
		options.io.writeln(`Requested settings query: ${request.query}`);
	}
	return 0;
}

function writeCursorRuleRoute(options: CursorMcpInstallCommandOptions): number {
	const request = buildCursorRuleRouteRequest(options.uri);
	if (request.kind === "review") {
		if (options.json) {
			options.io.writeln(
				JSON.stringify({
					handled: true,
					route: "rule",
					requiresReview: true,
					reason: request.reason,
					name: request.name,
					path: request.path,
				}),
			);
		} else {
			options.io.writeln(request.reason);
			options.io.writeln("Start an agent task with this deeplink before writing rule content.");
		}
		return 0;
	}

	const cwd = resolve(options.cwd ?? process.cwd());
	const filePath = resolve(cwd, request.relativePath);
	const relativePath = relative(cwd, filePath);
	if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
		throw new Error("Cursor rule path must stay inside the workspace");
	}

	if (!options.confirmed) {
		if (options.json) {
			options.io.writeln(
				JSON.stringify({
					handled: true,
					route: "rule",
					created: false,
					requiresConfirmation: true,
					filename: request.filename,
					filePath,
				}),
			);
		} else {
			options.io.writeln(`Cursor rule: ${request.filename}`);
			options.io.writeln(`File: ${filePath}`);
			options.io.writeln("Re-run with --yes to create or reuse this rule file.");
		}
		return 0;
	}

	mkdirSync(dirname(filePath), { recursive: true });
	let created = true;
	try {
		writeFileSync(filePath, "", { flag: "wx" });
	} catch (error) {
		const code =
			error && typeof error === "object" && "code" in error
				? (error as { code?: unknown }).code
				: undefined;
		if (code !== "EEXIST") {
			throw error;
		}
		created = false;
	}

	if (options.json) {
		options.io.writeln(
			JSON.stringify({
				handled: true,
				route: "rule",
				created,
				filename: request.filename,
				filePath,
			}),
		);
	} else {
		options.io.writeln(
			`${created ? "Created" : "Reused"} Cursor rule "${request.filename}" at ${filePath}`,
		);
	}
	return 0;
}

async function writeCursorPluginAddRoute(
	options: CursorMcpInstallCommandOptions,
): Promise<number> {
	const request = buildCursorPluginAddRouteRequest(options.uri);
	if (!request.source || request.requiresReview) {
		if (options.json) {
			options.io.writeln(
				JSON.stringify({
					handled: true,
					route: "plugin-add",
					requiresReview: true,
					reason: request.reason,
					detail: request.detail,
					paramKeys: Object.keys(request.params).sort(),
				}),
			);
		} else {
			options.io.writeln(request.detail);
			options.io.writeln("Review this Cursor plugin deeplink before installing.");
		}
		return 0;
	}

	if (!options.confirmed) {
		if (options.json) {
			options.io.writeln(
				JSON.stringify({
					handled: true,
					route: "plugin-add",
					installed: false,
					requiresConfirmation: true,
					source: request.source,
					sourceParam: request.sourceParam,
					detail: request.detail,
				}),
			);
		} else {
			options.io.writeln(request.detail);
			options.io.writeln("");
			options.io.writeln("Re-run with --yes to install this plugin.");
		}
		return 0;
	}

	const result = await installPlugin({
		source: request.source,
		cwd: options.cwd,
		io: options.io,
	});
	if (options.json) {
		options.io.writeln(
			JSON.stringify({
				handled: true,
				route: "plugin-add",
				installed: true,
				source: result.source,
				installPath: result.installPath,
				entryPaths: result.entryPaths,
			}),
		);
	} else {
		options.io.writeln(`Installed plugin from ${result.source}`);
		options.io.writeln(`  Path: ${result.installPath}`);
	}
	return 0;
}

function writeAgentTaskRoutePreview(
	options: CursorMcpInstallCommandOptions,
	request = buildCursorAgentTaskRouteRequest(options.uri),
): number {
	const commandFileRequest = resolveCursorCommandFileRouteRequest(request, {
		workspaceRoot: resolve(options.cwd ?? process.cwd()),
	});
	const taskPrompt = commandFileRequest?.taskPrompt ?? request.taskPrompt;
	if (options.json) {
		options.io.writeln(
			JSON.stringify({
				handled: true,
				route: commandFileRequest?.kind ?? request.kind,
				path: request.path,
				requiresAgent: true,
				prompt: request.prompt,
				taskPrompt,
				paramKeys: Object.keys(request.params).sort(),
				commandFile: commandFileRequest
					? {
							commandName: commandFileRequest.commandName,
							filename: commandFileRequest.filename,
							relativePath: commandFileRequest.relativePath,
							filePath: commandFileRequest.filePath,
						}
					: undefined,
			}),
		);
		return 0;
	}

	options.io.writeln(
		commandFileRequest
			? `Cursor command file "${commandFileRequest.relativePath}" requires an agent task.`
			: `Cursor ${request.kind} deeplink requires an agent task.`,
	);
	options.io.writeln("");
	options.io.writeln(taskPrompt);
	return 0;
}

async function launchCursorBackgroundAgent(
	options: CursorMcpInstallCommandOptions,
): Promise<number> {
	const request = buildCursorAgentTaskRouteRequest(options.uri);
	if (request.kind !== "background-agent") {
		return writeAgentTaskRoutePreview(options, request);
	}

	if (!options.confirmed) {
		return writeAgentTaskRoutePreview(options, request);
	}

	const cwd = resolve(options.cwd ?? process.cwd());
	const workspaceRoot = cwd;
	const providerId = options.providerId?.trim() || "openai-codex";
	const modelId = options.modelId?.trim() || "gpt-5.5";
	const ensureHub = options.ensureBackgroundAgentHub ?? ensureCliHubServer;
	const hub = await ensureHub(workspaceRoot);
	const createClient =
		options.createBackgroundAgentSessionClient ??
		((clientOptions: BackgroundAgentSessionClientFactoryOptions) =>
			new HubSessionClient({
				address: clientOptions.address,
				authToken: clientOptions.authToken,
				clientType: "cli-cursor-background-agent",
				displayName: "Cline CLI (Cursor background agent)",
				workspaceRoot: clientOptions.workspaceRoot,
				cwd: clientOptions.cwd,
			}));
	const client = createClient({
		address: hub.url,
		authToken: hub.authToken,
		workspaceRoot,
		cwd,
	});

	const startRequest: ChatStartSessionRequest = {
		workspaceRoot,
		cwd,
		provider: providerId,
		model: modelId,
		apiKey: options.apiKey?.trim() || undefined,
		mode: "plan",
		enableTools: true,
		enableSpawn: false,
		enableTeams: false,
		autoApproveTools: false,
		toolPolicies: getBackgroundAgentToolPolicies(),
		source: "cline-cli-cursor-background-agent",
		interactive: false,
	};

	try {
		await client.connect?.();
		const started = await client.startRuntimeSession(startRequest);
		await client.sendRuntimeSession(
			started.sessionId,
			{
				config: startRequest,
				prompt: request.taskPrompt,
				delivery: "queue",
			},
			{ timeoutMs: BACKGROUND_AGENT_DISPATCH_ACK_TIMEOUT_MS },
		);

		if (options.json) {
			options.io.writeln(
				JSON.stringify({
					handled: true,
					route: "background-agent",
					started: true,
					sessionId: started.sessionId,
					workspaceRoot,
					cwd,
					provider: providerId,
					model: modelId,
					delivery: "queue",
					paramKeys: Object.keys(request.params).sort(),
				}),
			);
		} else {
			options.io.writeln(
				`Started Cursor background agent session ${started.sessionId}`,
			);
			options.io.writeln(`Workspace: ${workspaceRoot}`);
		}
		return 0;
	} finally {
		await client.dispose?.();
		client.close?.();
	}
}

export async function runCursorMcpInstallCommand(
	options: CursorMcpInstallCommandOptions,
): Promise<number> {
	try {
		const request = buildCursorMcpInstallRequest(options.uri);
		const detail = formatCursorMcpInstallDetail(request);
		const settingsPath = getSettingsPath();

		if (loadServers().some((server) => server.name === request.serverName)) {
			throw new Error(
				`An MCP server named "${request.serverName}" already exists`,
			);
		}

		if (!options.confirmed) {
			if (options.json) {
				options.io.writeln(
					JSON.stringify({
						installed: false,
						requiresConfirmation: true,
						serverName: request.serverName,
						detail,
						settingsPath,
					}),
				);
			} else {
				options.io.writeln(detail);
				options.io.writeln("");
				options.io.writeln(`Settings file: ${settingsPath}`);
				options.io.writeln("Re-run with --yes to install this MCP server.");
			}
			return 0;
		}

		addServerRecord(request.serverName, request.serverConfig);
		if (options.json) {
			options.io.writeln(
				JSON.stringify({
					installed: true,
					serverName: request.serverName,
					settingsPath,
				}),
			);
		} else {
			options.io.writeln(
				`Installed MCP server "${request.serverName}" in ${settingsPath}`,
			);
		}
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return writeCommandError(options, message);
	}
}

export async function runCursorUriCommand(
	options: CursorMcpInstallCommandOptions,
): Promise<number> {
	let path: string;
	try {
		path = new URL(options.uri).pathname || "/";
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return writeUriError(options, message);
	}

	if (path === "/mcp/install") {
		return runCursorMcpInstallCommand(options);
	}
	if (path === "/settings") {
		try {
			return writeSettingsRoute(options);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return writeUriError(options, message);
		}
	}
	if (path === "/rule") {
		try {
			return writeCursorRuleRoute(options);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return writeUriError(options, message);
		}
	}
	if (path === "/plugin/add") {
		try {
			return await writeCursorPluginAddRoute(options);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return writeUriError(options, message);
		}
	}

	try {
		return await launchCursorBackgroundAgent(options);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!message.startsWith("Unsupported Cursor agent task route:")) {
			return writeUriError(options, message);
		}
	}

	const message = `Unsupported Cursor URI route for CLI: ${path}`;
	if (options.json) {
		options.io.writeln(JSON.stringify({ handled: false, error: message }));
		return 1;
	}
	options.io.writeErr(message);
	return 1;
}
