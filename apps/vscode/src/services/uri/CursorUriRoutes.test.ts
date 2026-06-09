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

	it("parses the planned Cursor-compatible route families", () => {
		const cases = [
			["/createchat", "prompt=Fix%20the%20tests", "createchat"],
			["/mcp/install", "name=docs&url=https%3A%2F%2Fmcp.example.com", "mcp-install"],
			["/background-agent", "prompt=Fix%20the%20tests", "background-agent"],
			["/settings", "section=providers", "settings"],
			["/prompt", "text=Summarize%20this", "prompt"],
			["/command", "command=npm%20test", "command"],
			["/rule", "name=project&content=Use%20focused%20tests", "rule"],
			["/pr-review", "repo=atnumridha%2Fcodevibe&number=123", "pr-review"],
			["/plugin/add", "id=docs-helper", "plugin-add"],
			["/glass", "text=Continue%20here", "glass"],
			["/automation/ingest", "ndjson=%7B%7D", "automation-ingest"],
		] as const

		for (const [path, query, kind] of cases) {
			const result = parseCursorCompatibleUri(path, new URLSearchParams(query))
			expect(result.recognized, path).to.equal(true)
			if (!result.recognized || "error" in result) {
				throw new Error(`expected ${path} route to parse`)
			}
			expect(result.route.path).to.equal(path)
			expect(result.route.kind).to.equal(kind)
		}
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

	it("preserves prompt route model, workspace, and config context without leaking config values", () => {
		const config = base64UrlJson({ mode: "fast", token: "secret-value" })
		const result = parseCursorCompatibleUri(
			"/createchat",
			new URLSearchParams(`prompt=Fix%20the%20tests&model=gpt-5.3-codex&workspace=/repo&config=${config}`),
		)

		expect(result.recognized).to.equal(true)
		if (!result.recognized || "error" in result) {
			throw new Error("expected createchat route to parse")
		}
		const prompt = buildCursorCompatibleTaskPrompt(result.route)
		expect(prompt).to.contain("Fix the tests")
		expect(prompt).to.contain("Compatible route context:")
		expect(prompt).to.contain("- model: gpt-5.3-codex")
		expect(prompt).to.contain("- workspace: /repo")
		expect(prompt).to.contain("config keys: mode, token")
		expect(prompt).not.to.contain("secret-value")
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

	it("parses Cursor plugin replacement flags", () => {
		const result = parseCursorCompatibleUri("/plugin/add", new URLSearchParams("id=docs-helper&replace=true"))

		expect(result.recognized).to.equal(true)
		if (!result.recognized || "error" in result) {
			throw new Error("expected plugin add route to parse")
		}
		expect(result.route.kind).to.equal("plugin-add")
		expect(result.route.params).to.deep.include({
			id: "docs-helper",
			replace: "true",
		})
	})

	it("parses Cursor rule URL imports as rule routes", () => {
		const result = parseCursorCompatibleUri(
			"/rule",
			new URLSearchParams("url=https%3A%2F%2Fexample.com%2Frules%2Fteam.mdc%3Ftoken%3Dsecret"),
		)

		expect(result.recognized).to.equal(true)
		if (!result.recognized || "error" in result) {
			throw new Error("expected rule URL route to parse")
		}
		expect(result.route.kind).to.equal("rule")
		expect(result.route.params.url).to.equal("https://example.com/rules/team.mdc?token=secret")
	})

	it("parses Cursor rule config URL imports as rule routes", () => {
		const config = base64UrlJson({
			name: "team-style",
			url: "https://example.com/rules/team.mdc?token=secret",
		})
		const result = parseCursorCompatibleUri("/rule", new URLSearchParams(`config=${config}`))

		expect(result.recognized).to.equal(true)
		if (!result.recognized || "error" in result) {
			throw new Error("expected rule config URL route to parse")
		}
		expect(result.route.kind).to.equal("rule")
		expect(result.route.params.config).to.deep.equal({
			name: "team-style",
			url: "https://example.com/rules/team.mdc?token=secret",
		})
	})

	it("rejects duplicate query parameters", () => {
		const result = parseCursorCompatibleUri("/command", new URLSearchParams("command=ls&command=pwd"))

		expect(result.recognized).to.equal(true)
		if (!result.recognized || !("error" in result)) {
			throw new Error("expected duplicate command route to fail")
		}
		expect(result.error).to.contain("duplicate query parameter")
	})

	it("preserves unknown route parameters as sanitized route context", () => {
		const result = parseCursorCompatibleUri("/command", new URLSearchParams("command=ls&extra=value"))

		expect(result.recognized).to.equal(true)
		if (!result.recognized || "error" in result) {
			throw new Error("expected unknown parameter route to parse")
		}
		expect(result.route.params).to.deep.include({
			command: "ls",
			extra: "value",
		})
		expect(buildCursorCompatibleTaskPrompt(result.route)).to.contain("- extra: value")
	})

	it("redacts secret-shaped unknown route parameters in task prompts", () => {
		const result = parseCursorCompatibleUri("/command", new URLSearchParams("command=ls&token=secret-value"))

		expect(result.recognized).to.equal(true)
		if (!result.recognized || "error" in result) {
			throw new Error("expected secret parameter route to parse")
		}
		const prompt = buildCursorCompatibleTaskPrompt(result.route)
		expect(prompt).to.contain("- token: [redacted]")
		expect(prompt).not.to.contain("secret-value")
	})

	it("rejects blank required route inputs after trimming", () => {
		const cases = [
			["/createchat", "prompt=%20%20", "prompt, text, or message is required"],
			["/mcp/install", "name=%20%20", "one MCP identifier or config is required"],
			["/background-agent", "prompt=%20%20", "prompt, task, or message is required"],
			["/command", "command=%20%20", "command input is required"],
			["/rule", "name=%20%20", "rule input is required"],
			["/pr-review", "repo=atnumridha%2Fcodevibe&number=%20%20", "PR URL or repository plus PR number is required"],
			["/plugin/add", "id=%20%20", "plugin identifier or config is required"],
			["/automation/ingest", "ndjson=%20%20", "ndjson or input is required"],
		] as const

		for (const [path, query, expectedError] of cases) {
			const result = parseCursorCompatibleUri(path, new URLSearchParams(query))
			expect(result.recognized, path).to.equal(true)
			if (!result.recognized || !("error" in result)) {
				throw new Error(`expected ${path} route to fail`)
			}
			expect(result.error).to.contain(expectedError)
		}
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
		const request = buildCursorCompatibleAutomationIngestRequest(result.route)
		expect(prompt).to.contain("accepted events: 1")
		expect(prompt).to.contain("rejected lines: 1")
		expect(prompt).to.contain("payload keys: branch, token")
		expect(prompt).to.contain("source_not_allowed")
		expect(prompt).not.to.contain("secret-value")
		expect(request.options).to.deep.include({
			maxLineBytes: 16 * 1024,
			maxEvents: 100,
		})
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

	it("rejects automation ingest limits above route caps", () => {
		const maxEventsResult = parseCursorCompatibleUri(
			"/automation/ingest",
			new URLSearchParams("ndjson=%7B%7D&maxEvents=1001"),
		)
		expect(maxEventsResult.recognized).to.equal(true)
		if (!maxEventsResult.recognized || "error" in maxEventsResult) {
			throw new Error("expected automation ingest maxEvents route to parse")
		}
		expect(() => buildCursorCompatibleAutomationIngestRequest(maxEventsResult.route)).to.throw(
			"maxEvents must be less than or equal to 1000",
		)

		const maxLineBytesResult = parseCursorCompatibleUri(
			"/automation/ingest",
			new URLSearchParams(`ndjson=%7B%7D&maxLineBytes=${64 * 1024 + 1}`),
		)
		expect(maxLineBytesResult.recognized).to.equal(true)
		if (!maxLineBytesResult.recognized || "error" in maxLineBytesResult) {
			throw new Error("expected automation ingest maxLineBytes route to parse")
		}
		expect(() => buildCursorCompatibleAutomationIngestRequest(maxLineBytesResult.route)).to.throw(
			"maxLineBytes must be less than or equal to 65536",
		)
	})
})
