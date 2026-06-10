import { BooleanResponse, type StringRequest } from "@shared/proto/cline/common"
import { SharedUriHandler } from "@/services/uri/SharedUriHandler"
import { Logger } from "@/shared/services/Logger"
import { getCodeVibeConfigurationValue } from "@/utils/codevibe-config"
import type { Controller } from "../index"

/**
 * Handles editor-compatible deep links for external/standalone clients.
 */
export async function handleUri(_controller: Controller, request: StringRequest): Promise<BooleanResponse> {
	const value = request.value?.trim()
	if (!value) {
		return BooleanResponse.create({ value: false })
	}

	try {
		const cursorDeepLinksEnabled = getCodeVibeConfigurationValue<boolean>(
			"cursorCompatibility.deepLinks.enabled",
			true,
		)
		return BooleanResponse.create({
			value: await SharedUriHandler.handleUriWithController(_controller, value, {
				cursorCompatibleDeepLinksEnabled: cursorDeepLinksEnabled,
			}),
		})
	} catch (error) {
		Logger.error("Failed to handle URI:", error)
		return BooleanResponse.create({ value: false })
	}
}
