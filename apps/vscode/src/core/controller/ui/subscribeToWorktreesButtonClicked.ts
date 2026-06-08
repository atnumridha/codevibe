import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import type { StreamingResponseHandler } from "../grpc-handler"
import type { Controller } from "../index"
import { createBufferedSubscription } from "./bufferedSubscription"

const worktreesButtonClickedSubscription = createBufferedSubscription<Empty>({
	logLabel: "worktrees button clicked",
	registryType: "worktrees_button_clicked_subscription",
})

/**
 * Subscribe to worktrees button clicked events
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToWorktreesButtonClicked(
	_controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<Empty>,
	requestId?: string,
): Promise<void> {
	await worktreesButtonClickedSubscription.subscribe(responseStream, requestId)
}

/**
 * Send a worktrees button clicked event to all active subscribers
 */
export async function sendWorktreesButtonClickedEvent(): Promise<void> {
	await worktreesButtonClickedSubscription.send(Empty.create({}))
}
