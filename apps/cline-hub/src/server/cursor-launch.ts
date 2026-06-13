import {
	type BackgroundAgentTaskRecord,
	buildCursorAgentTaskRouteRequest,
	buildCursorRuleRouteRequest,
	createBackgroundAgentWorktree,
	type CursorBackgroundAgentLaunchRequest,
	DefaultToolNames,
	launchCursorBackgroundAgent,
	resolveBackgroundAgentRecordsPath,
	resolveClineDataDir,
	SessionSource,
	upsertBackgroundAgentTaskRecordFile,
} from "@cline/core";
import type {
	AgentConfig,
	CursorUriPreviewRequest,
	CursorUriPreviewResponse,
} from "@cline/shared";
import {
	DEFAULT_HUB_MODEL_ID,
	DEFAULT_HUB_PROVIDER_ID,
} from "../webview-protocol";
import { workspaceRoot } from "./deps";
import { buildSessionStartInput, resolveLaunchContext } from "./sessions";
import type { HubContext } from "./state";
import { broadcastHubState } from "./state-payloads";
import type { JsonRecord } from "./types";
import { asTrimmedString, toPositiveInt } from "./utils";

const CURSOR_URI_LAUNCHABLE_AGENT_PATHS = new Set([
	"/createchat",
	"/background-agent",
	"/prompt",
	"/command",
	"/rule",
	"/pr-review",
	"/glass",
	"/git/checkout",
	"/git/branch",
	"/git/commit",
]);

function asTrimmedStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const items = value
		.map((entry) => asTrimmedString(entry))
		.filter((entry): entry is string => Boolean(entry));
	return items.length > 0 ? items : undefined;
}

function readCursorUriPreviewRequest(args?: JsonRecord): CursorUriPreviewRequest {
	const uri = asTrimmedString(args?.uri);
	if (!uri) {
		throw new Error("cursor_uri_launch requires a non-empty uri");
	}
	const requestedWorkspaceRoot =
		asTrimmedString(args?.workspaceRoot) ?? asTrimmedString(workspaceRoot);
	const workspaceRoots = asTrimmedStringArray(args?.workspaceRoots);
	const maxCommandFileBytes = toPositiveInt(args?.maxCommandFileBytes);
	const maxRuleFileBytes = toPositiveInt(args?.maxRuleFileBytes);
	return {
		uri,
		...(requestedWorkspaceRoot ? { workspaceRoot: requestedWorkspaceRoot } : {}),
		...(workspaceRoots ? { workspaceRoots } : {}),
		...(maxCommandFileBytes ? { maxCommandFileBytes } : {}),
		...(maxRuleFileBytes ? { maxRuleFileBytes } : {}),
	};
}

function getCursorPreviewString(
	preview: CursorUriPreviewResponse,
	key: string,
): string | undefined {
	const value = preview[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getCursorPreviewStringArray(
	preview: CursorUriPreviewResponse,
	key: string,
): string[] {
	const value = preview[key];
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((item) => (typeof item === "string" ? item.trim() : ""))
		.filter((item) => item.length > 0);
}

function getJsonStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((item) => (typeof item === "string" ? item.trim() : ""))
		.filter((item) => item.length > 0);
}

function getJsonRecord(value: unknown): JsonRecord | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as JsonRecord)
		: undefined;
}

function isCursorRuleReviewPreview(preview: CursorUriPreviewResponse): boolean {
	return (
		getCursorPreviewString(preview, "route") === "rule" &&
		getCursorPreviewString(preview, "path") === "/rule" &&
		getCursorPreviewString(preview, "kind") === "review"
	);
}

function formatCursorRuleReviewUrl(value: string): string {
	try {
		const url = new URL(value);
		return `${url.origin}${url.pathname}${url.search ? "?[redacted]" : ""}${
			url.hash ? "#[redacted]" : ""
		}`;
	} catch {
		return "[provided url]";
	}
}

function readCursorRuleReviewConfigKeys(value: string | null): string[] {
	if (!value) {
		return [];
	}
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	try {
		const parsed = JSON.parse(
			Buffer.from(
				normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="),
				"base64",
			).toString("utf8"),
		) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? Object.keys(parsed).sort()
			: [];
	} catch {
		return [];
	}
}

function buildCursorRuleReviewTaskPrompt(uri: string): string | undefined {
	try {
		const request = buildCursorRuleRouteRequest(uri);
		if (request.kind !== "review") {
			return undefined;
		}
		const params = new URL(uri).searchParams;
		const content = params.get("content")?.trim();
		const url = params.get("url")?.trim();
		const configKeys = readCursorRuleReviewConfigKeys(params.get("config"));
		return [
			"A compatible rule deeplink was opened with a payload that requires agent review before writing project rules.",
			"",
			"Review the requested rule change, inspect the existing rule files first, and ask for confirmation before creating or editing .cursorrules or files under .cursor/rules.",
			"",
			"Rule request:",
			...(request.name ? [`- name: ${request.name}`] : []),
			...(request.path ? [`- path: ${request.path}`] : []),
			...(url ? [`- url: ${formatCursorRuleReviewUrl(url)}`] : []),
			...(configKeys.length > 0
				? [`- config keys: ${configKeys.join(", ")}`]
				: []),
			`- reason: ${request.reason}`,
			...(content ? ["", "Requested rule content:", content] : []),
		].join("\n");
	} catch {
		return undefined;
	}
}

function resolveCursorPreviewTaskPrompt(
	preview: CursorUriPreviewResponse,
	uri: string,
): string | undefined {
	return (
		getCursorPreviewString(preview, "taskPrompt") ??
		(isCursorRuleReviewPreview(preview)
			? buildCursorRuleReviewTaskPrompt(uri)
			: undefined)
	);
}

function getRouteParamString(
	params: Record<string, string | Record<string, unknown>>,
	key: string,
): string | undefined {
	const value = params[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getRouteConfigKeys(
	params: Record<string, string | Record<string, unknown>>,
): string[] {
	const config = params.config;
	return config && typeof config === "object" && !Array.isArray(config)
		? Object.keys(config).sort()
		: [];
}

function readCursorAgentTaskRouteDetails(uri: string): JsonRecord | undefined {
	try {
		const request = buildCursorAgentTaskRouteRequest(uri);
		const configKeys = getRouteConfigKeys(request.params);
		const details: JsonRecord = {
			kind: request.kind,
			path: request.path,
			paramKeys: Object.keys(request.params).sort(),
			...(configKeys.length > 0 ? { configKeys } : {}),
		};
		if (request.kind === "background-agent") {
			const backgroundDetails: JsonRecord = {};
			const repository =
				getRouteParamString(request.params, "repository") ??
				getRouteParamString(request.params, "repo");
			const requestedBranch = getRouteParamString(request.params, "branch");
			const requestedBaseBranch = getRouteParamString(
				request.params,
				"baseBranch",
			);
			if (repository) {
				backgroundDetails.repository = repository;
			}
			if (requestedBranch) {
				backgroundDetails.requestedBranch = requestedBranch;
			}
			if (requestedBaseBranch) {
				backgroundDetails.requestedBaseBranch = requestedBaseBranch;
			}
			if (configKeys.length > 0) {
				backgroundDetails.configKeys = configKeys;
			}
			if (Object.keys(backgroundDetails).length > 0) {
				details.backgroundAgentDetails = backgroundDetails;
			}
		}
		return details;
	} catch {
		return undefined;
	}
}

function isActualCursorRuleReviewRoute(uri: string): boolean {
	try {
		return buildCursorRuleRouteRequest(uri).kind === "review";
	} catch {
		return false;
	}
}

function doesPreviewMatchAgentRouteDetails(
	preview: CursorUriPreviewResponse,
	details: JsonRecord | undefined,
): boolean {
	if (!details) {
		return false;
	}
	const actualPath = typeof details.path === "string" ? details.path : undefined;
	const actualKind = typeof details.kind === "string" ? details.kind : undefined;
	const previewPath = getCursorPreviewString(preview, "path");
	const previewRoute = getCursorPreviewString(preview, "route");
	if (!actualPath || !actualKind || previewPath !== actualPath) {
		return false;
	}
	return (
		previewRoute === actualKind ||
		(actualKind === "command" && previewRoute === "command-file")
	);
}

function isLaunchableCursorAgentPreview(
	preview: CursorUriPreviewResponse,
	taskPrompt: string | undefined,
	uri: string,
): boolean {
	if (!taskPrompt) {
		return false;
	}
	if (isCursorRuleReviewPreview(preview)) {
		return isActualCursorRuleReviewRoute(uri);
	}
	const details = readCursorAgentTaskRouteDetails(uri);
	if (!doesPreviewMatchAgentRouteDetails(preview, details)) {
		return false;
	}
	const path = typeof details?.path === "string" ? details.path : undefined;
	return Boolean(path && CURSOR_URI_LAUNCHABLE_AGENT_PATHS.has(path));
}

function getCursorQueuedAgentToolPolicies(): AgentConfig["toolPolicies"] {
	return {
		"*": { enabled: false, autoApprove: false },
		[DefaultToolNames.READ_FILES]: { enabled: true, autoApprove: true },
		[DefaultToolNames.SEARCH_CODEBASE]: { enabled: true, autoApprove: true },
	};
}

type CursorLaunchMode = "act" | "plan";
type CursorLaunchDelivery = "queue" | "steer";

type CursorLaunchOptions = {
	mode: CursorLaunchMode;
	enableTools: boolean;
	enableSpawn: boolean;
	enableTeams: boolean;
	autoApproveTools: boolean;
	delivery: CursorLaunchDelivery;
	enableWorktrees: boolean;
	timeoutMs?: number;
	toolPolicies?: AgentConfig["toolPolicies"];
};

function readOptionalBoolean(
	args: JsonRecord | undefined,
	key: string,
): boolean | undefined {
	const value = args?.[key];
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "boolean") {
		throw new Error(`cursor_uri_launch ${key} must be a boolean`);
	}
	return value;
}

function readCursorLaunchMode(args: JsonRecord | undefined): CursorLaunchMode {
	const mode = asTrimmedString(args?.mode);
	if (!mode) {
		return "plan";
	}
	if (mode !== "plan" && mode !== "act") {
		throw new Error("cursor_uri_launch mode must be plan or act");
	}
	return mode;
}

function readCursorLaunchDelivery(
	args: JsonRecord | undefined,
): CursorLaunchDelivery {
	const delivery = asTrimmedString(args?.delivery);
	if (!delivery) {
		return "queue";
	}
	if (delivery !== "queue" && delivery !== "steer") {
		throw new Error("cursor_uri_launch delivery must be queue or steer");
	}
	return delivery;
}

function readCursorLaunchOptions(
	args: JsonRecord | undefined,
	backgroundAgent: boolean,
): CursorLaunchOptions {
	const timeoutMs = toPositiveInt(args?.timeoutMs);
	if (backgroundAgent) {
		const enableWorktrees = readOptionalBoolean(args, "enableWorktrees") ?? true;
		return {
			mode: "plan",
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
			autoApproveTools: false,
			delivery: "queue",
			enableWorktrees,
			...(timeoutMs ? { timeoutMs } : {}),
			toolPolicies: getCursorQueuedAgentToolPolicies(),
		};
	}
	const autoApproveTools =
		readOptionalBoolean(args, "autoApproveTools") ?? false;
	return {
		mode: readCursorLaunchMode(args),
		enableTools: readOptionalBoolean(args, "enableTools") ?? true,
		enableSpawn: readOptionalBoolean(args, "enableSpawn") ?? false,
		enableTeams: readOptionalBoolean(args, "enableTeams") ?? false,
		autoApproveTools,
		delivery: readCursorLaunchDelivery(args),
		enableWorktrees: false,
		...(timeoutMs ? { timeoutMs } : {}),
		...(autoApproveTools
			? {}
			: { toolPolicies: getCursorQueuedAgentToolPolicies() }),
	};
}

function buildCursorLaunchMetadata(
	preview: CursorUriPreviewResponse,
	uri: string,
): JsonRecord {
	const routeDetails = readCursorAgentTaskRouteDetails(uri);
	const route = getCursorPreviewString(preview, "route") ?? "unknown";
	const path = getCursorPreviewString(preview, "path");
	const backgroundAgent =
		route === "background-agent" || path === "/background-agent";
	const detailParamKeys = getJsonStringArray(routeDetails?.paramKeys);
	const detailConfigKeys = getJsonStringArray(routeDetails?.configKeys);
	const paramKeys =
		detailParamKeys.length > 0
			? detailParamKeys
			: getCursorPreviewStringArray(preview, "paramKeys");
	const configKeys =
		detailConfigKeys.length > 0
			? detailConfigKeys
			: getCursorPreviewStringArray(preview, "configKeys");
	const previewGlass = getJsonRecord(preview.glass);
	const glass =
		previewGlass ??
		(route === "glass" || path === "/glass"
			? {
					glass: true,
					mode: "overlay",
					hasPrompt: Boolean(getCursorPreviewString(preview, "taskPrompt")),
					paramKeys,
					configKeys,
				}
			: undefined);
	const cursor: JsonRecord = {
		source: "cursor-uri",
		route,
		background: backgroundAgent,
		...(glass ? { glass: true } : {}),
	};
	if (path) {
		cursor.path = path;
	}
	if (paramKeys.length > 0) {
		cursor.paramKeys = paramKeys;
	}
	if (configKeys.length > 0) {
		cursor.configKeys = configKeys;
	}
	if (glass) {
		cursor.glassMode = "overlay";
	}
	return {
		cursor,
		...(backgroundAgent ? { backgroundAgent: true } : {}),
		...(glass ? { glass } : {}),
		...(routeDetails?.backgroundAgentDetails
			? { backgroundAgentDetails: routeDetails.backgroundAgentDetails }
			: {}),
	};
}

function backgroundAgentRecordsPath(): string {
	return resolveBackgroundAgentRecordsPath(resolveClineDataDir());
}

function buildBackgroundAgentLaunchRequest(
	uri: string,
	taskPrompt: string,
	backgroundAgentDetails: JsonRecord | undefined,
): CursorBackgroundAgentLaunchRequest {
	let prompt = taskPrompt;
	let config: Record<string, unknown> | undefined;
	try {
		const request = buildCursorAgentTaskRouteRequest(uri);
		prompt = request.prompt ?? request.taskPrompt;
		config =
			request.params.config &&
			typeof request.params.config === "object" &&
			!Array.isArray(request.params.config)
				? request.params.config
				: undefined;
	} catch {
		// Fall back to the already validated preview prompt.
	}
	return {
		prompt,
		routePrompt: taskPrompt,
		repository: asTrimmedString(backgroundAgentDetails?.repository),
		requestedBranch: asTrimmedString(backgroundAgentDetails?.requestedBranch),
		requestedBaseBranch: asTrimmedString(
			backgroundAgentDetails?.requestedBaseBranch,
		),
		...(config ? { config } : {}),
	};
}

function backgroundAgentDetailsFromRecord(
	record: BackgroundAgentTaskRecord,
	baseDetails: JsonRecord | undefined,
): JsonRecord {
	return {
		...(baseDetails ?? {}),
		route: asTrimmedString(baseDetails?.route) ?? "background-agent",
		path: asTrimmedString(baseDetails?.path) ?? "/background-agent",
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

export async function launchCursorUri(
	ctx: HubContext,
	args?: JsonRecord,
): Promise<JsonRecord> {
	if (args?.confirmed !== true) {
		throw new Error("cursor_uri_launch requires confirmed=true");
	}
	if (!ctx.cline || !ctx.uiClient) {
		throw new Error("Hub is not connected.");
	}
	const input = readCursorUriPreviewRequest(args);
	const preview = await ctx.uiClient.previewCursorUri(input);
	if (!preview.handled) {
		throw new Error(
			"Import-compatible URI was not handled by the preview route",
		);
	}
	const taskPrompt = resolveCursorPreviewTaskPrompt(preview, input.uri);
	const route = getCursorPreviewString(preview, "route") ?? "unknown";
	if (
		!isLaunchableCursorAgentPreview(preview, taskPrompt, input.uri) ||
		!taskPrompt
	) {
		throw new Error(
			`Import-compatible URI route "${route}" can be previewed but is not launchable from Hub yet`,
		);
	}

	const provider =
		asTrimmedString(args?.provider) ?? DEFAULT_HUB_PROVIDER_ID;
	const model = asTrimmedString(args?.model) ?? DEFAULT_HUB_MODEL_ID;
	const launchWorkspaceRoot = input.workspaceRoot ?? workspaceRoot;
	const context = resolveLaunchContext(ctx, {
		provider,
		model,
		workspaceRoot: launchWorkspaceRoot,
		cwd: launchWorkspaceRoot,
	});
	const metadata = buildCursorLaunchMetadata(preview, input.uri);
	const backgroundAgent = metadata.backgroundAgent === true;
	const glass = Boolean(metadata.glass);
	const backgroundAgentDetails = getJsonRecord(metadata.backgroundAgentDetails);
	const launchOptions = readCursorLaunchOptions(args, backgroundAgent);
	const mode = launchOptions.mode;
	if (backgroundAgent) {
		let launchedContext = context;
		let launchedMetadata = metadata;
		const record = await launchCursorBackgroundAgent(
			buildBackgroundAgentLaunchRequest(
				input.uri,
				taskPrompt,
				backgroundAgentDetails,
			),
			{
				getWorkspaceRoot: async () => launchWorkspaceRoot,
				areWorktreesEnabled: () => launchOptions.enableWorktrees,
				createWorktree: createBackgroundAgentWorktree,
				onRecordChange: (nextRecord) => {
					upsertBackgroundAgentTaskRecordFile(
						backgroundAgentRecordsPath(),
						nextRecord,
					);
				},
				startTask: async (safePrompt, _taskSettings, recordAtStart) => {
					const taskWorkspaceRoot =
						recordAtStart.worktreePath ??
						recordAtStart.workspaceRoot ??
						launchWorkspaceRoot;
					launchedContext = resolveLaunchContext(ctx, {
						provider,
						model,
						workspaceRoot: taskWorkspaceRoot,
						cwd: taskWorkspaceRoot,
					});
					launchedMetadata = {
						...metadata,
						backgroundAgent: true,
						backgroundAgentDetails: backgroundAgentDetailsFromRecord(
							recordAtStart,
							backgroundAgentDetails,
						),
					};
					const started = await ctx.cline!.start(
						buildSessionStartInput(launchedContext, {
							mode,
							enableTools: launchOptions.enableTools,
							enableSpawn: launchOptions.enableSpawn,
							enableTeams: launchOptions.enableTeams,
							autoApproveTools: launchOptions.autoApproveTools,
							source: SessionSource.WEB,
							sessionMetadata: launchedMetadata,
							toolPolicies: launchOptions.toolPolicies,
						}),
					);
					const sessionId = started.sessionId.trim();
					if (!sessionId) {
						throw new Error(
							"cursor_uri_launch failed to start a background-agent Hub session",
						);
					}
					const now = Date.now();
					ctx.sessions.set(sessionId, {
						sessionId,
						status: "running",
						title:
							safePrompt.length > 34
								? `${safePrompt.slice(0, 31)}...`
								: safePrompt,
						workspaceRoot: launchedContext.workspaceRoot,
						cwd: launchedContext.cwd,
						provider: launchedContext.providerId,
						model: launchedContext.modelId,
						source: SessionSource.WEB,
						createdAt: now,
						updatedAt: now,
						prompt: safePrompt,
						agentCount: 1,
						participantCount: 1,
						metadata: launchedMetadata,
					});
					await ctx.cline!.send({
						sessionId,
						prompt: safePrompt,
						mode,
						delivery: launchOptions.delivery,
						...(launchOptions.timeoutMs
							? { timeoutMs: launchOptions.timeoutMs }
							: {}),
					});
					return sessionId;
				},
			},
		);
		const finalDetails = backgroundAgentDetailsFromRecord(
			record,
			backgroundAgentDetails,
		);
		const finalMetadata = {
			...launchedMetadata,
			backgroundAgent: true,
			backgroundAgentDetails: finalDetails,
		};
		const finalSessionId = record.taskId ?? record.id;
		const liveSession = record.taskId ? ctx.sessions.get(record.taskId) : undefined;
		if (liveSession) {
			liveSession.metadata = finalMetadata;
			liveSession.updatedAt = record.updatedAt;
		}
		ctx.pushEvent(
			"Import-compatible URI launched",
			`${route} queued in session ${finalSessionId}`,
			"success",
		);
		broadcastHubState(ctx);

		return {
			handled: true,
			launched: true,
			route,
			...(getCursorPreviewString(preview, "path")
				? { path: getCursorPreviewString(preview, "path") }
				: {}),
			backgroundAgent: true,
			sessionId: finalSessionId,
			provider: launchedContext.providerId,
			model: launchedContext.modelId,
			mode,
			queued: launchOptions.delivery === "queue",
			backgroundAgentDetails: finalDetails,
			metadata: finalMetadata,
			preview,
		};
	}
	const started = await ctx.cline.start(
		buildSessionStartInput(context, {
			mode,
			enableTools: launchOptions.enableTools,
			enableSpawn: launchOptions.enableSpawn,
			enableTeams: launchOptions.enableTeams,
			autoApproveTools: launchOptions.autoApproveTools,
			source: SessionSource.WEB,
			sessionMetadata: metadata,
			toolPolicies: launchOptions.toolPolicies,
		}),
	);
	const sessionId = started.sessionId.trim();
	if (!sessionId) {
		throw new Error("cursor_uri_launch failed to start a Hub session");
	}
	const now = Date.now();
	ctx.sessions.set(sessionId, {
		sessionId,
		status: "running",
		title: taskPrompt.length > 34 ? `${taskPrompt.slice(0, 31)}...` : taskPrompt,
		workspaceRoot: context.workspaceRoot,
		cwd: context.cwd,
		provider: context.providerId,
		model: context.modelId,
		source: SessionSource.WEB,
		createdAt: now,
		updatedAt: now,
		prompt: taskPrompt,
		agentCount: 1,
		participantCount: 1,
		metadata,
	});
	await ctx.cline.send({
		sessionId,
		prompt: taskPrompt,
		mode,
		delivery: launchOptions.delivery,
		...(launchOptions.timeoutMs ? { timeoutMs: launchOptions.timeoutMs } : {}),
	});
	ctx.pushEvent(
		"Import-compatible URI launched",
		`${route} ${launchOptions.delivery === "queue" ? "queued" : "steered"} in session ${sessionId}`,
		"success",
	);
	broadcastHubState(ctx);

	return {
		handled: true,
		launched: true,
		route,
		...(getCursorPreviewString(preview, "path")
			? { path: getCursorPreviewString(preview, "path") }
			: {}),
		backgroundAgent,
		...(glass ? { glass: true } : {}),
		...(backgroundAgentDetails ? { backgroundAgentDetails } : {}),
		sessionId,
		provider: context.providerId,
		model: context.modelId,
		mode,
		queued: launchOptions.delivery === "queue",
		metadata,
		preview,
	};
}
