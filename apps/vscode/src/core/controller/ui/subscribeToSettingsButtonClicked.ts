import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import type { StreamingResponseHandler } from "../grpc-handler"
import type { Controller } from "../index"
import { createBufferedSubscription } from "./bufferedSubscription"

const settingsButtonClickedSubscription = createBufferedSubscription<Empty>({
	logLabel: "settings button clicked",
	registryType: "settings_button_clicked_subscription",
})

/**
 * Subscribe to settings button clicked events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToSettingsButtonClicked(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<Empty>,
	requestId?: string,
): Promise<void> {
	await settingsButtonClickedSubscription.subscribe(responseStream, requestId)
}

/**
 * Send a settings button clicked event to all active subscribers
 */
export async function sendSettingsButtonClickedEvent(): Promise<void> {
	await settingsButtonClickedSubscription.send(Empty.create({}))
}
