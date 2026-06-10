import type { EmptyRequest } from "@shared/proto/cline/common"
import { getCursorNdjsonIngestBridge } from "@/services/automation/CursorNdjsonIngestBridge"
import { CursorNdjsonIngestStatus } from "@/shared/proto/cline/ui"
import type { Controller } from "../index"
import { toCursorNdjsonIngestStatus } from "./cursorNdjsonIngest"

export async function reassignCursorNdjsonIngestPort(
	_controller: Controller,
	_request: EmptyRequest,
): Promise<CursorNdjsonIngestStatus> {
	return toCursorNdjsonIngestStatus(await getCursorNdjsonIngestBridge().reassignPort())
}
