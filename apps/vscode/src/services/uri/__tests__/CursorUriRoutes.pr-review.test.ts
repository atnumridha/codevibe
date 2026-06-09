import { expect } from "chai"
import { describe, it } from "mocha"
import {
	buildCursorCompatiblePrReviewRequest,
	buildCursorCompatibleTaskPrompt,
	parseCursorCompatibleUri,
} from "../CursorUriRoutes"

function parseRoute(query: string) {
	const result = parseCursorCompatibleUri("/pr-review", new URLSearchParams(query))
	if (!result.recognized || "error" in result) {
		throw new Error("expected pr-review route to parse")
	}
	return result.route
}

describe("CursorUriRoutes PR review", () => {
	it("builds generate_explanation review prompts when refs are provided", () => {
		const route = parseRoute("repo=owner%2Frepo&number=42&base=origin%2Fmain&head=pr-42")
		const prompt = buildCursorCompatibleTaskPrompt(route)
		const request = buildCursorCompatiblePrReviewRequest(route)

		expect(request).to.deep.include({
			displayTarget: "owner/repo#42",
			repository: "owner/repo",
			number: "42",
			fromRef: "origin/main",
			toRef: "pr-42",
		})
		expect(prompt).to.contain("owner/repo#42")
		expect(prompt).to.contain("generate_explanation")
		expect(prompt).to.contain("<from_ref>origin/main</from_ref>")
		expect(prompt).to.contain("<to_ref>pr-42</to_ref>")
		expect(prompt).to.contain("- from_ref: origin/main")
		expect(prompt).to.contain("- to_ref: pr-42")
	})

	it("normalizes GitHub PR URLs without leaking query secrets or fragments", () => {
		const route = parseRoute(
			"url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Fpull%2F42%3Ftoken%3Dsecret-value%23review",
		)
		const prompt = buildCursorCompatibleTaskPrompt(route)
		const request = buildCursorCompatiblePrReviewRequest(route)

		expect(request).to.deep.include({
			displayTarget: "owner/repo#42",
			repository: "owner/repo",
			number: "42",
			safeUrl: "https://github.com/owner/repo/pull/42?[redacted]#[redacted]",
		})
		expect(prompt).to.contain("owner/repo#42")
		expect(prompt).to.contain("https://github.com/owner/repo/pull/42?[redacted]#[redacted]")
		expect(prompt).to.contain("- url: https://github.com/owner/repo/pull/42?[redacted]#[redacted]")
		expect(prompt).to.contain("ask for approval before running network or terminal commands")
		expect(prompt).not.to.contain("secret-value")
		expect(prompt).not.to.contain("#review")
	})

	it("accepts PR review targets from config payloads", () => {
		const config = Buffer.from(JSON.stringify({ repo: "owner/repo", number: "42", baseBranch: "main", branch: "pr-42" }), "utf8")
			.toString("base64")
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/g, "")
		const route = parseRoute(`config=${config}`)
		const prompt = buildCursorCompatibleTaskPrompt(route)
		const request = buildCursorCompatiblePrReviewRequest(route)

		expect(request).to.deep.include({
			displayTarget: "owner/repo#42",
			repository: "owner/repo",
			number: "42",
			fromRef: "main",
			toRef: "pr-42",
		})
		expect(request.configKeys).to.deep.equal(["baseBranch", "branch", "number", "repo"])
		expect(prompt).to.contain("<from_ref>main</from_ref>")
		expect(prompt).to.contain("<to_ref>pr-42</to_ref>")
		expect(prompt).to.contain("config keys: baseBranch, branch, number, repo")
	})
})
