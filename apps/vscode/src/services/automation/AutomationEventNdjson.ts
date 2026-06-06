export type AutomationEventNdjsonRejectReason =
	| "invalid_json"
	| "not_object"
	| "missing_field"
	| "source_not_allowed"
	| "line_too_large"
	| "too_many_events"

export interface AutomationEventEnvelope {
	eventId: string
	eventType: string
	source: string
	occurredAt: string
	subject?: string
	workspaceRoot?: string
	payload?: Record<string, unknown>
	attributes?: Record<string, unknown>
	dedupeKey?: string
}

export interface AutomationEventNdjsonRejectedLine {
	lineNumber: number
	line: string
	reason: AutomationEventNdjsonRejectReason
	message: string
}

export interface AutomationEventNdjsonParseResult {
	events: AutomationEventEnvelope[]
	rejected: AutomationEventNdjsonRejectedLine[]
}

export interface ParseAutomationEventNdjsonOptions {
	defaultSource?: string
	allowedSources?: readonly string[]
	maxLineBytes?: number
	maxEvents?: number
	now?: () => number
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
	for (const key of keys) {
		const value = record[key]
		if (typeof value !== "string") {
			continue
		}
		const trimmed = value.trim()
		if (trimmed) {
			return trimmed
		}
	}
	return undefined
}

function readRecord(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> | undefined {
	for (const key of keys) {
		const value = record[key]
		if (isRecord(value)) {
			return value
		}
	}
	return undefined
}

function hasEventShape(record: Record<string, unknown>): boolean {
	return !!readString(record, ["eventId", "event_id", "id"]) && !!readString(record, ["eventType", "event_type", "type"])
}

function normalizeAllowedSources(allowedSources: readonly string[] | undefined): Set<string> | undefined {
	if (!allowedSources || allowedSources.length === 0) {
		return undefined
	}
	const normalized = allowedSources.map((source) => source.trim().toLowerCase()).filter(Boolean)
	return normalized.length > 0 ? new Set(normalized) : undefined
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
	if (value === undefined || !Number.isFinite(value)) {
		return undefined
	}
	const normalized = Math.floor(value)
	return normalized > 0 ? normalized : undefined
}

function unwrapAutomationEventCandidate(record: Record<string, unknown>): Record<string, unknown> | undefined {
	if (hasEventShape(record)) {
		return record
	}

	for (const key of ["payload", "event", "data"] as const) {
		const value = record[key]
		if (isRecord(value) && hasEventShape(value)) {
			return value
		}
	}

	return undefined
}

function toAutomationEventEnvelope(
	record: Record<string, unknown>,
	options: ParseAutomationEventNdjsonOptions,
): AutomationEventEnvelope | { error: string } {
	const eventId = readString(record, ["eventId", "event_id", "id"])
	const eventType = readString(record, ["eventType", "event_type", "type"])
	const source = readString(record, ["source", "provider"]) ?? options.defaultSource?.trim()

	if (!eventId) {
		return { error: "automation event requires eventId" }
	}
	if (!eventType) {
		return { error: "automation event requires eventType" }
	}
	if (!source) {
		return { error: "automation event requires source" }
	}

	const nowIso = new Date((options.now ?? Date.now)()).toISOString()
	const occurredAt = readString(record, ["occurredAt", "occurred_at", "timestamp", "time"]) ?? nowIso
	const subject = readString(record, ["subject"])
	const workspaceRoot = readString(record, ["workspaceRoot", "workspace_root", "cwd"])
	const dedupeKey = readString(record, ["dedupeKey", "dedupe_key"])
	const payload = readRecord(record, ["payload", "data"])
	const attributes = readRecord(record, ["attributes", "attrs"])

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
	}
}

export function parseAutomationEventNdjson(
	input: string,
	options: ParseAutomationEventNdjsonOptions = {},
): AutomationEventNdjsonParseResult {
	const events: AutomationEventEnvelope[] = []
	const rejected: AutomationEventNdjsonRejectedLine[] = []
	const lines = input.split(/\r?\n/)
	const allowedSources = normalizeAllowedSources(options.allowedSources)
	const maxLineBytes = normalizePositiveInteger(options.maxLineBytes)
	const maxEvents = normalizePositiveInteger(options.maxEvents)

	lines.forEach((rawLine, index) => {
		const line = rawLine.trim()
		if (!line) {
			return
		}
		if (maxLineBytes && Buffer.byteLength(line, "utf8") > maxLineBytes) {
			rejected.push({
				lineNumber: index + 1,
				line,
				reason: "line_too_large",
				message: `NDJSON automation event line exceeds ${maxLineBytes} byte limit`,
			})
			return
		}

		let parsed: unknown
		try {
			parsed = JSON.parse(line) as unknown
		} catch (error) {
			rejected.push({
				lineNumber: index + 1,
				line,
				reason: "invalid_json",
				message: error instanceof Error ? error.message : String(error),
			})
			return
		}

		if (!isRecord(parsed)) {
			rejected.push({
				lineNumber: index + 1,
				line,
				reason: "not_object",
				message: "NDJSON automation event line must be a JSON object",
			})
			return
		}

		const candidate = unwrapAutomationEventCandidate(parsed)
		if (!candidate) {
			rejected.push({
				lineNumber: index + 1,
				line,
				reason: "missing_field",
				message: "automation event requires eventId and eventType",
			})
			return
		}

		const event = toAutomationEventEnvelope(candidate, options)
		if ("error" in event) {
			rejected.push({
				lineNumber: index + 1,
				line,
				reason: "missing_field",
				message: event.error,
			})
			return
		}
		if (allowedSources && !allowedSources.has(event.source.toLowerCase())) {
			rejected.push({
				lineNumber: index + 1,
				line,
				reason: "source_not_allowed",
				message: `automation event source "${event.source}" is not allowed`,
			})
			return
		}
		if (maxEvents && events.length >= maxEvents) {
			rejected.push({
				lineNumber: index + 1,
				line,
				reason: "too_many_events",
				message: `NDJSON automation event input exceeds ${maxEvents} event limit`,
			})
			return
		}

		events.push(event)
	})

	return { events, rejected }
}
