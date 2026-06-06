import { BooleanResponse, type StringRequest } from "@shared/proto/cline/common"
import { SharedUriHandler } from "@/services/uri/SharedUriHandler"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * Handles Cline and Cursor-compatible deep links for external/standalone clients.
 */
export async function handleUri(_controller: Controller, request: StringRequest): Promise<BooleanResponse> {
	const value = request.value?.trim()
	if (!value) {
		return BooleanResponse.create({ value: false })
	}

	try {
		return BooleanResponse.create({ value: await SharedUriHandler.handleUriWithController(_controller, value) })
	} catch (error) {
		Logger.error("Failed to handle URI:", error)
		return BooleanResponse.create({ value: false })
	}
}
