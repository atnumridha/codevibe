import { EmptyRequest } from "@shared/proto/cline/common"
import { State } from "@shared/proto/cline/state"
import { telemetryService } from "@/services/telemetry"
import { ExtensionState } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

// Keep track of active state subscriptions
const activeStateSubscriptions = new Set<StreamingResponseHandler<State>>()
let e2eInitialStateOverride: ExtensionState | undefined

export function setE2EInitialStateOverride(state: ExtensionState | undefined): void {
	if (process.env.E2E_TEST !== "true") {
		return
	}
	e2eInitialStateOverride = state
}

/**
 * Subscribe to state updates
 * @param controller The controller instance
 * @param request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToState(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<State>,
	requestId?: string,
): Promise<void> {
	// Add this subscription to the active subscriptions
	activeStateSubscriptions.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		activeStateSubscriptions.delete(responseStream)
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "state_subscription" }, responseStream)
	}

	// Send the initial state. Keep hydration fast so auth/onboarding recovery is
	// never blocked by a backend model refresh immediately after ChatGPT sign-in.
	const initialState =
		e2eInitialStateOverride ?? (await controller.getStateToPostToWebview({ skipOpenAiCodexBackendModelsRefresh: true }))
	const initialStateJson = JSON.stringify(initialState)

	recordStateSizeTelemetry(Buffer.byteLength(initialStateJson, "utf8"))

	try {
		await responseStream(
			{
				stateJson: initialStateJson,
			},
			false, // Not the last message
		)
	} catch (error) {
		Logger.error("Error sending initial state:", error)
		activeStateSubscriptions.delete(responseStream)
	}
}

/**
 * Send a state update to all active subscribers
 * @param state The state to send
 */
export async function sendStateUpdate(state: ExtensionState): Promise<void> {
	let stateJson: string
	try {
		stateJson = JSON.stringify(state)
	} catch (error) {
		Logger.error("Error serializing state update:", error)
		return
	}

	recordStateSizeTelemetry(Buffer.byteLength(stateJson, "utf8"))

	const promises = Array.from(activeStateSubscriptions).map(async (responseStream) => {
		try {
			await responseStream(
				{
					stateJson,
				},
				false, // Not the last message
			)
		} catch (error) {
			Logger.error("Error sending state update:", error)
			activeStateSubscriptions.delete(responseStream)
		}
	})

	await Promise.all(promises)
}

function recordStateSizeTelemetry(sizeBytes: number): void {
	telemetryService.captureGrpcResponseSize(sizeBytes, "cline.StateService", "subscribeToState")
}
