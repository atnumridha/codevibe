import { expect } from "chai"
import { describe, it } from "mocha"
import {
	buildCursorCompatibleTaskPrompt,
	isCursorCompatibleUriPath,
	parseCursorCompatibleUri,
} from "../CursorUriRoutes"

function parseRoute(path: string, query: string) {
	const result = parseCursorCompatibleUri(path, new URLSearchParams(query))
	if (!result.recognized || "error" in result) {
		throw new Error("expected route to parse")
	}
	return result.route
}

describe("CursorUriRoutes git helpers", () => {
	it("recognizes Cursor-compatible git helper paths", () => {
		expect(isCursorCompatibleUriPath("/git/checkout")).to.equal(true)
		expect(isCursorCompatibleUriPath("/git/branch")).to.equal(true)
		expect(isCursorCompatibleUriPath("/git/commit")).to.equal(true)
	})

	it("formats checkout helpers as confirmation-oriented tasks", () => {
		const route = parseRoute("/git/checkout", "branch=feature%2Fcursor-parity")
		const prompt = buildCursorCompatibleTaskPrompt(route)

		expect(route.kind).to.equal("git-checkout")
		expect(prompt).to.contain("not permission to run it")
		expect(prompt).to.contain("confirm the exact checkout command")
		expect(prompt).to.contain("feature/cursor-parity")
	})

	it("accepts target as a checkout helper alias", () => {
		const route = parseRoute("/git/checkout", "target=HEAD")
		const prompt = buildCursorCompatibleTaskPrompt(route)

		expect(route.kind).to.equal("git-checkout")
		expect(prompt).to.contain("- target: HEAD")
	})

	it("rejects unsafe checkout helper refs", () => {
		const result = parseCursorCompatibleUri("/git/checkout", new URLSearchParams("branch=--detach"))

		expect(result.recognized).to.equal(true)
		if (!result.recognized || !("error" in result)) {
			throw new Error("expected unsafe checkout route to fail")
		}
		expect(result.error).to.contain("cannot start with '-'")
	})

	it("formats branch helpers without mutating git state", () => {
		const route = parseRoute("/git/branch", "name=feature%2Fsafe&baseBranch=main")
		const prompt = buildCursorCompatibleTaskPrompt(route)

		expect(route.kind).to.equal("git-branch")
		expect(prompt).to.contain("not permission to mutate git state")
		expect(prompt).to.contain("- branch: feature/safe")
		expect(prompt).to.contain("- base: main")
	})

	it("formats commit helpers as staged-first review tasks", () => {
		const route = parseRoute("/git/commit", "message=fix%3A%20safe%20git%20helpers&staged=true")
		const prompt = buildCursorCompatibleTaskPrompt(route)

		expect(route.kind).to.equal("git-commit")
		expect(prompt).to.contain("not permission to stage files, commit, or push")
		expect(prompt).to.contain("inspecting staged changes first")
		expect(prompt).to.contain("message: fix: safe git helpers")
	})

	it("rejects non-boolean commit helper flags", () => {
		const result = parseCursorCompatibleUri("/git/commit", new URLSearchParams("staged=eventually"))

		expect(result.recognized).to.equal(true)
		if (!result.recognized || !("error" in result)) {
			throw new Error("expected invalid commit helper route to fail")
		}
		expect(result.error).to.contain("Invalid enum value")
	})

	it("accepts Cursor named command links used for commit helper prompts", () => {
		const route = parseRoute("/command", "name=commit&text=Commit%20current%20work")
		const prompt = buildCursorCompatibleTaskPrompt(route)

		expect(route.kind).to.equal("command")
		expect(prompt).to.contain('named "commit"')
		expect(prompt).to.contain("Command text:")
		expect(prompt).to.contain("Commit current work")
	})
})
