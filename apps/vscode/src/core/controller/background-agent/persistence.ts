import {
	isBackgroundAgentTaskRecord,
	type BackgroundAgentTaskRecord,
} from "@shared/BackgroundAgent"

export const MAX_BACKGROUND_AGENT_TASK_RECORDS = 100

function compareByCreatedAt(a: BackgroundAgentTaskRecord, b: BackgroundAgentTaskRecord): number {
	return a.createdAt - b.createdAt || a.updatedAt - b.updatedAt || a.id.localeCompare(b.id)
}

export function normalizeBackgroundAgentTaskRecords(value: unknown): BackgroundAgentTaskRecord[] {
	if (!Array.isArray(value)) {
		return []
	}

	const recordsById = new Map<string, BackgroundAgentTaskRecord>()
	for (const item of value) {
		if (!isBackgroundAgentTaskRecord(item)) {
			continue
		}

		const existing = recordsById.get(item.id)
		if (!existing || item.updatedAt >= existing.updatedAt) {
			recordsById.set(item.id, { ...item })
		}
	}

	return Array.from(recordsById.values()).sort(compareByCreatedAt).slice(-MAX_BACKGROUND_AGENT_TASK_RECORDS)
}

export function upsertBackgroundAgentTaskRecord(
	existing: Iterable<BackgroundAgentTaskRecord>,
	record: BackgroundAgentTaskRecord,
): BackgroundAgentTaskRecord[] {
	return normalizeBackgroundAgentTaskRecords([...existing, record])
}
