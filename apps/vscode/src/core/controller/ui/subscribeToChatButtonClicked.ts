import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import type { StreamingResponseHandler } from "../grpc-handler"
import type { Controller } from "../index"
import { createBufferedSubscription } from "./bufferedSubscription"

const chatButtonClickedSubscription = createBufferedSubscription<Empty>({
	logLabel: "chatButtonClicked",
	registryType: "chatButtonClicked_subscription",
})

/**
 * Subscribe to chatButtonClicked events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToChatButtonClicked(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<Empty>,
	requestId?: string,
): Promise<void> {
	await chatButtonClickedSubscription.subscribe(responseStream, requestId)
}

/**
 * Send a chatButtonClicked event to all active subscribers
 */
export async function sendChatButtonClickedEvent(): Promise<void> {
	await chatButtonClickedSubscription.send(Empty.create({}))
}
