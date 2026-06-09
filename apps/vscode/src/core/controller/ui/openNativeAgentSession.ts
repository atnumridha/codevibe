import type { EmptyRequest } from "@shared/proto/cline/common"
import { Empty } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * Opens CodeVibe's preferred native agent session from the legacy webview.
 */
export async function openNativeAgentSession(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	try {
		await HostProvider.workspace.openNativeAgentSession({})
		telemetryService.captureButtonClick("webview_openNativeAgentSession")
		return Empty.create({})
	} catch (error) {
		Logger.error(`Failed to open CodeVibe native agent session: ${error}`)
		throw error
	}
}
