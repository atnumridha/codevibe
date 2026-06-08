import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import type { StreamingResponseHandler } from "../grpc-handler"
import type { Controller } from "../index"
import { createBufferedSubscription } from "./bufferedSubscription"

const historyButtonClickedSubscription = createBufferedSubscription<Empty>({
	logLabel: "history button clicked",
	registryType: "history_button_clicked_subscription",
})

/**
 * Subscribe to history button clicked events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToHistoryButtonClicked(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<Empty>,
	requestId?: string,
): Promise<void> {
	await historyButtonClickedSubscription.subscribe(responseStream, requestId)
}

/**
 * Send a history button clicked event to all active subscribers
 */
export async function sendHistoryButtonClickedEvent(): Promise<void> {
	await historyButtonClickedSubscription.send(Empty.create({}))
}
