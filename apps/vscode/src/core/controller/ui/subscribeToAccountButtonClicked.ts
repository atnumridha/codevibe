import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import type { StreamingResponseHandler } from "../grpc-handler"
import type { Controller } from "../index"
import { createBufferedSubscription } from "./bufferedSubscription"

const accountButtonClickedSubscription = createBufferedSubscription<Empty>({
	logLabel: "accountButtonClicked",
	registryType: "accountButtonClicked_subscription",
})

/**
 * Subscribe to account button clicked events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The request ID for cleanup
 */
export async function subscribeToAccountButtonClicked(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<Empty>,
	requestId?: string,
): Promise<void> {
	await accountButtonClickedSubscription.subscribe(responseStream, requestId)
}

/**
 * Send an account button clicked event to all active subscribers
 */
export async function sendAccountButtonClickedEvent(): Promise<void> {
	await accountButtonClickedSubscription.send(Empty.create({}))
}
