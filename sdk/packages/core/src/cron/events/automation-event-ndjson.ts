import type { AutomationEventEnvelope } from "@cline/shared";

export type AutomationEventNdjsonRejectReason =
	| "invalid_json"
	| "not_object"
	| "missing_field";

export interface AutomationEventNdjsonRejectedLine {
	lineNumber: number;
	line: string;
	reason: AutomationEventNdjsonRejectReason;
	message: string;
}

export interface AutomationEventNdjsonParseResult {
	events: AutomationEventEnvelope[];
	rejected: AutomationEventNdjsonRejectedLine[];
}

export interface ParseAutomationEventNdjsonOptions {
	defaultSource?: string;
	now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(
	record: Record<string, unknown>,
	keys: readonly string[],
): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value !== "string") continue;
		const trimmed = value.trim();
		if (trimmed) return trimmed;
	}
	return undefined;
}

function readRecord(
	record: Record<string, unknown>,
	keys: readonly string[],
): Record<string, unknown> | undefined {
	for (const key of keys) {
		const value = record[key];
		if (isRecord(value)) return value;
	}
	return undefined;
}

function hasEventShape(record: Record<string, unknown>): boolean {
	return (
		!!readString(record, ["eventId", "event_id", "id"]) &&
		!!readString(record, ["eventType", "event_type", "type"])
	);
}

function unwrapAutomationEventCandidate(
	record: Record<string, unknown>,
): Record<string, unknown> | undefined {
	if (hasEventShape(record)) return record;

	for (const key of ["payload", "event", "data"] as const) {
		const value = record[key];
		if (isRecord(value) && hasEventShape(value)) return value;
	}

	return undefined;
}

function toAutomationEventEnvelope(
	record: Record<string, unknown>,
	options: ParseAutomationEventNdjsonOptions,
): AutomationEventEnvelope | { error: string } {
	const eventId = readString(record, ["eventId", "event_id", "id"]);
	const eventType = readString(record, ["eventType", "event_type", "type"]);
	const source =
		readString(record, ["source", "provider"]) ?? options.defaultSource?.trim();

	if (!eventId) return { error: "automation event requires eventId" };
	if (!eventType) return { error: "automation event requires eventType" };
	if (!source) return { error: "automation event requires source" };

	const nowIso = new Date((options.now ?? Date.now)()).toISOString();
	const occurredAt =
		readString(record, ["occurredAt", "occurred_at", "timestamp", "time"]) ??
		nowIso;
	const subject = readString(record, ["subject"]);
	const workspaceRoot = readString(record, [
		"workspaceRoot",
		"workspace_root",
		"cwd",
	]);
	const dedupeKey = readString(record, ["dedupeKey", "dedupe_key"]);
	const payload = readRecord(record, ["payload", "data"]);
	const attributes = readRecord(record, ["attributes", "attrs"]);

	return {
		eventId,
		eventType,
		source,
		occurredAt,
		...(subject ? { subject } : {}),
		...(workspaceRoot ? { workspaceRoot } : {}),
		...(payload ? { payload } : {}),
		...(attributes ? { attributes } : {}),
		...(dedupeKey ? { dedupeKey } : {}),
	};
}

export function parseAutomationEventNdjson(
	input: string,
	options: ParseAutomationEventNdjsonOptions = {},
): AutomationEventNdjsonParseResult {
	const events: AutomationEventEnvelope[] = [];
	const rejected: AutomationEventNdjsonRejectedLine[] = [];
	const lines = input.split(/\r?\n/);

	lines.forEach((rawLine, index) => {
		const line = rawLine.trim();
		if (!line) return;

		let parsed: unknown;
		try {
			parsed = JSON.parse(line) as unknown;
		} catch (error) {
			rejected.push({
				lineNumber: index + 1,
				line,
				reason: "invalid_json",
				message: error instanceof Error ? error.message : String(error),
			});
			return;
		}

		if (!isRecord(parsed)) {
			rejected.push({
				lineNumber: index + 1,
				line,
				reason: "not_object",
				message: "NDJSON automation event line must be a JSON object",
			});
			return;
		}

		const candidate = unwrapAutomationEventCandidate(parsed);
		if (!candidate) {
			rejected.push({
				lineNumber: index + 1,
				line,
				reason: "missing_field",
				message: "automation event requires eventId and eventType",
			});
			return;
		}

		const event = toAutomationEventEnvelope(candidate, options);
		if ("error" in event) {
			rejected.push({
				lineNumber: index + 1,
				line,
				reason: "missing_field",
				message: event.error,
			});
			return;
		}

		events.push(event);
	});

	return { events, rejected };
}
