import type {
	CursorUriPreviewRequest,
	CursorUriPreviewResponse,
	HubClientRecord,
	HubCommandEnvelope,
	HubEventEnvelope,
	HubReplyEnvelope,
	ToolApprovalRequest,
} from "@cline/shared";
import { captureSdkError, createSessionId } from "@cline/shared";
import type { CronEventNdjsonIngressResult } from "../../cron/events/cron-event-ingress";
import { CronService } from "../../cron/service/cron-service";
import { HubScheduleCommandService } from "../../cron/service/schedule-command-service";
import { HubScheduleService } from "../../cron/service/schedule-service";
import type {
	CronEventLogRecord,
	CronEventProcessingStatus,
	ListEventLogsOptions,
} from "../../cron/store/sqlite-cron-store";
import {
	buildCursorAgentTaskRouteRequest,
	buildCursorAutomationIngestRouteRequest,
	buildCursorGlassRouteMetadata,
	buildCursorMcpInstallRequest,
	buildCursorPluginAddRouteRequest,
	buildCursorRuleRouteRequest,
	buildCursorSettingsRouteRequest,
	CursorMcpInstallError,
	CursorUriError,
	getCursorCompatibleUriPath,
	resolveCursorCommandFileRouteRequest,
	resolveCursorRuleFileRouteRequest,
} from "../../extensions/mcp/cursor-uri";
import { LocalRuntimeHost } from "../../runtime/host/local-runtime-host";
import type {
	PendingPromptsRuntimeService,
	RuntimeHost,
} from "../../runtime/host/runtime-host";
import { SqliteSessionStore } from "../../services/storage/sqlite-session-store";
import { CoreSessionService } from "../../session/services/session-service";
import {
	type CoreSettingsGetInput,
	type CoreSettingsListInput,
	type CoreSettingsPatchInput,
	CoreSettingsService,
	type CoreSettingsToggleInput,
	type CoreSettingsType,
} from "../../settings";
import type { CoreSessionEvent } from "../../types/events";
import {
	handleApprovalRespond,
	requestToolApproval as requestToolApprovalHandler,
	resolvePendingApproval,
} from "./handlers/approval-handlers";
import {
	cancelPendingCapabilityRequests,
	handleCapabilityProgress,
	handleCapabilityRequest,
	handleCapabilityRespond,
	requestCapability as requestCapabilityHandler,
} from "./handlers/capability-handlers";
import {
	handleClientList,
	handleClientRegister,
	handleClientUnregister,
	handleClientUpdate,
} from "./handlers/client-handlers";
import {
	buildHubEvent,
	type HubTransportContext,
	okReply,
	type PendingApproval,
	type PendingCapabilityRequest,
} from "./handlers/context";
import {
	handleRunAbort,
	handleSessionHook,
	handleSessionInput,
} from "./handlers/run-handlers";
import { projectSessionEvent } from "./handlers/session-event-projector";
import {
	handleSessionAttach,
	handleSessionCreate,
	handleSessionDelete,
	handleSessionDetach,
	handleSessionGet,
	handleSessionList,
	handleSessionMessages,
	handleSessionPendingPrompts,
	handleSessionRemovePendingPrompt,
	handleSessionRestore,
	handleSessionUpdate,
	handleSessionUpdatePendingPrompt,
} from "./handlers/session-handlers";
import { eventNameForScheduleCommand } from "./hub-schedule-events";
import { logHubBoundaryError } from "./hub-server-logging";
import type { HubWebSocketServerOptions } from "./hub-server-options";
import type { HubSessionState } from "./hub-session-records";
import type { NativeHubTransport } from "./native-transport";

const SETTINGS_TYPES = new Set<CoreSettingsType>([
	"skills",
	"workflows",
	"rules",
	"tools",
	"mcp",
]);
const CRON_EVENT_PROCESSING_STATUSES = new Set<CronEventProcessingStatus>([
	"received",
	"unmatched",
	"queued",
	"suppressed",
	"failed",
]);
const MAX_CRON_EVENT_LIST_LIMIT = 500;
const MAX_CRON_EVENT_STRING_VALUE_LENGTH = 4_096;
const MAX_CRON_EVENT_ARRAY_VALUES = 100;
const MAX_CRON_EVENT_OBJECT_KEYS = 100;
const DEFAULT_CRON_EVENT_INGEST_MAX_LINE_BYTES = 16 * 1024;
const DEFAULT_CRON_EVENT_INGEST_MAX_EVENTS = 100;
const MAX_CRON_EVENT_INGEST_MAX_LINE_BYTES = 64 * 1024;
const MAX_CRON_EVENT_INGEST_MAX_EVENTS = 1_000;
const CRON_EVENT_SECRET_KEY_PATTERN =
	/(token|secret|password|authorization|api[-_]?key|credential|cookie|session)/i;

function isPayloadObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireOptionalString(
	payload: Record<string, unknown>,
	key: "cwd" | "workspaceRoot" | "id" | "path" | "name",
): string | undefined {
	const value = payload[key];
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new Error(`settings payload '${key}' must be a string.`);
	}
	return value;
}

function requireOptionalBoolean(
	payload: Record<string, unknown>,
	key: "enabled",
): boolean | undefined {
	const value = payload[key];
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "boolean") {
		throw new Error(`settings payload '${key}' must be a boolean.`);
	}
	return value;
}

function requireOptionalHubBoolean(
	payload: Record<string, unknown>,
	key: "includePayload",
): boolean | undefined {
	const value = payload[key];
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "boolean") {
		throw new Error(`cron event payload '${key}' must be a boolean.`);
	}
	return value;
}

function requireOptionalHubString(
	payload: Record<string, unknown>,
	key: "eventType" | "source" | "processingStatus",
): string | undefined {
	const value = payload[key];
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new Error(`cron event payload '${key}' must be a string.`);
	}
	return value.trim() || undefined;
}

function requireOptionalHubStringArray(
	payload: Record<string, unknown>,
	key: "allowedSources",
	commandName: string,
): string[] | undefined {
	const value = payload[key];
	if (value === undefined) {
		return undefined;
	}
	if (!Array.isArray(value)) {
		throw new Error(`${commandName} payload '${key}' must be an array.`);
	}
	const strings = value.map((item) => {
		if (typeof item !== "string") {
			throw new Error(
				`${commandName} payload '${key}' must contain only strings.`,
			);
		}
		return item.trim();
	});
	const nonEmpty = strings.filter(Boolean);
	if (nonEmpty.length === 0) {
		throw new Error(
			`${commandName} payload '${key}' must contain at least one non-empty string.`,
		);
	}
	return nonEmpty;
}

function requireOptionalHubPositiveInteger(
	payload: Record<string, unknown>,
	key: "maxLineBytes" | "maxEvents" | "maxCommandFileBytes",
	commandName: string,
): number | undefined {
	const value = payload[key];
	if (value === undefined) {
		return undefined;
	}
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		!Number.isInteger(value) ||
		value <= 0
	) {
		throw new Error(
			`${commandName} payload '${key}' must be a positive integer.`,
		);
	}
	return value;
}

function requireOptionalHubPositiveIntegerAtMost(
	payload: Record<string, unknown>,
	key: "maxLineBytes" | "maxEvents",
	commandName: string,
	maximum: number,
): number | undefined {
	const value = requireOptionalHubPositiveInteger(payload, key, commandName);
	if (value !== undefined && value > maximum) {
		throw new Error(
			`${commandName} payload '${key}' must be less than or equal to ${maximum}.`,
		);
	}
	return value;
}

function requireCronEventListLimit(payload: Record<string, unknown>): number | undefined {
	const value = payload.limit;
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error("cron.event.list payload 'limit' must be a finite number.");
	}
	return Math.min(
		MAX_CRON_EVENT_LIST_LIMIT,
		Math.max(1, Math.floor(value)),
	);
}

function parseSettingsListInput(payload: unknown): CoreSettingsListInput {
	if (payload === undefined) {
		return {};
	}
	if (!isPayloadObject(payload)) {
		throw new Error("settings.list payload must be an object.");
	}
	return {
		cwd: requireOptionalString(payload, "cwd"),
		workspaceRoot: requireOptionalString(payload, "workspaceRoot"),
		availabilityContext: isPayloadObject(payload.availabilityContext)
			? (payload.availabilityContext as CoreSettingsListInput["availabilityContext"])
			: undefined,
	};
}

function parseSettingsToggleInput(payload: unknown): CoreSettingsToggleInput {
	if (!isPayloadObject(payload)) {
		throw new Error("settings.toggle payload must be an object.");
	}
	const { type } = payload;
	if (
		typeof type !== "string" ||
		!SETTINGS_TYPES.has(type as CoreSettingsType)
	) {
		throw new Error(
			"settings.toggle payload 'type' must be one of: skills, workflows, rules, tools, mcp.",
		);
	}
	return {
		...parseSettingsListInput(payload),
		type: type as CoreSettingsType,
		id: requireOptionalString(payload, "id"),
		path: requireOptionalString(payload, "path"),
		name: requireOptionalString(payload, "name"),
		enabled: requireOptionalBoolean(payload, "enabled"),
	};
}

function parseSettingsTargetInput(
	payload: unknown,
	commandName: "settings.get" | "settings.patch",
): CoreSettingsGetInput {
	if (!isPayloadObject(payload)) {
		throw new Error(`${commandName} payload must be an object.`);
	}
	const { type } = payload;
	if (
		typeof type !== "string" ||
		!SETTINGS_TYPES.has(type as CoreSettingsType)
	) {
		throw new Error(
			`${commandName} payload 'type' must be one of: skills, workflows, rules, tools, mcp.`,
		);
	}
	const input = {
		...parseSettingsListInput(payload),
		type: type as CoreSettingsType,
		id: requireOptionalString(payload, "id"),
		path: requireOptionalString(payload, "path"),
		name: requireOptionalString(payload, "name"),
	};
	if (!input.id && !input.path && !input.name) {
		throw new Error(`${commandName} payload requires id, path, or name.`);
	}
	return input;
}

function parseSettingsGetInput(payload: unknown): CoreSettingsGetInput {
	return parseSettingsTargetInput(payload, "settings.get");
}

function parseSettingsPatchInput(payload: unknown): CoreSettingsPatchInput {
	if (!isPayloadObject(payload)) {
		throw new Error("settings.patch payload must be an object.");
	}
	const input = parseSettingsTargetInput(payload, "settings.patch");
	const enabled = requireOptionalBoolean(payload, "enabled");
	if (enabled === undefined) {
		throw new Error("settings.patch payload 'enabled' must be a boolean.");
	}
	return {
		...input,
		enabled,
	};
}

function parseCronEventIngestInput(payload: unknown): {
	input: string;
	defaultSource?: string;
	allowedSources?: string[];
	maxLineBytes?: number;
	maxEvents?: number;
} {
	if (typeof payload === "string") {
		return { input: payload };
	}
	if (!isPayloadObject(payload)) {
		throw new Error("cron.event.ingest payload must be an object or NDJSON string.");
	}
	const inputValue = payload.ndjson ?? payload.input;
	if (inputValue !== undefined && typeof inputValue !== "string") {
		throw new Error("cron.event.ingest payload 'ndjson' must be a string.");
	}
	const defaultSource = payload.defaultSource;
	if (defaultSource !== undefined && typeof defaultSource !== "string") {
		throw new Error("cron.event.ingest payload 'defaultSource' must be a string.");
	}
	const allowedSources = requireOptionalHubStringArray(
		payload,
		"allowedSources",
		"cron.event.ingest",
	);
	const maxLineBytes = requireOptionalHubPositiveIntegerAtMost(
		payload,
		"maxLineBytes",
		"cron.event.ingest",
		MAX_CRON_EVENT_INGEST_MAX_LINE_BYTES,
	);
	const maxEvents = requireOptionalHubPositiveIntegerAtMost(
		payload,
		"maxEvents",
		"cron.event.ingest",
		MAX_CRON_EVENT_INGEST_MAX_EVENTS,
	);
	return {
		input: inputValue ?? JSON.stringify(payload),
		...(defaultSource?.trim() ? { defaultSource: defaultSource.trim() } : {}),
		...(allowedSources ? { allowedSources } : {}),
		maxLineBytes: maxLineBytes ?? DEFAULT_CRON_EVENT_INGEST_MAX_LINE_BYTES,
		maxEvents: maxEvents ?? DEFAULT_CRON_EVENT_INGEST_MAX_EVENTS,
	};
}

function parseCronEventListInput(payload: unknown): {
	options: ListEventLogsOptions;
	includePayload: boolean;
} {
	if (payload === undefined) {
		return { options: {}, includePayload: false };
	}
	if (!isPayloadObject(payload)) {
		throw new Error("cron.event.list payload must be an object.");
	}
	const processingStatus = requireOptionalHubString(payload, "processingStatus");
	if (
		processingStatus !== undefined &&
		!CRON_EVENT_PROCESSING_STATUSES.has(
			processingStatus as CronEventProcessingStatus,
		)
	) {
		throw new Error(
			"cron.event.list payload 'processingStatus' must be one of: received, unmatched, queued, suppressed, failed.",
		);
	}
	return {
		includePayload: requireOptionalHubBoolean(payload, "includePayload") ?? false,
		options: {
			eventType: requireOptionalHubString(payload, "eventType"),
			source: requireOptionalHubString(payload, "source"),
			processingStatus: processingStatus as CronEventProcessingStatus | undefined,
			limit: requireCronEventListLimit(payload),
		},
	};
}

function parseCronEventGetInput(payload: unknown): {
	eventId: string;
	includePayload: boolean;
} {
	if (typeof payload === "string" && payload.trim()) {
		return { eventId: payload.trim(), includePayload: true };
	}
	if (!isPayloadObject(payload)) {
		throw new Error("cron.event.get payload must be an object or event id string.");
	}
	const value = payload.eventId ?? payload.id;
	if (typeof value !== "string" || !value.trim()) {
		throw new Error("cron.event.get payload 'eventId' must be a non-empty string.");
	}
	return {
		eventId: value.trim(),
		includePayload: requireOptionalHubBoolean(payload, "includePayload") ?? true,
	};
}

function sanitizeCronEventValue(value: unknown, depth = 0): unknown {
	if (value === null || value === undefined) {
		return value;
	}
	if (typeof value === "string") {
		return value.length > MAX_CRON_EVENT_STRING_VALUE_LENGTH
			? `${value.slice(0, MAX_CRON_EVENT_STRING_VALUE_LENGTH)}\n[truncated]`
			: value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	if (depth >= 8) {
		return "[truncated]";
	}
	if (Array.isArray(value)) {
		const output = value
			.slice(0, MAX_CRON_EVENT_ARRAY_VALUES)
			.map((entry) => sanitizeCronEventValue(entry, depth + 1));
		if (value.length > MAX_CRON_EVENT_ARRAY_VALUES) {
			output.push("[truncated]");
		}
		return output;
	}
	if (!isPayloadObject(value)) {
		return String(value);
	}

	const entries = Object.entries(value).slice(0, MAX_CRON_EVENT_OBJECT_KEYS);
	const output: Record<string, unknown> = {};
	for (const [key, entry] of entries) {
		output[key] = CRON_EVENT_SECRET_KEY_PATTERN.test(key)
			? "[redacted]"
			: sanitizeCronEventValue(entry, depth + 1);
	}
	const truncatedKeys = Object.keys(value).length - MAX_CRON_EVENT_OBJECT_KEYS;
	if (truncatedKeys > 0) {
		output.__truncatedKeys = truncatedKeys;
	}
	return output;
}

function summarizeCronEventLog(
	event: CronEventLogRecord,
	options: { includePayload: boolean },
) {
	return {
		eventId: event.eventId,
		eventType: event.eventType,
		source: event.source,
		subject: event.subject,
		occurredAt: event.occurredAt,
		receivedAt: event.receivedAt,
		workspaceRoot: event.workspaceRoot,
		dedupeKey: event.dedupeKey,
		processingStatus: event.processingStatus,
		matchedSpecCount: event.matchedSpecCount,
		queuedRunCount: event.queuedRunCount,
		suppressedCount: event.suppressedCount,
		error: event.error,
		createdAt: event.createdAt,
		updatedAt: event.updatedAt,
		payloadKeys: Object.keys(event.payload ?? {}).sort(),
		attributeKeys: Object.keys(event.attributes ?? {}).sort(),
		...(options.includePayload
			? {
					payload: sanitizeCronEventValue(event.payload),
					attributes: sanitizeCronEventValue(event.attributes),
				}
			: {}),
	};
}

function summarizeCronEventIngestResult(result: CronEventNdjsonIngressResult) {
	return {
		eventCount: result.events.length,
		rejectedCount: result.rejected.length,
		rejected: result.rejected.map((line) => ({
			lineNumber: line.lineNumber,
			reason: line.reason,
			message: line.message,
			lineLength: line.line.length,
		})),
		results: result.results.map((entry) => ({
			eventId: entry.event.eventId,
			eventType: entry.event.eventType,
			source: entry.event.source,
			duplicate: entry.duplicate,
			matchedSpecIds: entry.matchedSpecs.map((spec) => spec.specId),
			queuedRunIds: entry.queuedRuns.map((run) => run.runId),
			suppressionCount: entry.suppressions.length,
		})),
	};
}

const CURSOR_AGENT_TASK_ROUTE_PATHS = new Set([
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

function parseCursorUriPreviewInput(
	payload: unknown,
): CursorUriPreviewRequest {
	if (!isPayloadObject(payload)) {
		throw new Error("cursor.uri.preview payload must be an object.");
	}
	const value = payload.uri;
	if (typeof value !== "string" || !value.trim()) {
		throw new Error("cursor.uri.preview payload 'uri' must be a non-empty string.");
	}
	const workspaceRoot = payload.workspaceRoot;
	if (workspaceRoot !== undefined && typeof workspaceRoot !== "string") {
		throw new Error("cursor.uri.preview payload 'workspaceRoot' must be a string.");
	}
	const workspaceRoots = payload.workspaceRoots;
	if (
		workspaceRoots !== undefined &&
		(!Array.isArray(workspaceRoots) ||
			workspaceRoots.some((entry) => typeof entry !== "string"))
	) {
		throw new Error(
			"cursor.uri.preview payload 'workspaceRoots' must be an array of strings.",
		);
	}
	const maxCommandFileBytes = requireOptionalHubPositiveInteger(
		payload,
		"maxCommandFileBytes",
		"cursor.uri.preview",
	);
	const maxRuleFileBytes = requireOptionalHubPositiveInteger(
		payload,
		"maxRuleFileBytes",
		"cursor.uri.preview",
	);
	const trimmedWorkspaceRoots = Array.isArray(workspaceRoots)
		? workspaceRoots.map((entry) => entry.trim()).filter(Boolean)
		: [];
	return {
		uri: value.trim(),
		...(workspaceRoot?.trim()
			? { workspaceRoot: workspaceRoot.trim() }
			: {}),
		...(trimmedWorkspaceRoots.length > 0
			? { workspaceRoots: trimmedWorkspaceRoots }
			: {}),
		...(maxCommandFileBytes !== undefined ? { maxCommandFileBytes } : {}),
		...(maxRuleFileBytes !== undefined ? { maxRuleFileBytes } : {}),
	};
}

function getRecordValue(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function getCursorConfigKeys(
	params: Record<string, string | Record<string, unknown>>,
): string[] {
	return Object.keys(getRecordValue(params.config) ?? {}).sort();
}

function safeUrlOrigin(value: string): string {
	try {
		return new URL(value).origin;
	} catch {
		return "[provided]";
	}
}

function safeCursorSourceLabel(
	source: string | undefined,
	sourceParam?: string,
): string | undefined {
	if (!source) {
		return undefined;
	}
	if (sourceParam === "url") {
		return safeUrlOrigin(source);
	}
	if (sourceParam === "config") {
		try {
			return new URL(source).origin;
		} catch {
			return source;
		}
	}
	return source;
}

function summarizeCursorMcpInstall(uri: string): CursorUriPreviewResponse {
	const request = buildCursorMcpInstallRequest(uri);
	const transport =
		getRecordValue(request.serverConfig.transport) ?? request.serverConfig;
	const url = typeof transport.url === "string" ? transport.url : undefined;
	const command =
		typeof transport.command === "string" ? transport.command : undefined;
	const commandLabel = command && !/\s/.test(command) ? command : undefined;
	const env = getRecordValue(transport.env);
	const headers = getRecordValue(transport.headers);
	return {
		handled: true,
		route: "mcp-install",
		requiresConfirmation: true,
		serverName: request.serverName,
		source: request.source,
		transportType: transport.type ?? "stdio",
		...(url ? { urlOrigin: safeUrlOrigin(url) } : {}),
		...(commandLabel ? { command: commandLabel } : {}),
		...(Array.isArray(transport.args) ? { argCount: transport.args.length } : {}),
		...(env ? { envKeys: Object.keys(env).sort() } : {}),
		...(headers ? { headerKeys: Object.keys(headers).sort() } : {}),
	};
}

function parseCursorPreviewUrl(uri: string): URL {
	try {
		return new URL(uri);
	} catch {
		throw new CursorUriError("Invalid Cursor URI");
	}
}

function summarizeCursorUriPreview(
	input: CursorUriPreviewRequest,
): CursorUriPreviewResponse {
	const { uri } = input;
	const parsedUrl = parseCursorPreviewUrl(uri);
	const path = getCursorCompatibleUriPath(parsedUrl);

	if (path === "/mcp/install") {
		return summarizeCursorMcpInstall(uri);
	}

	if (path === "/automation/ingest") {
		const request = buildCursorAutomationIngestRouteRequest(uri);
		const strictFailed =
			request.strict && request.validation.rejectedCount > 0;
		return {
			handled: true,
			route: "automation-ingest",
			requiresConfirmation:
				request.validation.eventCount > 0 && !strictFailed,
			strict: request.strict,
			valid: request.validation.eventCount > 0 && !strictFailed,
			eventCount: request.validation.eventCount,
			rejectedCount: request.validation.rejectedCount,
			options: request.options,
			paramKeys: request.paramKeys,
			configKeys: request.configKeys,
			validation: request.validation,
			taskPrompt: request.taskPrompt,
		};
	}

	if (path === "/settings") {
		const request = buildCursorSettingsRouteRequest(uri);
		return {
			handled: true,
			route: "settings",
			requiresConfirmation: false,
			query: request.query,
			sourceParam: request.sourceParam,
		};
	}

	if (path === "/rule") {
		const request = buildCursorRuleRouteRequest(uri);
		if (request.kind === "file") {
			const ruleFile =
				(input.workspaceRoot || input.workspaceRoots?.length)
					? resolveCursorRuleFileRouteRequest(request, {
							...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
							...(input.workspaceRoots ? { workspaceRoots: input.workspaceRoots } : {}),
							...(input.maxRuleFileBytes !== undefined
								? { maxBytes: input.maxRuleFileBytes }
								: {}),
						})
					: undefined;
			return {
				handled: true,
				route: "rule",
				kind: "file",
				requiresConfirmation: true,
				filename: request.filename,
				relativePath: request.relativePath,
				...(ruleFile
					? {
							ruleFile: {
								filename: ruleFile.filename,
								relativePath: ruleFile.relativePath,
								exists: ruleFile.exists,
								...(ruleFile.byteLength !== undefined
									? { byteLength: ruleFile.byteLength }
									: {}),
								...(ruleFile.lineCount !== undefined
									? { lineCount: ruleFile.lineCount }
									: {}),
								...(ruleFile.tooLarge ? { tooLarge: true } : {}),
							},
						}
					: {}),
			};
		}
		return {
			handled: true,
			route: "rule",
			kind: "review",
			requiresConfirmation: true,
			reason: request.reason,
			name: request.name,
			path: request.path,
		};
	}

	if (path === "/plugin/add") {
		const request = buildCursorPluginAddRouteRequest(uri);
		return {
			handled: true,
			route: "plugin-add",
			requiresConfirmation: true,
			requiresReview: request.requiresReview,
			sourceParam: request.sourceParam,
			sourceConfigKey: request.sourceConfigKey,
			source: safeCursorSourceLabel(request.source, request.sourceParam),
			reason: request.reason,
			paramKeys: Object.keys(request.params).sort(),
			configKeys: getCursorConfigKeys(request.params),
		};
	}

	if (CURSOR_AGENT_TASK_ROUTE_PATHS.has(path)) {
		const request = buildCursorAgentTaskRouteRequest(uri);
		const glass = buildCursorGlassRouteMetadata(request);
		const commandFile =
			(input.workspaceRoot || input.workspaceRoots?.length) &&
			request.kind === "command"
				? resolveCursorCommandFileRouteRequest(request, {
						...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
						...(input.workspaceRoots ? { workspaceRoots: input.workspaceRoots } : {}),
						...(input.maxCommandFileBytes !== undefined
							? { maxBytes: input.maxCommandFileBytes }
							: {}),
					})
				: undefined;
		if (commandFile) {
			return {
				handled: true,
				route: commandFile.kind,
				path: request.path,
				requiresConfirmation: true,
				taskPrompt: commandFile.taskPrompt,
				hasPrompt: false,
				paramKeys: Object.keys(request.params).sort(),
				configKeys: getCursorConfigKeys(request.params),
				commandFile: {
					commandName: commandFile.commandName,
					filename: commandFile.filename,
					relativePath: commandFile.relativePath,
				},
			};
		}
		return {
			handled: true,
			route: request.kind,
			path: request.path,
			requiresConfirmation: true,
			taskPrompt: request.taskPrompt,
			hasPrompt: Boolean(request.prompt),
			paramKeys: Object.keys(request.params).sort(),
			configKeys: getCursorConfigKeys(request.params),
			...(glass ? { glass } : {}),
		};
	}

	throw new CursorUriError(`Unsupported Cursor URI route: ${path}`);
}

/** @internal Exported for unit testing fetch/runtime wiring. */
export class HubServerTransport implements NativeHubTransport {
	private readonly clients = new Map<string, HubClientRecord>();
	private readonly listeners = new Map<
		string,
		Set<{ sessionId?: string; listener: (event: HubEventEnvelope) => void }>
	>();
	private readonly sessionState = new Map<string, HubSessionState>();
	private readonly pendingApprovals = new Map<string, PendingApproval>();
	private readonly pendingCapabilityRequests = new Map<
		string,
		PendingCapabilityRequest
	>();
	private readonly suppressNextTerminalEventBySession = new Map<
		string,
		string
	>();
	private readonly schedules: HubScheduleService;
	private readonly scheduleCommands: HubScheduleCommandService;
	private readonly settings: CoreSettingsService;
	private readonly cronService?: CronService;
	private readonly sessionHost: RuntimeHost &
		Partial<PendingPromptsRuntimeService>;
	private readonly hubId = createSessionId("hub_");
	private readonly ctx: HubTransportContext;

	constructor(readonly options: HubWebSocketServerOptions) {
		this.sessionHost =
			options.sessionHost ??
			new LocalRuntimeHost({
				sessionService: new CoreSessionService(new SqliteSessionStore()),
				fetch: options.fetch,
				telemetry: options.telemetry,
			});
		this.ctx = {
			clients: this.clients,
			sessionState: this.sessionState,
			pendingApprovals: this.pendingApprovals,
			pendingCapabilityRequests: this.pendingCapabilityRequests,
			suppressNextTerminalEventBySession:
				this.suppressNextTerminalEventBySession,
			telemetry: options.telemetry,
			sessionHost: this.sessionHost,
			publish: (event) => this.publish(event),
			buildEvent: buildHubEvent,
			requestCapability: (
				sessionId,
				capabilityName,
				payload,
				targetClientId,
				onProgress,
			) =>
				requestCapabilityHandler(
					this.ctx,
					sessionId,
					capabilityName,
					payload,
					targetClientId,
					onProgress,
				),
		};
		this.schedules = new HubScheduleService({
			...options.scheduleOptions,
			runtimeHandlers: options.runtimeHandlers,
			eventPublisher: (eventType, payload) => {
				const mapped =
					eventType === "schedule.execution.completed"
						? "schedule.execution_completed"
						: eventType === "schedule.execution.failed"
							? "schedule.execution_failed"
							: undefined;
				if (!mapped) {
					return;
				}
				this.publish(
					buildHubEvent(
						mapped,
						payload && typeof payload === "object"
							? (payload as Record<string, unknown>)
							: undefined,
					),
				);
			},
		});
		this.scheduleCommands = new HubScheduleCommandService(this.schedules);
		this.settings = options.settingsService ?? new CoreSettingsService();
		if (options.cronOptions) {
			this.cronService = new CronService({
				runtimeHandlers: options.runtimeHandlers,
				...options.cronOptions,
			});
		}
		this.sessionHost.subscribe((event: CoreSessionEvent) => {
			void projectSessionEvent(this.ctx, event).catch((error) => {
				logHubBoundaryError("session event handling failed", error);
				captureSdkError(this.options.telemetry, {
					component: "core",
					operation: "hub.session_event_project",
					error,
					severity: "error",
					handled: true,
					context: {
						eventType: event.type,
						sessionId: event.payload.sessionId,
					},
				});
			});
		});
	}

	getCronService(): CronService | undefined {
		return this.cronService;
	}

	getHubId(): string {
		return this.hubId;
	}

	async start(): Promise<void> {
		await this.schedules.start();
		if (this.cronService) {
			try {
				await this.cronService.start();
			} catch (err) {
				console.error("[hub] cron service start failed", err);
			}
		}
	}

	async stop(): Promise<void> {
		for (const approvalId of this.pendingApprovals.keys()) {
			resolvePendingApproval(this.ctx, approvalId, {
				approved: false,
				reason: "Hub shutting down before approval was resolved.",
			});
		}
		cancelPendingCapabilityRequests(
			this.ctx,
			() => true,
			"Hub shutting down before capability request was resolved.",
		);
		await this.sessionHost.dispose("hub_server_stop");
		await this.schedules.dispose();
		if (this.cronService) {
			try {
				await this.cronService.dispose();
			} catch (err) {
				console.error("[hub] cron service stop failed", err);
			}
		}
	}

	async handleCommand(envelope: HubCommandEnvelope): Promise<HubReplyEnvelope> {
		try {
			const reply = await this.dispatchCommand(envelope);
			this.captureFailedReply(envelope, reply);
			return reply;
		} catch (error) {
			captureSdkError(this.options.telemetry, {
				component: "core",
				operation: "hub.command",
				error,
				severity: "error",
				handled: false,
				context: this.commandTelemetryContext(envelope),
			});
			throw error;
		}
	}

	private async dispatchCommand(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		switch (envelope.command) {
			case "client.register":
				return handleClientRegister(this.ctx, envelope);
			case "client.update":
				return handleClientUpdate(this.ctx, envelope);
			case "client.unregister":
				return handleClientUnregister(this.ctx, envelope, (clientId) => {
					this.listeners.delete(clientId);
					this.detachClientFromSessions(clientId);
				});
			case "client.list":
				return handleClientList(this.ctx, envelope);
			case "session.create":
				return await handleSessionCreate(
					this.ctx,
					envelope,
					(request: ToolApprovalRequest) =>
						requestToolApprovalHandler(this.ctx, request),
				);
			case "session.restore":
				return await handleSessionRestore(
					this.ctx,
					envelope,
					(request: ToolApprovalRequest) =>
						requestToolApprovalHandler(this.ctx, request),
				);
			case "session.attach":
				return await handleSessionAttach(this.ctx, envelope);
			case "session.detach":
				return await handleSessionDetach(this.ctx, envelope);
			case "session.get":
				return await handleSessionGet(this.ctx, envelope);
			case "session.messages":
				return await handleSessionMessages(this.ctx, envelope);
			case "session.list":
				return await handleSessionList(this.ctx, envelope);
			case "session.update":
				return await handleSessionUpdate(this.ctx, envelope);
			case "session.pending_prompts":
				return await handleSessionPendingPrompts(this.ctx, envelope);
			case "session.update_pending_prompt":
				return await handleSessionUpdatePendingPrompt(this.ctx, envelope);
			case "session.remove_pending_prompt":
				return await handleSessionRemovePendingPrompt(this.ctx, envelope);
			case "session.delete":
				return await handleSessionDelete(this.ctx, envelope);
			case "session.hook":
				return await handleSessionHook(this.ctx, envelope);
			case "run.start":
			case "session.send_input":
				return await handleSessionInput(this.ctx, envelope);
			case "run.abort":
				return await handleRunAbort(this.ctx, envelope);
			case "capability.request":
				return await handleCapabilityRequest(this.ctx, envelope);
			case "approval.respond":
				return await handleApprovalRespond(this.ctx, envelope);
			case "capability.respond":
				return handleCapabilityRespond(this.ctx, envelope);
			case "capability.progress":
				return handleCapabilityProgress(this.ctx, envelope);
			case "ui.notify":
				this.publish(buildHubEvent("ui.notify", envelope.payload ?? {}));
				return okReply(envelope);
			case "ui.show_window":
				this.publish(buildHubEvent("ui.show_window", envelope.payload ?? {}));
				return okReply(envelope);
			case "settings.list":
				return await this.handleSettingsList(envelope);
			case "settings.get":
				return await this.handleSettingsGet(envelope);
			case "settings.toggle":
				return await this.handleSettingsToggle(envelope);
			case "settings.patch":
				return await this.handleSettingsPatch(envelope);
			case "cursor.uri.preview":
				return this.handleCursorUriPreview(envelope);
			case "cron.event.ingest":
				return this.handleCronEventIngest(envelope);
			case "cron.event.list":
				return this.handleCronEventList(envelope);
			case "cron.event.get":
				return this.handleCronEventGet(envelope);
			default: {
				const reply = await this.scheduleCommands.handleCommand(envelope);
				if (reply.ok) {
					const event = eventNameForScheduleCommand(envelope.command);
					if (event) {
						this.publish(buildHubEvent(event, reply.payload));
					}
				}
				return reply;
			}
		}
	}

	private captureFailedReply(
		envelope: HubCommandEnvelope,
		reply: HubReplyEnvelope,
	): void {
		if (
			reply.ok ||
			!reply.error ||
			!shouldCaptureHubReplyError(reply.error.code)
		) {
			return;
		}
		captureSdkError(this.options.telemetry, {
			component: "core",
			operation: "hub.command_reply",
			error: new Error(reply.error.message),
			severity: reply.error.code === "session_not_found" ? "warn" : "error",
			handled: true,
			context: {
				...this.commandTelemetryContext(envelope),
				errorCode: reply.error.code,
			},
		});
	}

	private commandTelemetryContext(envelope: HubCommandEnvelope) {
		return {
			command: envelope.command,
			requestId: envelope.requestId,
			clientId: envelope.clientId,
			sessionId:
				typeof envelope.payload?.sessionId === "string"
					? envelope.payload.sessionId
					: envelope.sessionId,
		};
	}

	private async handleSettingsList(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		try {
			const snapshot = await this.settings.list(
				parseSettingsListInput(envelope.payload),
			);
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: true,
				payload: { snapshot },
			};
		} catch (error) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "settings_list_failed",
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	private async handleSettingsGet(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		try {
			const result = await this.settings.get(
				parseSettingsGetInput(envelope.payload),
			);
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: true,
				payload: {
					type: result.type,
					item: result.item,
					snapshot: result.snapshot,
				},
			};
		} catch (error) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "settings_get_failed",
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	private async handleSettingsToggle(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		try {
			const result = await this.settings.toggle(
				parseSettingsToggleInput(envelope.payload),
			);
			this.publish(
				buildHubEvent("settings.changed", {
					types: result.changedTypes,
					snapshot: result.snapshot,
				}),
			);
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: true,
				payload: {
					snapshot: result.snapshot,
					changedTypes: result.changedTypes,
				},
			};
		} catch (error) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "settings_toggle_failed",
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	private async handleSettingsPatch(
		envelope: HubCommandEnvelope,
	): Promise<HubReplyEnvelope> {
		try {
			const result = await this.settings.patch(
				parseSettingsPatchInput(envelope.payload),
			);
			this.publish(
				buildHubEvent("settings.changed", {
					types: result.changedTypes,
					snapshot: result.snapshot,
				}),
			);
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: true,
				payload: {
					snapshot: result.snapshot,
					changedTypes: result.changedTypes,
				},
			};
		} catch (error) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "settings_patch_failed",
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	private handleCursorUriPreview(envelope: HubCommandEnvelope): HubReplyEnvelope {
		try {
			const input = parseCursorUriPreviewInput(envelope.payload);
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: true,
				payload: summarizeCursorUriPreview(input),
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code:
						error instanceof CursorUriError ||
						error instanceof CursorMcpInstallError
							? "cursor_uri_invalid"
							: "cursor_uri_preview_failed",
					message,
				},
			};
		}
	}

	private handleCronEventIngest(envelope: HubCommandEnvelope): HubReplyEnvelope {
		if (!this.cronService) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "cron_not_enabled",
					message: "cron.event.ingest requires hub cronOptions.",
				},
			};
		}
		try {
			const input = parseCronEventIngestInput(envelope.payload);
			const result = this.cronService.ingestNdjson(input.input, {
				...(input.defaultSource ? { defaultSource: input.defaultSource } : {}),
				...(input.allowedSources ? { allowedSources: input.allowedSources } : {}),
				...(input.maxLineBytes !== undefined
					? { maxLineBytes: input.maxLineBytes }
					: {}),
				...(input.maxEvents !== undefined ? { maxEvents: input.maxEvents } : {}),
			});
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: true,
				payload: summarizeCronEventIngestResult(result),
			};
		} catch (error) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "cron_event_ingest_failed",
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	private handleCronEventList(envelope: HubCommandEnvelope): HubReplyEnvelope {
		if (!this.cronService) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "cron_not_enabled",
					message: "cron.event.list requires hub cronOptions.",
				},
			};
		}
		try {
			const input = parseCronEventListInput(envelope.payload);
			const events = this.cronService.listEventLogs(input.options);
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: true,
				payload: {
					count: events.length,
					events: events.map((event) =>
						summarizeCronEventLog(event, {
							includePayload: input.includePayload,
						}),
					),
				},
			};
		} catch (error) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "cron_event_list_failed",
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	private handleCronEventGet(envelope: HubCommandEnvelope): HubReplyEnvelope {
		if (!this.cronService) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "cron_not_enabled",
					message: "cron.event.get requires hub cronOptions.",
				},
			};
		}
		try {
			const input = parseCronEventGetInput(envelope.payload);
			const event = this.cronService.getEventLog(input.eventId);
			if (!event) {
				return {
					version: envelope.version,
					requestId: envelope.requestId,
					ok: false,
					error: {
						code: "cron_event_not_found",
						message: `Cron event not found: ${input.eventId}`,
					},
				};
			}
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: true,
				payload: {
					event: summarizeCronEventLog(event, {
						includePayload: input.includePayload,
					}),
				},
			};
		} catch (error) {
			return {
				version: envelope.version,
				requestId: envelope.requestId,
				ok: false,
				error: {
					code: "cron_event_get_failed",
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	subscribe(
		clientId: string,
		listener: (event: HubEventEnvelope) => void,
		options?: { sessionId?: string },
	): () => void {
		const current = this.listeners.get(clientId) ?? new Set();
		const entry = { sessionId: options?.sessionId, listener };
		current.add(entry);
		this.listeners.set(clientId, current);
		return () => {
			const listeners = this.listeners.get(clientId);
			if (!listeners) {
				return;
			}
			listeners.delete(entry);
			if (listeners.size === 0) {
				this.listeners.delete(clientId);
			}
		};
	}

	private detachClientFromSessions(clientId: string): void {
		for (const [sessionId, state] of this.sessionState.entries()) {
			state.participants.delete(clientId);
			if (state.participants.size === 0) {
				this.sessionState.delete(sessionId);
			}
		}
		cancelPendingCapabilityRequests(
			this.ctx,
			(request) => request.targetClientId === clientId,
			`Capability owner client ${clientId} disconnected before request was resolved.`,
		);
	}

	private publish(event: HubEventEnvelope): void {
		for (const entries of this.listeners.values()) {
			for (const entry of entries) {
				if (entry.sessionId && entry.sessionId !== event.sessionId) {
					continue;
				}
				try {
					entry.listener(event);
				} catch (error) {
					logHubBoundaryError(
						`listener threw while publishing ${event.event}`,
						error,
					);
					captureSdkError(this.options.telemetry, {
						component: "core",
						operation: "hub.publish",
						error,
						severity: "warn",
						handled: true,
						context: {
							event: event.event,
							sessionId: event.sessionId,
						},
					});
				}
			}
		}
	}
}

function shouldCaptureHubReplyError(code: string): boolean {
	return (
		code === "session_not_found" ||
		code === "session_messages_not_found" ||
		code === "hub_command_timeout" ||
		code.endsWith("_failed")
	);
}
