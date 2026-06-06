import { expect } from "chai"
import { describe, it } from "mocha"
import {
	buildCursorCompatibleAutomationIngestRequest,
	buildCursorCompatibleGlassRouteMetadata,
	buildCursorCompatibleTaskPrompt,
	getCursorCompatibleUriPath,
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

	it("normalizes native cursor:// route hosts into Cursor route paths", () => {
		expect(getCursorCompatibleUriPath(new URL("cursor://createchat?prompt=hi"))).to.equal("/createchat")
		expect(getCursorCompatibleUriPath(new URL("cursor://mcp/install?name=docs"))).to.equal("/mcp/install")
		expect(getCursorCompatibleUriPath(new URL("cursor://plugin/add?id=docs"))).to.equal("/plugin/add")
		expect(
			getCursorCompatibleUriPath(new URL("cursor://anysphere.cursor-deeplink/createchat?prompt=hi")),
		).to.equal("/createchat")
		expect(getCursorCompatibleUriPath(new URL("cursor://anysphere.cursor-mcp/install?name=docs"))).to.equal(
			"/mcp/install",
		)
	})

	it("normalizes native codevibe:// route hosts into Cursor-compatible route paths", () => {
		expect(getCursorCompatibleUriPath(new URL("codevibe://createchat?prompt=hi"))).to.equal("/createchat")
		expect(getCursorCompatibleUriPath(new URL("codevibe://mcp/install?name=docs"))).to.equal("/mcp/install")
		expect(getCursorCompatibleUriPath(new URL("codevibe://atnumridha.codevibe/background-agent?prompt=hi"))).to.equal(
			"/background-agent",
		)
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

	it("builds dedicated metadata for Cursor glass routes", () => {
		const config = base64UrlJson({ placement: "top", token: "secret-value" })
		const result = parseCursorCompatibleUri("/glass", new URLSearchParams(`text=Continue%20here&config=${config}`))

		expect(result.recognized).to.equal(true)
		if (!result.recognized || "error" in result) {
			throw new Error("expected glass route to parse")
		}
		expect(buildCursorCompatibleGlassRouteMetadata(result.route)).to.deep.equal({
			glass: true,
			mode: "overlay",
			hasPrompt: true,
			paramKeys: ["config", "text"],
			configKeys: ["placement", "token"],
		})
		expect(JSON.stringify(buildCursorCompatibleGlassRouteMetadata(result.route))).not.to.contain("secret-value")
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

	it("accepts typed automation ingest options from config payloads", () => {
		const ndjson = [
			JSON.stringify({
				eventId: "evt-1",
				eventType: "git.commit.created",
				source: "cursor",
			}),
			JSON.stringify({
				eventId: "evt-2",
				eventType: "git.commit.created",
				source: "github",
			}),
		].join("\n")
		const config = base64UrlJson({
			ndjson,
			allowedSources: ["cursor"],
			maxEvents: 1,
			strict: true,
		})
		const result = parseCursorCompatibleUri("/automation/ingest", new URLSearchParams(`config=${config}`))

		expect(result.recognized).to.equal(true)
		if (!result.recognized || "error" in result) {
			throw new Error("expected automation ingest config route to parse")
		}
		const request = buildCursorCompatibleAutomationIngestRequest(result.route)
		expect(request.strict).to.equal(true)
		expect(request.options).to.deep.include({
			allowedSources: ["cursor"],
			maxEvents: 1,
		})
		expect(request.validation.events).to.have.length(1)
		expect(request.validation.rejected).to.have.length(1)
		expect(request.configKeys).to.deep.equal(["allowedSources", "maxEvents", "ndjson", "strict"])
	})

	it("rejects invalid numeric automation ingest config values", () => {
		const config = base64UrlJson({
			ndjson: "{}",
			maxEvents: 0,
		})
		const result = parseCursorCompatibleUri("/automation/ingest", new URLSearchParams(`config=${config}`))

		expect(result.recognized).to.equal(true)
		if (!result.recognized || "error" in result) {
			throw new Error("expected automation ingest config route to parse")
		}
		expect(() => buildCursorCompatibleAutomationIngestRequest(result.route)).to.throw(
			"maxEvents must be a positive integer",
		)
	})
})
