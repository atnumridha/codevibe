import { expect } from "chai"
import { describe, it } from "mocha"
import {
	buildCursorCompatibleBackgroundAgentLaunchRequest,
	parseCursorCompatibleUri,
} from "../CursorUriRoutes"

describe("CursorUriRoutes background-agent", () => {
	it("builds a launch request from the validated route schema", () => {
		const result = parseCursorCompatibleUri(
			"/background-agent",
			new URLSearchParams("task=Fix%20the%20queue&repository=owner%2Frepo&branch=main&baseBranch=develop"),
		)

		expect(result.recognized).to.equal(true)
		if (!result.recognized || "error" in result) {
			throw new Error("expected background-agent route to parse")
		}

		const request = buildCursorCompatibleBackgroundAgentLaunchRequest(result.route)

		expect(request.prompt).to.equal("Fix the queue")
		expect(request.repository).to.equal("owner/repo")
		expect(request.requestedBranch).to.equal("main")
		expect(request.requestedBaseBranch).to.equal("develop")
		expect(request.routePrompt).to.contain("compatible background agent deeplink")
		expect(request.routePrompt).to.contain("ask for confirmation")
	})

	it("rejects background-agent routes without task text", () => {
		const result = parseCursorCompatibleUri("/background-agent", new URLSearchParams("repository=owner%2Frepo"))

		expect(result.recognized).to.equal(true)
		if (!result.recognized || !("error" in result)) {
			throw new Error("expected background-agent route to fail")
		}
		expect(result.error).to.contain("prompt, task, or message is required")
	})
})
