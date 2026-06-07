import {
	buildCursorPluginAddRouteRequest,
	installPlugin,
	type CursorPluginAddRouteRequest,
} from "@cline/core";
import { workspaceRoot } from "./deps";
import type { JsonRecord } from "./types";
import { asTrimmedString } from "./utils";

function getRecordValue(value: unknown): JsonRecord | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as JsonRecord)
		: undefined;
}

function safeCursorPluginSourceLabel(
	source: string | undefined,
	sourceParam: CursorPluginAddRouteRequest["sourceParam"],
): string | undefined {
	if (!source) {
		return undefined;
	}
	if (sourceParam !== "url" && sourceParam !== "config") {
		return source;
	}
	try {
		return new URL(source).origin;
	} catch {
		return sourceParam === "url" ? "[provided]" : source;
	}
}

function buildCursorPluginAddResponse(
	request: CursorPluginAddRouteRequest,
	input: {
		confirmed: boolean;
		installed: boolean;
		workspaceRoot: string;
		result?: { installPath: string; entryPaths: string[] };
	},
): JsonRecord {
	const config = getRecordValue(request.params.config);
	const sourceLabel = safeCursorPluginSourceLabel(
		request.source,
		request.sourceParam,
	);
	return {
		handled: true,
		route: "plugin-add",
		confirmed: input.confirmed,
		installed: input.installed,
		actionable: !request.requiresReview && Boolean(request.source),
		requiresReview: request.requiresReview,
		workspaceRoot: input.workspaceRoot,
		...(request.sourceParam ? { sourceParam: request.sourceParam } : {}),
		...(request.sourceConfigKey
			? { sourceConfigKey: request.sourceConfigKey }
			: {}),
		...(sourceLabel ? { sourceLabel } : {}),
		...(request.reason ? { reason: request.reason } : {}),
		...(request.requiresReview ? { detail: request.detail } : {}),
		paramKeys: Object.keys(request.params).sort(),
		configKeys: Object.keys(config ?? {}).sort(),
		...(input.result
			? {
					installPath: input.result.installPath,
					entryCount: input.result.entryPaths.length,
					entryPaths: input.result.entryPaths,
				}
			: {}),
	};
}

export async function addCursorPlugin(args?: JsonRecord): Promise<JsonRecord> {
	const uri = asTrimmedString(args?.uri);
	if (!uri) {
		throw new Error("cursor_plugin_add requires a non-empty uri");
	}
	const requestedWorkspaceRoot =
		asTrimmedString(args?.workspaceRoot) ?? workspaceRoot;
	const request = buildCursorPluginAddRouteRequest(uri);
	const confirmed = args?.confirmed === true;
	const preview = buildCursorPluginAddResponse(request, {
		confirmed,
		installed: false,
		workspaceRoot: requestedWorkspaceRoot,
	});
	if (!confirmed || request.requiresReview || !request.source) {
		return preview;
	}

	const result = await installPlugin({
		source: request.source,
		cwd: requestedWorkspaceRoot,
		force: args?.force === true,
		io: {
			writeln: () => undefined,
			writeErr: () => undefined,
		},
	});
	return buildCursorPluginAddResponse(request, {
		confirmed: true,
		installed: true,
		workspaceRoot: requestedWorkspaceRoot,
		result,
	});
}
