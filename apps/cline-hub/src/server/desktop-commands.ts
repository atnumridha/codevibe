import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
	addLocalProvider,
	type ClineAccountActionRequest,
	ClineAccountService,
	createWebSearchExecutor,
	ensureCustomProvidersLoaded,
	executeClineAccountAction,
	getLocalProviderModels,
	listLocalProviders,
	loginLocalProvider,
	normalizeOAuthProvider,
	type ProviderCapability,
	type ProviderClient,
	type ProviderProtocol,
	readGlobalSettings,
	readBackgroundAgentTaskRecordsFile,
	resolveBackgroundAgentRecordsPath,
	resolveClineDataDir,
	resolveLocalClineAuthToken,
	saveLocalProviderOAuthCredentials,
	saveLocalProviderSettings,
	setDisabledPlugin,
	setDisabledTools,
	setTelemetryOptOutGlobally,
	toggleDisabledTool,
	writeBackgroundAgentTaskRecordsFile,
} from "@cline/core";
import {
	getClineEnvironmentConfig,
	type CursorUriPreviewRequest,
	type HubMentionFileSearchRequest,
} from "@cline/shared";
import type { WebviewSessionSummary } from "../webview-protocol";
import {
	getHubBrowserAutomationStatus,
	runHubBrowserActionCommand,
	runHubBrowserScreenshotCommand,
	runHubBrowserSnapshotCommand,
} from "./browser-automation";
import {
	connectorChannelsPayload,
	startConnectorChannel,
	stopConnectorChannel,
} from "./connectors";
import { ingestCursorAutomation } from "./cursor-automation";
import { runCursorGitAction } from "./cursor-git";
import { launchCursorUri } from "./cursor-launch";
import { addCursorPlugin } from "./cursor-plugins";
import { openCursorRule } from "./cursor-rules";
import { providerSettingsManager, workspaceRoot } from "./deps";
import {
	authorizeMcpServerOAuthForHub,
	deleteMcpServer,
	ensureMcpSettingsFile,
	importCursorMcpServers,
	installCursorMcpServer,
	readMcpServersResponse,
	setMcpServerDisabled,
	upsertMcpServer,
} from "./mcp";
import { handleRoutineScheduleCommand } from "./schedules";
import {
	isBackgroundAgentSession,
	toBackgroundAgentLifecycleSessionSummary,
	toBackgroundAgentSessionSummary,
	toWebviewSessionSummary,
} from "./session-mapping";
import type { HubContext } from "./state";
import { broadcastHubState } from "./state-payloads";
import type { JsonRecord } from "./types";
import { listUserInstructionConfigs } from "./user-instructions";
import {
	asTrimmedString,
	openExternalUrl,
	readProviderSettingsUpdate,
	toPositiveInt,
} from "./utils";
import { resolveWorkspaceSubpath } from "./workspace-boundary";

const ROUTINE_SCHEDULE_COMMANDS = new Set([
	"list_routine_schedules",
	"create_routine_schedule",
	"update_routine_schedule",
	"pause_routine_schedule",
	"resume_routine_schedule",
	"trigger_routine_schedule",
	"delete_routine_schedule",
]);

export const STANDALONE_DESKTOP_COMMANDS = [
	"list_provider_catalog",
	"list_provider_models",
	"save_provider_settings",
	"add_provider",
	"run_provider_oauth_login",
	"cline_account",
	"browser_automation_status",
	"browser_snapshot",
	"browser_action",
	"browser_screenshot",
	"web_search",
	"cursor_uri_preview",
	"cursor_automation_ingest",
	"cursor_uri_launch",
	"search_workspace_files",
	"get_global_settings",
	"set_telemetry_opt_out",
	"list_connector_channels",
	"start_connector_channel",
	"stop_connector_channel",
	"list_mcp_servers",
	"import_cursor_mcp_servers",
	"cursor_mcp_install",
	"authorize_mcp_server_oauth",
	"authenticate_mcp_server",
	"cursor_rule_open",
	"cursor_plugin_add",
	"cursor_git_action",
	"set_mcp_server_disabled",
	"upsert_mcp_server",
	"delete_mcp_server",
	"ensure_mcp_settings_file",
	"open_mcp_settings_file",
	...ROUTINE_SCHEDULE_COMMANDS,
	"get_process_context",
	"list_cli_sessions",
	"list_discovered_sessions",
	"list_background_agent_sessions",
	"delete_background_agent_record",
	"dismiss_background_agent_session",
	"delete_background_agent_session",
	"open_background_agent_worktree",
	"reveal_background_agent_worktree",
	"read_session_hooks",
	"list_user_instruction_configs",
	"toggle_disabled_plugin_tool",
	"set_tool_disabled",
	"set_plugin_disabled",
] as const;

function readCursorUriPreviewRequest(
	args: Record<string, unknown> | undefined,
): CursorUriPreviewRequest {
	const uri = asTrimmedString(args?.uri);
	if (!uri) {
		throw new Error("cursor_uri_preview requires a non-empty uri");
	}
	const requestedWorkspaceRoot =
		asTrimmedString(args?.workspaceRoot) ?? asTrimmedString(workspaceRoot);
	const workspaceRoots = Array.isArray(args?.workspaceRoots)
		? args.workspaceRoots
				.map((entry) => asTrimmedString(entry))
				.filter((entry): entry is string => Boolean(entry))
		: undefined;
	const maxCommandFileBytes = toPositiveInt(args?.maxCommandFileBytes);
	const maxRuleFileBytes = toPositiveInt(args?.maxRuleFileBytes);
	return {
		uri,
		...(requestedWorkspaceRoot
			? { workspaceRoot: requestedWorkspaceRoot }
			: {}),
		...(workspaceRoots?.length ? { workspaceRoots } : {}),
		...(maxCommandFileBytes ? { maxCommandFileBytes } : {}),
		...(maxRuleFileBytes ? { maxRuleFileBytes } : {}),
	};
}

function readWorkspaceFileSearchRequest(
	args: Record<string, unknown> | undefined,
): HubMentionFileSearchRequest {
	const requestedRoot = resolveWorkspaceSubpath(
		workspaceRoot,
		asTrimmedString(args?.workspaceRoot) ??
			asTrimmedString(args?.cwd),
		"search_workspace_files",
	);
	const query = asTrimmedString(args?.query) ?? "";
	const limit = toPositiveInt(args?.limit);
	const cursorRetrievalIndexingPrivacyGate =
		typeof args?.cursorRetrievalIndexingPrivacyGate === "boolean"
			? args.cursorRetrievalIndexingPrivacyGate
			: undefined;
	return {
		workspaceRoot: requestedRoot,
		query,
		...(limit ? { limit } : {}),
		...(cursorRetrievalIndexingPrivacyGate !== undefined
			? { cursorRetrievalIndexingPrivacyGate }
			: {}),
	};
}

async function runWebSearchCommand(args: Record<string, unknown> | undefined) {
	const query = asTrimmedString(args?.query);
	if (!query) {
		throw new Error("web_search requires a non-empty query");
	}
	const limit = toPositiveInt(args?.limit) ?? 5;
	const executor = createWebSearchExecutor();
	return await executor(query, Math.min(limit, 10), {
		agentId: "hub",
		conversationId: "desktop-command",
		iteration: 1,
		metadata: {
			source: "codie-hub",
			workspaceRoot,
		},
	});
}

function backgroundAgentRecordsPath(): string {
	return resolveBackgroundAgentRecordsPath(resolveClineDataDir());
}

function listBackgroundAgentSessionSummaries(
	ctx: HubContext,
): WebviewSessionSummary[] {
	const bySessionId = new Map<string, WebviewSessionSummary>();
	for (const record of readBackgroundAgentTaskRecordsFile(
		backgroundAgentRecordsPath(),
	)) {
		const summary = toBackgroundAgentLifecycleSessionSummary(record);
		bySessionId.set(summary.sessionId, summary);
	}
	for (const summary of [...ctx.sessions.values()]
		.filter(isBackgroundAgentSession)
		.map(toBackgroundAgentSessionSummary)) {
		bySessionId.set(summary.sessionId, summary);
	}
	return [...bySessionId.values()].sort(
		(a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
	);
}

function deleteBackgroundAgentLifecycleRecord(
	ctx: HubContext,
	args?: Record<string, unknown>,
): WebviewSessionSummary[] {
	const requestedId =
		asTrimmedString(args?.id) ??
		asTrimmedString(args?.sessionId) ??
		asTrimmedString(args?.taskId);
	if (!requestedId) {
		throw new Error("background agent record id is required");
	}
	const recordsPath = backgroundAgentRecordsPath();
	const records = readBackgroundAgentTaskRecordsFile(recordsPath);
	const nextRecords = records.filter(
		(record) => record.id !== requestedId && record.taskId !== requestedId,
	);
	if (nextRecords.length === records.length) {
		throw new Error(`unknown background agent record: ${requestedId}`);
	}
	writeBackgroundAgentTaskRecordsFile(recordsPath, nextRecords);
	ctx.pushEvent("Background agent dismissed", requestedId, "success");
	broadcastHubState(ctx);
	return listBackgroundAgentSessionSummaries(ctx);
}

function backgroundAgentWorktreeResult(
	ctx: HubContext,
	args?: Record<string, unknown>,
): JsonRecord {
	const requestedId =
		asTrimmedString(args?.id) ??
		asTrimmedString(args?.sessionId) ??
		asTrimmedString(args?.taskId);
	if (!requestedId) {
		throw new Error("background agent record id is required");
	}
	const summary = listBackgroundAgentSessionSummaries(ctx).find((session) => {
		const details =
			session.backgroundAgentDetails &&
			typeof session.backgroundAgentDetails === "object"
				? session.backgroundAgentDetails
				: {};
		return (
			session.sessionId === requestedId ||
			asTrimmedString(details.id) === requestedId ||
			asTrimmedString(details.taskId) === requestedId
		);
	});
	if (!summary) {
		throw new Error(`unknown background agent record: ${requestedId}`);
	}
	const details =
		summary.backgroundAgentDetails &&
		typeof summary.backgroundAgentDetails === "object"
			? summary.backgroundAgentDetails
			: {};
	const recordId = asTrimmedString(details.id) ?? summary.sessionId;
	const worktreePath = asTrimmedString(details.worktreePath);
	if (!worktreePath) {
		throw new Error(
			`background agent record does not have a worktree path: ${requestedId}`,
		);
	}
	if (!isAbsolute(worktreePath)) {
		throw new Error(
			`background agent worktree path must be absolute: ${requestedId}`,
		);
	}
	const stats = statSync(worktreePath);
	if (!stats.isDirectory()) {
		throw new Error(
			`background agent worktree path is not a directory: ${worktreePath}`,
		);
	}
	const shouldOpen = args?.dryRun !== true && args?.open !== false;
	if (shouldOpen) {
		openExternalUrl(worktreePath);
		ctx.pushEvent("Background agent worktree opened", worktreePath, "success");
		broadcastHubState(ctx);
	}
	return {
		recordId,
		sessionId: summary.sessionId,
		worktreePath,
		opened: shouldOpen,
	};
}

export async function handleDesktopCommand(
	ctx: HubContext,
	command: string,
	args?: Record<string, unknown>,
): Promise<unknown> {
	if (command === "list_provider_catalog") {
		await ensureCustomProvidersLoaded(providerSettingsManager);
		return await listLocalProviders(providerSettingsManager);
	}
	if (command === "list_provider_models") {
		const provider = String(args?.provider ?? "").trim();
		return await getLocalProviderModels(
			provider,
			providerSettingsManager.getProviderConfig(provider),
		);
	}
	if (command === "save_provider_settings") {
		return saveLocalProviderSettings(providerSettingsManager, {
			...readProviderSettingsUpdate(args),
			providerId: String(args?.provider ?? ""),
			enabled: typeof args?.enabled === "boolean" ? args.enabled : undefined,
			apiKey: typeof args?.api_key === "string" ? args.api_key : undefined,
			baseUrl: typeof args?.base_url === "string" ? args.base_url : undefined,
		});
	}
	if (command === "add_provider") {
		await ensureCustomProvidersLoaded(providerSettingsManager);
		return await addLocalProvider(providerSettingsManager, {
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
		const existing = providerSettingsManager.getProviderSettings(providerId);
		const credentials = await loginLocalProvider(
			providerId,
			existing,
			openExternalUrl,
		);
		const saved = saveLocalProviderOAuthCredentials(
			providerSettingsManager,
			providerId,
			existing,
			credentials,
		);
		return {
			provider: providerId,
			accessTokenPresent:
				(saved.auth?.accessToken?.trim() ?? saved.apiKey?.trim() ?? "").length >
				0,
		};
	}
	if (command === "cline_account") {
		const settings = providerSettingsManager.getProviderSettings("cline");
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
	if (command === "browser_automation_status") {
		return getHubBrowserAutomationStatus();
	}
	if (command === "browser_snapshot") {
		return await runHubBrowserSnapshotCommand(args);
	}
	if (command === "browser_action") {
		return await runHubBrowserActionCommand(args);
	}
	if (command === "browser_screenshot") {
		return await runHubBrowserScreenshotCommand(args);
	}
	if (command === "web_search") {
		return await runWebSearchCommand(args);
	}
	if (command === "cursor_uri_preview") {
		if (!ctx.uiClient) {
			throw new Error("Hub is not connected.");
		}
		return await ctx.uiClient.previewCursorUri(
			readCursorUriPreviewRequest(args),
		);
	}
	if (command === "cursor_automation_ingest") {
		const input =
			args && typeof args === "object" ? (args as JsonRecord) : undefined;
		return await ingestCursorAutomation(input);
	}
	if (command === "cursor_uri_launch") {
		const input =
			args && typeof args === "object" ? (args as JsonRecord) : undefined;
		return await launchCursorUri(ctx, input);
	}
	if (command === "search_workspace_files") {
		if (!ctx.uiClient) {
			throw new Error("Hub is not connected.");
		}
		const response = await ctx.uiClient.searchMentionFiles(
			readWorkspaceFileSearchRequest(args),
		);
		return response.results.map((result) => result.path);
	}
	if (command === "get_global_settings") {
		return readGlobalSettings();
	}
	if (command === "set_telemetry_opt_out") {
		if (typeof args?.telemetry_opt_out !== "boolean") {
			throw new Error("telemetry_opt_out must be a boolean");
		}
		setTelemetryOptOutGlobally(args.telemetry_opt_out);
		return readGlobalSettings();
	}
	if (command === "list_connector_channels") {
		return connectorChannelsPayload();
	}
	if (command === "start_connector_channel") {
		const response = await startConnectorChannel(args);
		broadcastHubState(ctx);
		return response;
	}
	if (command === "stop_connector_channel") {
		const response = await stopConnectorChannel(args);
		broadcastHubState(ctx);
		return response;
	}
	if (command === "list_mcp_servers") {
		return readMcpServersResponse();
	}
	if (command === "import_cursor_mcp_servers") {
		const input =
			args && typeof args === "object" ? (args as JsonRecord) : undefined;
		return importCursorMcpServers(input);
	}
	if (command === "cursor_mcp_install") {
		const input =
			args && typeof args === "object" ? (args as JsonRecord) : undefined;
		return installCursorMcpServer(input);
	}
	if (
		command === "authorize_mcp_server_oauth" ||
		command === "authenticate_mcp_server"
	) {
		const input =
			args && typeof args === "object" ? (args as JsonRecord) : undefined;
		return await authorizeMcpServerOAuthForHub(input);
	}
	if (command === "cursor_rule_open") {
		const input =
			args && typeof args === "object" ? (args as JsonRecord) : undefined;
		return openCursorRule(input);
	}
	if (command === "cursor_plugin_add") {
		const input =
			args && typeof args === "object" ? (args as JsonRecord) : undefined;
		return await addCursorPlugin(input);
	}
	if (command === "cursor_git_action") {
		const input =
			args && typeof args === "object" ? (args as JsonRecord) : undefined;
		return runCursorGitAction(input);
	}
	if (command === "set_mcp_server_disabled") {
		return setMcpServerDisabled(
			String(args?.name ?? "").trim(),
			Boolean(args?.disabled),
		);
	}
	if (command === "upsert_mcp_server") {
		const input =
			args?.input && typeof args.input === "object"
				? (args.input as JsonRecord)
				: ((args ?? {}) as JsonRecord);
		return upsertMcpServer(input);
	}
	if (command === "delete_mcp_server") {
		return deleteMcpServer(String(args?.name ?? "").trim());
	}
	if (command === "ensure_mcp_settings_file") {
		return ensureMcpSettingsFile();
	}
	if (command === "open_mcp_settings_file") {
		const path = ensureMcpSettingsFile();
		openExternalUrl(path);
		return path;
	}
	if (ROUTINE_SCHEDULE_COMMANDS.has(command)) {
		return await handleRoutineScheduleCommand(command, args);
	}
	if (command === "get_process_context") {
		return { workspaceRoot, cwd: workspaceRoot };
	}
	if (
		command === "list_cli_sessions" ||
		command === "list_discovered_sessions"
	) {
		return [...ctx.sessions.values()].map(toWebviewSessionSummary);
	}
	if (command === "list_background_agent_sessions") {
		return listBackgroundAgentSessionSummaries(ctx);
	}
	if (
		command === "delete_background_agent_record" ||
		command === "dismiss_background_agent_session" ||
		command === "delete_background_agent_session"
	) {
		return deleteBackgroundAgentLifecycleRecord(ctx, args);
	}
	if (
		command === "open_background_agent_worktree" ||
		command === "reveal_background_agent_worktree"
	) {
		return backgroundAgentWorktreeResult(ctx, args);
	}
	if (command === "read_session_hooks") {
		return [];
	}
	if (command === "list_user_instruction_configs") {
		return await listUserInstructionConfigs(workspaceRoot);
	}
	if (command === "toggle_disabled_plugin_tool") {
		const toolName = String(args?.name ?? "").trim();
		if (!toolName) throw new Error("tool name is required");
		toggleDisabledTool(toolName);
		return await listUserInstructionConfigs(workspaceRoot);
	}
	if (command === "set_tool_disabled") {
		const rawNames = Array.isArray(args?.names) ? args.names : [args?.name];
		const toolNames = rawNames
			.map((name) => String(name ?? "").trim())
			.filter(Boolean);
		if (toolNames.length === 0) throw new Error("tool name is required");
		setDisabledTools(toolNames, args?.disabled === true);
		return await listUserInstructionConfigs(workspaceRoot);
	}
	if (command === "set_plugin_disabled") {
		const pluginPath = String(args?.path ?? "").trim();
		if (!pluginPath) throw new Error("plugin path is required");
		setDisabledPlugin(pluginPath, args?.disabled === true);
		return await listUserInstructionConfigs(workspaceRoot);
	}
	throw new Error(`unsupported desktop command: ${command}`);
}
