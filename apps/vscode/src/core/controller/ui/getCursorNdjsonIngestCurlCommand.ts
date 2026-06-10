import type { EmptyRequest } from "@shared/proto/cline/common"
import { String } from "@shared/proto/cline/common"
import { getCursorNdjsonIngestBridge } from "@/services/automation/CursorNdjsonIngestBridge"
import type { Controller } from "../index"

export async function getCursorNdjsonIngestCurlCommand(
	_controller: Controller,
	_request: EmptyRequest,
): Promise<String> {
	return String.create({ value: await getCursorNdjsonIngestBridge().buildCurlCommand() })
}
