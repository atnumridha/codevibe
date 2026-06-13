import { EmptyRequest } from "@shared/proto/cline/common"
import { State } from "@shared/proto/cline/state"
import { Controller } from "../index"

/**
 * Get the latest extension state
 * @param controller The controller instance
 * @param request The empty request
 * @returns The current extension state
 */
export async function getLatestState(controller: Controller, _: EmptyRequest): Promise<State> {
	// Keep direct state reads fast so onboarding/auth recovery is not blocked by
	// a backend model refresh immediately after ChatGPT sign-in.
	const state = await controller.getStateToPostToWebview({ skipOpenAiCodexBackendModelsRefresh: true })

	// Convert the state to a JSON string
	const stateJson = JSON.stringify(state)

	// Return the state as a JSON string
	return State.create({
		stateJson,
	})
}
