import {
	buildCursorAgentTaskRouteRequest,
	DefaultToolNames,
	SessionSource,
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

function isLaunchableCursorAgentPreview(
	preview: CursorUriPreviewResponse,
): boolean {
	const path = getCursorPreviewString(preview, "path");
	const route = getCursorPreviewString(preview, "route");
	return Boolean(
		getCursorPreviewString(preview, "taskPrompt") &&
			path &&
			(CURSOR_URI_LAUNCHABLE_AGENT_PATHS.has(path) ||
				(route === "command-file" && path === "/command")),
	);
}

function getCursorQueuedAgentToolPolicies(): AgentConfig["toolPolicies"] {
	return {
		"*": { enabled: false, autoApprove: false },
		[DefaultToolNames.READ_FILES]: { enabled: true, autoApprove: true },
		[DefaultToolNames.SEARCH_CODEBASE]: { enabled: true, autoApprove: true },
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
		throw new Error("Cursor URI was not handled by the preview route");
	}
	const taskPrompt = getCursorPreviewString(preview, "taskPrompt");
	const route = getCursorPreviewString(preview, "route") ?? "unknown";
	if (!isLaunchableCursorAgentPreview(preview) || !taskPrompt) {
		throw new Error(
			`Cursor URI route "${route}" can be previewed but is not launchable from Hub yet`,
		);
	}

	const provider =
		asTrimmedString(args?.provider) ?? DEFAULT_HUB_PROVIDER_ID;
	const model = asTrimmedString(args?.model) ?? DEFAULT_HUB_MODEL_ID;
	const mode = "plan";
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
	const started = await ctx.cline.start(
		buildSessionStartInput(context, {
			mode,
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
			autoApproveTools: false,
			source: SessionSource.WEB,
			sessionMetadata: metadata,
			toolPolicies: getCursorQueuedAgentToolPolicies(),
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
		delivery: "queue",
	});
	ctx.pushEvent(
		"Cursor URI launched",
		`${route} queued in session ${sessionId}`,
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
		queued: true,
		metadata,
		preview,
	};
}
