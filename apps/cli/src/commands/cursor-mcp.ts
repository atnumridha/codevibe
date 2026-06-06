import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
	buildCursorAutomationIngestRouteRequest,
	buildCursorAgentTaskRouteRequest,
	buildCursorGlassRouteMetadata,
	buildCursorPluginAddRouteRequest,
	buildCursorRuleRouteRequest,
	buildCursorSettingsRouteRequest,
	buildCursorMcpInstallRequest,
	getCursorCompatibleUriPath,
	ClineCore,
	DefaultToolNames,
	formatCursorMcpInstallDetail,
	HubSessionClient,
	installPlugin,
	loadMcpSettingsFile,
	resolveCursorMcpSettingsPath,
	resolveGlobalCursorMcpSettingsPath,
	resolveCursorCommandFileRouteRequest,
	type ClineAutomationNdjsonIngestOptions,
	type ClineAutomationNdjsonIngressResult,
	type ClineCoreAutomationApi,
	type CursorAutomationEventSummary,
	type CursorAutomationIngestRouteRequest,
	type CursorAutomationRejectedLineSummary,
} from "@cline/core";
import type {
	ChatRunTurnRequest,
	ChatStartSessionRequest,
} from "@cline/shared";
import { resolveGlobalSettingsPath } from "@cline/shared/storage";
import {
	addServerRecords,
	addServerRecord,
	getSettingsPath,
	loadServers,
} from "../wizards/mcp/settings";
import { ensureCliHubServer } from "../utils/hub-runtime";
import type { CreateTaskWorktreeResult } from "../utils/worktree";

const BACKGROUND_AGENT_DISPATCH_ACK_TIMEOUT_MS = 5_000;

export type BackgroundAgentHubResolution = {
	url: string;
	authToken: string;
};

export type AutomationIngestCoreFactoryOptions = {
	workspaceRoot: string;
	cwd: string;
};

export type AutomationIngestCore = {
	automation: Pick<ClineCoreAutomationApi, "ingestNdjson">;
	dispose?: (reason?: string) => Promise<void>;
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
	worktree?: boolean;
	createBackgroundAgentWorktree?: (options: {
		cwd: string;
	}) => Promise<CreateTaskWorktreeResult>;
	createAutomationIngestCore?: (
		options: AutomationIngestCoreFactoryOptions,
	) => Promise<AutomationIngestCore>;
	cursorMcpSource?: "workspace" | "global";
	cursorMcpHome?: string;
	io: {
		writeln: (text?: string) => void;
		writeErr: (text: string) => void;
	};
}

interface AutomationIngestReport {
	handled: true;
	route: "automation-ingest";
	ingested: boolean;
	requiresConfirmation?: boolean;
	strict: boolean;
	strictFailed?: boolean;
	valid: boolean;
	eventCount: number;
	rejectedCount: number;
	resultCount?: number;
	duplicateCount?: number;
	queuedRunCount?: number;
	defaultSource?: string;
	allowedSources?: string[];
	maxLineBytes?: number;
	maxEvents?: number;
	paramKeys: string[];
	configKeys: string[];
	events: CursorAutomationEventSummary[];
	rejected: CursorAutomationRejectedLineSummary[];
}

interface CursorMcpImportReport {
	handled: true;
	route: "cursor-mcp-import";
	confirmed: boolean;
	imported: boolean;
	requiresConfirmation?: boolean;
	sourcePath: string;
	settingsPath: string;
	serverNames: string[];
	importedCount: number;
	replacedNames: string[];
}

type CursorAgentTaskRouteResolution = {
	route: string;
	taskPrompt: string;
	commandFile?: {
		commandName: string;
		filename: string;
		relativePath: string;
	};
};

type BackgroundAgentWorktreeReport = {
	created: true;
	sourceWorkspaceRoot: string;
	path: string;
	taskId?: string;
	repoRoot?: string;
};

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

function writeCursorMcpImportError(
	options: CursorMcpInstallCommandOptions,
	message: string,
): number {
	if (options.json) {
		options.io.writeln(
			JSON.stringify({
				handled: false,
				route: "cursor-mcp-import",
				imported: false,
				error: message,
			}),
		);
	} else {
		options.io.writeErr(message);
	}
	return 1;
}

function writeCursorMcpImportReport(
	options: CursorMcpInstallCommandOptions,
	report: CursorMcpImportReport,
): number {
	if (options.json) {
		options.io.writeln(JSON.stringify(report));
	} else if (report.imported) {
		options.io.writeln(
			`Imported ${report.importedCount} Cursor MCP server(s) from .cursor/mcp.json.`,
		);
		options.io.writeln(`Settings file: ${report.settingsPath}`);
		if (report.replacedNames.length > 0) {
			options.io.writeln(`Replaced: ${report.replacedNames.join(", ")}`);
		}
	} else {
		options.io.writeln(
			`Found ${report.serverNames.length} Cursor MCP server(s) in ${report.sourcePath}.`,
		);
		options.io.writeln(`Settings file: ${report.settingsPath}`);
		options.io.writeln("Re-run with --yes to import these MCP servers.");
	}
	return 0;
}

function getCursorQueuedAgentToolPolicies(): NonNullable<
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

function toAutomationIngestOptions(
	request: CursorAutomationIngestRouteRequest,
): ClineAutomationNdjsonIngestOptions {
	return {
		...(request.options.defaultSource
			? { defaultSource: request.options.defaultSource }
			: {}),
		...(request.options.allowedSources
			? { allowedSources: request.options.allowedSources }
			: {}),
		...(request.options.maxLineBytes !== undefined
			? { maxLineBytes: request.options.maxLineBytes }
			: {}),
		...(request.options.maxEvents !== undefined
			? { maxEvents: request.options.maxEvents }
			: {}),
	};
}

function buildAutomationIngestReport(
	request: CursorAutomationIngestRouteRequest,
	ingested: boolean,
	result?: ClineAutomationNdjsonIngressResult,
): AutomationIngestReport {
	const strictFailed = request.strict && request.validation.rejectedCount > 0;
	const valid = request.validation.eventCount > 0 && !strictFailed;
	const results = result?.results;
	return {
		handled: true,
		route: "automation-ingest",
		ingested,
		...(ingested ? {} : { requiresConfirmation: valid }),
		strict: request.strict,
		...(strictFailed ? { strictFailed: true } : {}),
		valid,
		eventCount: request.validation.eventCount,
		rejectedCount: request.validation.rejectedCount,
		...(results ? { resultCount: results.length } : {}),
		...(results
			? {
					duplicateCount: results.filter((item) => item.duplicate).length,
					queuedRunCount: results.reduce(
						(count, item) => count + item.queuedRuns.length,
						0,
					),
				}
			: {}),
		...(request.options.defaultSource
			? { defaultSource: request.options.defaultSource }
			: {}),
		...(request.options.allowedSources
			? { allowedSources: request.options.allowedSources }
			: {}),
		...(request.options.maxLineBytes !== undefined
			? { maxLineBytes: request.options.maxLineBytes }
			: {}),
		...(request.options.maxEvents !== undefined
			? { maxEvents: request.options.maxEvents }
			: {}),
		paramKeys: request.paramKeys,
		configKeys: request.configKeys,
		events: request.validation.events,
		rejected: request.validation.rejected,
	};
}

function writeAutomationIngestTextReport(
	options: CursorMcpInstallCommandOptions,
	report: AutomationIngestReport,
): void {
	options.io.writeln(
		`${report.ingested ? "Ingested" : "Validated"} ${report.eventCount} Cursor automation event(s).`,
	);
	if (report.rejectedCount > 0) {
		options.io.writeln(`${report.rejectedCount} line(s) rejected:`);
		for (const rejected of report.rejected) {
			options.io.writeln(
				`- line ${rejected.lineNumber}: ${rejected.reason} - ${rejected.message}`,
			);
		}
	}
	if (report.strictFailed) {
		options.io.writeln("Strict mode blocked ingest because one or more lines were rejected.");
	}
	if (!report.ingested && report.valid) {
		options.io.writeln("Re-run with --yes to ingest these automation events.");
	}
	if (report.ingested) {
		options.io.writeln(`Queued runs: ${report.queuedRunCount ?? 0}`);
	}
}

function writeAutomationIngestReport(
	options: CursorMcpInstallCommandOptions,
	report: AutomationIngestReport,
): number {
	if (options.json) {
		options.io.writeln(JSON.stringify(report));
	} else {
		writeAutomationIngestTextReport(options, report);
	}
	return report.valid ? 0 : 1;
}

async function createDefaultAutomationIngestCore(
	options: AutomationIngestCoreFactoryOptions,
): Promise<AutomationIngestCore> {
	return ClineCore.create({
		clientName: "cline-cli-cursor-automation-ingest",
		backendMode: "local",
		automation: {
			workspaceRoot: options.workspaceRoot,
		},
	});
}

async function runCursorAutomationIngestRoute(
	options: CursorMcpInstallCommandOptions,
): Promise<number> {
	const request = buildCursorAutomationIngestRouteRequest(options.uri);
	const preview = buildAutomationIngestReport(request, false);
	if (!options.confirmed || !preview.valid) {
		return writeAutomationIngestReport(options, preview);
	}

	const cwd = resolve(options.cwd ?? process.cwd());
	const workspaceRoot = cwd;
	const createCore =
		options.createAutomationIngestCore ?? createDefaultAutomationIngestCore;
	const core = await createCore({ workspaceRoot, cwd });
	try {
		const result = core.automation.ingestNdjson(
			request.ndjson,
			toAutomationIngestOptions(request),
		);
		return writeAutomationIngestReport(
			options,
			buildAutomationIngestReport(request, true, result),
		);
	} finally {
		await core.dispose?.("cursor_automation_ingest_done");
	}
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
					...(request.sourceConfigKey ? { sourceConfigKey: request.sourceConfigKey } : {}),
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

function resolveAgentTaskRoute(
	request: ReturnType<typeof buildCursorAgentTaskRouteRequest>,
	workspaceRoot: string,
): CursorAgentTaskRouteResolution {
	const commandFileRequest = resolveCursorCommandFileRouteRequest(request, {
		workspaceRoot,
	});
	return {
		route: commandFileRequest?.kind ?? request.kind,
		taskPrompt: commandFileRequest?.taskPrompt ?? request.taskPrompt,
		...(commandFileRequest
			? {
					commandFile: {
						commandName: commandFileRequest.commandName,
						filename: commandFileRequest.filename,
						relativePath: commandFileRequest.relativePath,
					},
				}
			: {}),
	};
}

async function createDefaultBackgroundAgentWorktree(options: {
	cwd: string;
}): Promise<CreateTaskWorktreeResult> {
	const { createTaskWorktree } = await import("../utils/worktree");
	return createTaskWorktree(options);
}

function buildBackgroundAgentWorktreeTaskPrompt(
	taskPrompt: string,
	worktree: BackgroundAgentWorktreeReport,
): string {
	return [
		"CLI prepared an isolated worktree for this Cursor background-agent deeplink.",
		"",
		"Prepared worktree:",
		`- source workspace: ${worktree.sourceWorkspaceRoot}`,
		`- path: ${worktree.path}`,
		...(worktree.repoRoot ? [`- repository root: ${worktree.repoRoot}`] : []),
		...(worktree.taskId ? [`- task id: ${worktree.taskId}`] : []),
		"",
		"Use this worktree for any confirmed file or git changes. The deeplink still does not grant permission to mutate files, run commands, install packages, open network connections, or use MCP tools without the normal approvals.",
		"",
		taskPrompt,
	].join("\n");
}

function writeAgentTaskRoutePreview(
	options: CursorMcpInstallCommandOptions,
	request = buildCursorAgentTaskRouteRequest(options.uri),
): number {
	const workspaceRoot = resolve(options.cwd ?? process.cwd());
	const resolved = resolveAgentTaskRoute(request, workspaceRoot);
	const glass = buildCursorGlassRouteMetadata(request);
	if (options.json) {
		options.io.writeln(
			JSON.stringify({
				handled: true,
				route: resolved.route,
				path: request.path,
				requiresAgent: true,
				prompt: request.prompt,
				taskPrompt: resolved.taskPrompt,
				paramKeys: Object.keys(request.params).sort(),
				...(glass ? { glass } : {}),
				...(request.kind === "background-agent" && options.worktree
					? { worktree: { requested: true, created: false } }
					: {}),
				...(resolved.commandFile
					? { commandFile: resolved.commandFile }
					: {}),
			}),
		);
		return 0;
	}

	options.io.writeln(
		resolved.commandFile
			? `Cursor command file "${resolved.commandFile.relativePath}" requires an agent task.`
			: `Cursor ${request.kind} deeplink requires an agent task.`,
	);
	options.io.writeln("");
	options.io.writeln(resolved.taskPrompt);
	if (request.kind === "background-agent" && options.worktree) {
		options.io.writeln("");
		options.io.writeln(
			"Worktree requested; re-run with --yes --worktree to create it before queuing the background session.",
		);
	}
	return 0;
}

async function launchCursorAgentTask(
	options: CursorMcpInstallCommandOptions,
): Promise<number> {
	const request = buildCursorAgentTaskRouteRequest(options.uri);

	if (!options.confirmed) {
		return writeAgentTaskRoutePreview(options, request);
	}

	const sourceWorkspaceRoot = resolve(options.cwd ?? process.cwd());
	let cwd = sourceWorkspaceRoot;
	let workspaceRoot = sourceWorkspaceRoot;
	let worktree: BackgroundAgentWorktreeReport | undefined;
	if (request.kind === "background-agent" && options.worktree) {
		const createWorktree =
			options.createBackgroundAgentWorktree ??
			createDefaultBackgroundAgentWorktree;
		const result = await createWorktree({ cwd: sourceWorkspaceRoot });
		if (!result.success || !result.path) {
			return writeUriError(
				options,
				`Failed to prepare Cursor background-agent worktree: ${result.message}`,
			);
		}
		workspaceRoot = resolve(result.path);
		cwd = workspaceRoot;
		worktree = {
			created: true,
			sourceWorkspaceRoot,
			path: workspaceRoot,
			...(result.taskId ? { taskId: result.taskId } : {}),
			...(result.repoRoot ? { repoRoot: result.repoRoot } : {}),
		};
	}
	const resolved = resolveAgentTaskRoute(request, workspaceRoot);
	const glass = buildCursorGlassRouteMetadata(request);
	const taskPrompt = worktree
		? buildBackgroundAgentWorktreeTaskPrompt(resolved.taskPrompt, worktree)
		: resolved.taskPrompt;
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
				clientType:
					request.kind === "background-agent"
						? "cli-cursor-background-agent"
						: "cli-cursor-agent-task",
				displayName:
					request.kind === "background-agent"
						? "Cline CLI (Cursor background agent)"
						: "Cline CLI (Cursor agent task)",
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
		toolPolicies: getCursorQueuedAgentToolPolicies(),
		source:
			request.kind === "background-agent"
				? "cline-cli-cursor-background-agent"
				: "cline-cli-cursor-agent-task",
		interactive: false,
	};

	try {
		await client.connect?.();
		const started = await client.startRuntimeSession(startRequest);
		await client.sendRuntimeSession(
			started.sessionId,
			{
				config: startRequest,
				prompt: taskPrompt,
				delivery: "queue",
			},
			{ timeoutMs: BACKGROUND_AGENT_DISPATCH_ACK_TIMEOUT_MS },
		);

		if (options.json) {
			options.io.writeln(
				JSON.stringify({
					handled: true,
					route: resolved.route,
					path: request.path,
					started: true,
					sessionId: started.sessionId,
					workspaceRoot,
					cwd,
					provider: providerId,
					model: modelId,
					delivery: "queue",
					paramKeys: Object.keys(request.params).sort(),
					...(glass ? { glass } : {}),
					...(worktree ? { worktree } : {}),
					...(resolved.commandFile
						? { commandFile: resolved.commandFile }
						: {}),
				}),
			);
		} else {
			options.io.writeln(
				`Started Cursor ${resolved.route} agent session ${started.sessionId}`,
			);
			options.io.writeln(`Workspace: ${workspaceRoot}`);
			if (worktree) {
				options.io.writeln(`Worktree: ${worktree.path}`);
			}
		}
		return 0;
	} finally {
		await client.dispose?.();
		client.close?.();
	}
}

export function runCursorMcpImportCommand(
	options: CursorMcpInstallCommandOptions,
): number {
	try {
		const sourceKind = options.cursorMcpSource ?? "workspace";
		const workspaceRoot = resolve(options.cwd ?? process.cwd());
		const sourcePath =
			sourceKind === "global"
				? resolveGlobalCursorMcpSettingsPath(options.cursorMcpHome)
				: resolveCursorMcpSettingsPath(workspaceRoot);
		if (!existsSync(sourcePath)) {
			throw new Error(
				sourceKind === "global"
					? "No global ~/.cursor/mcp.json found"
					: "No .cursor/mcp.json found in the active workspace",
			);
		}

		const cursorSettings = loadMcpSettingsFile({
			filePath: sourcePath,
			...(sourceKind === "global" && options.cursorMcpHome
				? { userHome: options.cursorMcpHome }
				: {}),
			...(sourceKind === "workspace" ? { workspaceRoot } : {}),
		});
		const serverNames = Object.keys(cursorSettings.mcpServers).sort();
		if (serverNames.length === 0) {
			throw new Error(".cursor/mcp.json does not contain any MCP servers");
		}

		const settingsPath = getSettingsPath();
		const existingNames = new Set(loadServers().map((server) => server.name));
		const replacedNames = serverNames
			.filter((name) => existingNames.has(name))
			.sort();
		const preview: CursorMcpImportReport = {
			handled: true,
			route: "cursor-mcp-import",
			confirmed: options.confirmed === true,
			imported: false,
			requiresConfirmation: true,
			sourcePath,
			settingsPath,
			serverNames,
			importedCount: 0,
			replacedNames,
		};

		if (!options.confirmed) {
			return writeCursorMcpImportReport(options, preview);
		}

		const importedAt = new Date().toISOString();
		const records: Record<string, Record<string, unknown>> = {};
		for (const name of serverNames) {
			const registration = cursorSettings.mcpServers[name];
			if (!registration) {
				continue;
			}
			const metadata =
				registration.metadata &&
				typeof registration.metadata === "object" &&
				!Array.isArray(registration.metadata)
					? registration.metadata
					: {};
			records[name] = {
				...registration,
				metadata: {
					...metadata,
					cursor: {
						source:
							sourceKind === "global" ? "global-cursor-mcp" : "workspace-mcp",
						path:
							sourceKind === "global" ? "~/.cursor/mcp.json" : ".cursor/mcp.json",
						importedAt,
					},
				},
			};
		}
		addServerRecords(records);
		const imported: CursorMcpImportReport = {
			handled: true,
			route: "cursor-mcp-import",
			confirmed: true,
			imported: true,
			sourcePath,
			settingsPath,
			serverNames,
			importedCount: serverNames.length,
			replacedNames,
		};
		return writeCursorMcpImportReport(options, imported);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return writeCursorMcpImportError(options, message);
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
		path = getCursorCompatibleUriPath(options.uri);
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
	if (path === "/automation/ingest") {
		try {
			return await runCursorAutomationIngestRoute(options);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return writeUriError(options, message);
		}
	}

	try {
		return await launchCursorAgentTask(options);
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
