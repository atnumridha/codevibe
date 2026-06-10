import type { CursorNdjsonIngestServerStatus } from "@/services/automation/CursorNdjsonIngestServer"
import { CursorNdjsonIngestStatus } from "@/shared/proto/cline/ui"

export function toCursorNdjsonIngestStatus(status: CursorNdjsonIngestServerStatus): CursorNdjsonIngestStatus {
	return CursorNdjsonIngestStatus.create({
		running: status.running,
		bindAddress: status.bindAddress,
		port: status.port ?? 0,
		url: status.url ?? "",
	})
}
