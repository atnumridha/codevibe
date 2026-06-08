import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import type { StreamingResponseHandler } from "../grpc-handler"
import type { Controller } from "../index"
import { createBufferedSubscription } from "./bufferedSubscription"

const mcpButtonClickedSubscription = createBufferedSubscription<Empty>({
	logLabel: "mcpButtonClicked",
	registryType: "mcpButtonClicked_subscription",
})

/**
 * Subscribe to mcpButtonClicked events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToMcpButtonClicked(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<Empty>,
	requestId?: string,
): Promise<void> {
	await mcpButtonClickedSubscription.subscribe(responseStream, requestId)
}

/**
 * Send a mcpButtonClicked event to all active subscribers
 */
export async function sendMcpButtonClickedEvent(): Promise<void> {
	await mcpButtonClickedSubscription.send(Empty.create({}))
}
