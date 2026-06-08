import type { EmptyRequest, String as ProtoString } from "@shared/proto/cline/common"
import type { StreamingResponseHandler } from "../grpc-handler"
import type { Controller } from "../index"
import { createBufferedSubscription } from "./bufferedSubscription"

const addToInputSubscription = createBufferedSubscription<ProtoString>({
	logLabel: "addToInput",
	registryType: "addToInput_subscription",
	maxPending: 20,
})

/**
 * Subscribe to addToInput events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToAddToInput(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<ProtoString>,
	requestId?: string,
): Promise<void> {
	await addToInputSubscription.subscribe(responseStream, requestId)
}

/**
 * Send an addToInput event to all active subscribers
 * @param text The text to add to the input
 */
export async function sendAddToInputEvent(text: string): Promise<void> {
	await addToInputSubscription.send({ value: text })
}
