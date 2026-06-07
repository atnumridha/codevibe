import type {
	ClineAutomationNdjsonIngressResult,
	CursorAutomationIngestRouteRequest,
} from "@cline/core";
import {
	buildCursorAutomationIngestRouteRequest,
	ClineCore,
} from "@cline/core";
import { workspaceRoot } from "./deps";
import type { JsonRecord } from "./types";
import { asTrimmedString } from "./utils";

function summarizeAutomationIngestResult(
	result: ClineAutomationNdjsonIngressResult | undefined,
): {
	queuedRunCount: number;
	duplicateCount: number;
	matchedSpecIds: string[];
} {
	if (!result) {
		return {
			queuedRunCount: 0,
			duplicateCount: 0,
			matchedSpecIds: [],
		};
	}
	const matchedSpecIds = new Set<string>();
	let queuedRunCount = 0;
	let duplicateCount = 0;
	for (const entry of result.results) {
		if (entry.duplicate) {
			duplicateCount += 1;
		}
		queuedRunCount += entry.queuedRuns.length;
		for (const specId of entry.matchedSpecIds) {
			matchedSpecIds.add(specId);
		}
	}
	return {
		queuedRunCount,
		duplicateCount,
		matchedSpecIds: [...matchedSpecIds].sort(),
	};
}

function buildCursorAutomationIngestResponse(
	request: CursorAutomationIngestRouteRequest,
	input: {
		confirmed: boolean;
		workspaceRoot: string;
		result?: ClineAutomationNdjsonIngressResult;
	},
): JsonRecord {
	const strictFailed = request.strict && request.validation.rejectedCount > 0;
	const valid = request.validation.eventCount > 0 && !strictFailed;
	const resultSummary = summarizeAutomationIngestResult(input.result);
	return {
		handled: true,
		route: "automation-ingest",
		confirmed: input.confirmed,
		ingested: Boolean(input.result),
		valid,
		strict: request.strict,
		strictFailed,
		eventCount: request.validation.eventCount,
		rejectedCount: request.validation.rejectedCount,
		queuedRunCount: resultSummary.queuedRunCount,
		duplicateCount: resultSummary.duplicateCount,
		matchedSpecIds: resultSummary.matchedSpecIds,
		options: request.options,
		paramKeys: request.paramKeys,
		configKeys: request.configKeys,
		events: request.validation.events,
		rejected: request.validation.rejected,
		workspaceRoot: input.workspaceRoot,
	};
}

export async function ingestCursorAutomation(
	args?: JsonRecord,
): Promise<JsonRecord> {
	const uri = asTrimmedString(args?.uri);
	if (!uri) {
		throw new Error("cursor_automation_ingest requires a non-empty uri");
	}
	const requestedWorkspaceRoot =
		asTrimmedString(args?.workspaceRoot) ?? workspaceRoot;
	const request = buildCursorAutomationIngestRouteRequest(uri);
	const confirmed = args?.confirmed === true;
	const strictFailed = request.strict && request.validation.rejectedCount > 0;
	const valid = request.validation.eventCount > 0 && !strictFailed;
	const preview = buildCursorAutomationIngestResponse(request, {
		confirmed,
		workspaceRoot: requestedWorkspaceRoot,
	});
	if (!confirmed || !valid) {
		return preview;
	}

	const core = await ClineCore.create({
		clientName: "codevibe-hub-cursor-automation-ingest",
		backendMode: "local",
		automation: {
			workspaceRoot: requestedWorkspaceRoot,
		},
	});
	try {
		const result = core.automation.ingestNdjson(
			request.ndjson,
			request.options,
		);
		return buildCursorAutomationIngestResponse(request, {
			confirmed: true,
			workspaceRoot: requestedWorkspaceRoot,
			result,
		});
	} finally {
		await core.dispose("cursor_automation_ingest_done");
	}
}
