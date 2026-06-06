import { expect } from "chai"
import { describe, it } from "mocha"
import {
	buildCursorCompatibleTaskPrompt,
	isCursorCompatibleUriPath,
	parseCursorCompatibleUri,
} from "./CursorUriRoutes"

function base64UrlJson(value: unknown): string {
	return Buffer.from(JSON.stringify(value), "utf8")
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "")
}

describe("CursorUriRoutes", () => {
	it("recognizes supported Cursor-compatible route paths", () => {
		expect(isCursorCompatibleUriPath("/createchat")).to.equal(true)
		expect(isCursorCompatibleUriPath("/mcp/install")).to.equal(true)
		expect(isCursorCompatibleUriPath("/not-cursor")).to.equal(false)
	})

	it("parses createchat and prompt routes into task prompts", () => {
		const result = parseCursorCompatibleUri("/createchat", new URLSearchParams("prompt=Fix%20the%20tests"))

		expect(result.recognized).to.equal(true)
		if (!result.recognized || "error" in result) {
			throw new Error("expected createchat route to parse")
		}
		expect(result.route.kind).to.equal("createchat")
		expect(buildCursorCompatibleTaskPrompt(result.route)).to.equal("Fix the tests")
	})

	it("parses base64url JSON configs for install-style routes", () => {
		const config = base64UrlJson({
			mcpServers: {
				docs: {
					command: "node",
				},
			},
		})
		const result = parseCursorCompatibleUri("/mcp/install", new URLSearchParams(`name=docs&config=${config}`))

		expect(result.recognized).to.equal(true)
		if (!result.recognized || "error" in result) {
			throw new Error("expected mcp install route to parse")
		}
		expect(result.route.kind).to.equal("mcp-install")
		expect(result.route.params.config).to.deep.equal({
			mcpServers: {
				docs: {
					command: "node",
				},
			},
		})
		expect(buildCursorCompatibleTaskPrompt(result.route)).to.contain("ask for confirmation")
	})

	it("rejects duplicate query parameters", () => {
		const result = parseCursorCompatibleUri("/command", new URLSearchParams("command=ls&command=pwd"))

		expect(result.recognized).to.equal(true)
		if (!result.recognized || !("error" in result)) {
			throw new Error("expected duplicate command route to fail")
		}
		expect(result.error).to.contain("duplicate query parameter")
	})

	it("rejects unknown route parameters", () => {
		const result = parseCursorCompatibleUri("/command", new URLSearchParams("command=ls&extra=value"))

		expect(result.recognized).to.equal(true)
		if (!result.recognized || !("error" in result)) {
			throw new Error("expected unknown parameter route to fail")
		}
		expect(result.error).to.contain("Unrecognized key")
	})

	it("formats command routes as review tasks instead of direct execution", () => {
		const result = parseCursorCompatibleUri("/command", new URLSearchParams("command=npm%20install"))

		expect(result.recognized).to.equal(true)
		if (!result.recognized || "error" in result) {
			throw new Error("expected command route to parse")
		}
		const prompt = buildCursorCompatibleTaskPrompt(result.route)
		expect(prompt).to.contain("Review it with the user before running it")
		expect(prompt).to.contain("```sh\nnpm install\n```")
	})

	it("validates automation NDJSON ingest routes without leaking raw payload values", () => {
		const ndjson = encodeURIComponent(
			[
				JSON.stringify({
					eventId: "evt-1",
					eventType: "git.commit.created",
					source: "cursor",
					subject: "main",
					payload: { token: "secret-value", branch: "main" },
				}),
				JSON.stringify({ eventId: "evt-2", eventType: "git.commit.created", source: "github" }),
			].join("\n"),
		)
		const result = parseCursorCompatibleUri(
			"/automation/ingest",
			new URLSearchParams(`ndjson=${ndjson}&allowedSources=cursor&strict=true`),
		)

		expect(result.recognized).to.equal(true)
		if (!result.recognized || "error" in result) {
			throw new Error("expected automation ingest route to parse")
		}
		const prompt = buildCursorCompatibleTaskPrompt(result.route)
		expect(prompt).to.contain("accepted events: 1")
		expect(prompt).to.contain("rejected lines: 1")
		expect(prompt).to.contain("payload keys: branch, token")
		expect(prompt).to.contain("source_not_allowed")
		expect(prompt).not.to.contain("secret-value")
	})
})
