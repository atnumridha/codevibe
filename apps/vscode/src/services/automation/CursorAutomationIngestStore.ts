import fs from "fs/promises"
import path from "path"
import type {
	AutomationEventEnvelope,
	AutomationEventNdjsonRejectedLine,
} from "./AutomationEventNdjson"

export interface CursorAutomationIngestRequest {
	strict: boolean
	validation: {
		events: AutomationEventEnvelope[]
		rejected: AutomationEventNdjsonRejectedLine[]
	}
	paramKeys: string[]
	configKeys: string[]
	options?: {
		defaultSource?: string
		allowedSources?: readonly string[]
		maxLineBytes?: number
		maxEvents?: number
	}
}

export interface CursorAutomationEventSummary {
	eventId: string
	eventType: string
	source: string
	occurredAt: string
	subject?: string
	workspaceRoot?: string
	dedupeKey?: string
	payloadKeys?: string[]
	attributeKeys?: string[]
}

export interface CursorAutomationRejectedSummary {
	lineNumber: number
	reason: string
	message: string
	lineLength: number
}

export interface CursorAutomationIngestResult {
	accepted: number
	rejected: number
	stored: number
	duplicates: number
	strict: boolean
	strictFailed: boolean
	storePath: string
	paramKeys: string[]
	configKeys: string[]
	defaultSource?: string
	allowedSources?: readonly string[]
	maxLineBytes?: number
	maxEvents?: number
	events: CursorAutomationEventSummary[]
	rejectedLines: CursorAutomationRejectedSummary[]
}

function recordKeys(value: unknown): string[] | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined
	}
	const keys = Object.keys(value).sort()
	return keys.length > 0 ? keys : undefined
}

function summarizeEvent(event: AutomationEventEnvelope): CursorAutomationEventSummary {
	const payloadKeys = recordKeys(event.payload)
	const attributeKeys = recordKeys(event.attributes)
	return {
		eventId: event.eventId,
		eventType: event.eventType,
		source: event.source,
		occurredAt: event.occurredAt,
		...(event.subject ? { subject: event.subject } : {}),
		...(event.workspaceRoot ? { workspaceRoot: event.workspaceRoot } : {}),
		...(event.dedupeKey ? { dedupeKey: event.dedupeKey } : {}),
		...(payloadKeys ? { payloadKeys } : {}),
		...(attributeKeys ? { attributeKeys } : {}),
	}
}

function summarizeRejectedLine(line: AutomationEventNdjsonRejectedLine): CursorAutomationRejectedSummary {
	return {
		lineNumber: line.lineNumber,
		reason: line.reason,
		message: line.message,
		lineLength: line.line.length,
	}
}

async function readExistingEventIds(storePath: string): Promise<Set<string>> {
	const ids = new Set<string>()
	let raw = ""
	try {
		raw = await fs.readFile(storePath, "utf8")
	} catch (error) {
		const code =
			error && typeof error === "object" && "code" in error
				? (error as { code?: unknown }).code
				: undefined
		if (code === "ENOENT") {
			return ids
		}
		throw error
	}

	for (const line of raw.split(/\r?\n/)) {
		if (!line.trim()) {
			continue
		}
		try {
			const parsed = JSON.parse(line) as unknown
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				continue
			}
			const event = (parsed as Record<string, unknown>).event
			if (event && typeof event === "object" && !Array.isArray(event)) {
				const eventId = (event as Record<string, unknown>).eventId
				if (typeof eventId === "string" && eventId) {
					ids.add(eventId)
				}
			}
		} catch {
			// Ignore corrupted historical lines; keep future ingest usable.
		}
	}
	return ids
}

export function resolveCursorAutomationIngestStorePath(storageDir: string): string {
	return path.join(storageDir, "cursor-automation", "events.ndjson")
}

export async function ingestCursorAutomationEvents(
	storageDir: string,
	request: CursorAutomationIngestRequest,
	now: () => number = Date.now,
): Promise<CursorAutomationIngestResult> {
	const storePath = resolveCursorAutomationIngestStorePath(storageDir)
	const strictFailed = request.strict && request.validation.rejected.length > 0
	const baseResult = {
		accepted: request.validation.events.length,
		rejected: request.validation.rejected.length,
		strict: request.strict,
		strictFailed,
		storePath,
		paramKeys: request.paramKeys,
		configKeys: request.configKeys,
		...(request.options?.defaultSource ? { defaultSource: request.options.defaultSource } : {}),
		...(request.options?.allowedSources ? { allowedSources: request.options.allowedSources } : {}),
		...(request.options?.maxLineBytes ? { maxLineBytes: request.options.maxLineBytes } : {}),
		...(request.options?.maxEvents ? { maxEvents: request.options.maxEvents } : {}),
		events: request.validation.events.map(summarizeEvent),
		rejectedLines: request.validation.rejected.map(summarizeRejectedLine),
	}

	if (strictFailed || request.validation.events.length === 0) {
		return {
			...baseResult,
			stored: 0,
			duplicates: 0,
		}
	}

	await fs.mkdir(path.dirname(storePath), { recursive: true })
	const existingIds = await readExistingEventIds(storePath)
	const ingestedAt = new Date(now()).toISOString()
	const lines: string[] = []
	let duplicates = 0
	for (const event of request.validation.events) {
		if (existingIds.has(event.eventId)) {
			duplicates += 1
			continue
		}
		existingIds.add(event.eventId)
		lines.push(JSON.stringify({ ingestedAt, event }))
	}

	if (lines.length > 0) {
		await fs.appendFile(storePath, `${lines.join("\n")}\n`, "utf8")
	}

	return {
		...baseResult,
		stored: lines.length,
		duplicates,
	}
}
