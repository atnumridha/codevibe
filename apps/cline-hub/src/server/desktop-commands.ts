import { isAbsolute, relative, resolve } from "node:path";
import {
	addLocalProvider,
	type BackgroundAgentTaskRecord,
	type ClineAccountActionRequest,
	ClineAccountService,
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

const ROUTINE_SCHEDULE_COMMANDS = new Set([
	"list_routine_schedules",
	"create_routine_schedule",
	"update_routine_schedule",
	"pause_routine_schedule",
	"resume_routine_schedule",
	"trigger_routine_schedule",
	"delete_routine_schedule",
]);

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
		...(requestedWorkspaceRoot ? { workspaceRoot: requestedWorkspaceRoot } : {}),
		...(workspaceRoots?.length ? { workspaceRoots } : {}),
		...(maxCommandFileBytes ? { maxCommandFileBytes } : {}),
		...(maxRuleFileBytes ? { maxRuleFileBytes } : {}),
	};
}

function isInsideOrSame(parent: string, candidate: string): boolean {
	const rel = relative(parent, candidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function readWorkspaceFileSearchRequest(
	args: Record<string, unknown> | undefined,
): HubMentionFileSearchRequest {
	const activeRoot = resolve(workspaceRoot);
	const requestedRoot = resolve(
		asTrimmedString(args?.workspaceRoot) ??
			asTrimmedString(args?.cwd) ??
			activeRoot,
	);
	if (!isInsideOrSame(activeRoot, requestedRoot)) {
		throw new Error(
			"search_workspace_files workspaceRoot must be inside the active workspace",
		);
	}
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

function backgroundAgentRecordsPath(): string {
	return resolveBackgroundAgentRecordsPath(resolveClineDataDir());
}

function backgroundAgentRecordDetails(
	record: BackgroundAgentTaskRecord,
): Record<string, unknown> {
	return {
		route: "background-agent",
		path: "/background-agent",
		id: record.id,
		status: record.status,
		...(record.launchMode ? { launchMode: record.launchMode } : {}),
		agentMode: record.agentMode,
		confirmationRequired: record.confirmationRequired,
		autoApprovalProfile: record.autoApprovalProfile,
		worktreePolicy: record.worktreePolicy,
		...(record.repository ? { repository: record.repository } : {}),
		...(record.requestedBranch
			? { requestedBranch: record.requestedBranch }
			: {}),
		...(record.requestedBaseBranch
			? { requestedBaseBranch: record.requestedBaseBranch }
			: {}),
		...(record.workspaceRoot ? { workspaceRoot: record.workspaceRoot } : {}),
		...(record.worktreePath ? { worktreePath: record.worktreePath } : {}),
		...(record.worktreeBranch
			? { worktreeBranch: record.worktreeBranch }
			: {}),
		...(record.worktreeBaseRef
			? { worktreeBaseRef: record.worktreeBaseRef }
			: {}),
		...(record.fallbackReason
			? { fallbackReason: record.fallbackReason }
			: {}),
		...(record.warning ? { warning: record.warning } : {}),
		...(record.taskId ? { taskId: record.taskId } : {}),
		...(record.errorMessage ? { errorMessage: record.errorMessage } : {}),
	};
}

function backgroundAgentRecordSummary(
	record: BackgroundAgentTaskRecord,
): WebviewSessionSummary {
	const sessionId = record.taskId ?? record.id;
	const title =
		record.prompt.length > 34
			? `${record.prompt.slice(0, 31)}...`
			: record.prompt;
	return {
		sessionId,
		title,
		status: record.status,
		source: record.source,
		workspaceRoot: record.worktreePath ?? record.workspaceRoot,
		updatedAt: record.updatedAt,
		backgroundAgent: true,
		backgroundAgentDetails: backgroundAgentRecordDetails(record),
	};
}

function listBackgroundAgentSessionSummaries(
	ctx: HubContext,
): WebviewSessionSummary[] {
	const bySessionId = new Map<string, WebviewSessionSummary>();
	for (const record of readBackgroundAgentTaskRecordsFile(
		backgroundAgentRecordsPath(),
	)) {
		const summary = backgroundAgentRecordSummary(record);
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
			accessToken: saved.auth?.accessToken ?? saved.apiKey ?? "",
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
