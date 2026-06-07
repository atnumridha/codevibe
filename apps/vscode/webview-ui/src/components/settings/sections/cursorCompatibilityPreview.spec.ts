import { describe, expect, it } from "vitest"
import {
	buildCursorUriPreview,
	CURSOR_COMPATIBLE_ROUTE_LABELS,
} from "./cursorCompatibilityPreview"

describe("cursorCompatibilityPreview", () => {
	it("infers Cursor-compatible routes across vscode, cursor, and codevibe URI forms", () => {
		expect(buildCursorUriPreview("vscode://cline.cline/createchat?prompt=hi").route).to.equal("/createchat")
		expect(buildCursorUriPreview("cursor://settings?tab=NDJSON").route).to.equal("/settings")
		expect(buildCursorUriPreview("codevibe://git/checkout?branch=feature%2Fdemo").route).to.equal("/git/checkout")
		expect(buildCursorUriPreview("vscode://anysphere.cursor-mcp/install?name=docs").route).to.equal("/mcp/install")
	})

	it("redacts secret query strings, headers, and config values from previews", () => {
		const config = encodeURIComponent(
			JSON.stringify({
				headers: {
					Authorization: "Bearer header-secret",
				},
				callback: "https://example.com/callback?token=url-secret&ok=1",
				nested: {
					apiKey: "config-secret",
				},
			}),
		)
		const preview = buildCursorUriPreview(
			`vscode://cline.cline/mcp/install?name=docs&access_token=query-secret&config=${config}`,
		)

		expect(preview.ok).to.equal(true)
		expect(preview.redacted).to.equal(true)
		expect(preview.text).to.contain("[REDACTED]")
		expect(preview.text).not.to.contain("query-secret")
		expect(preview.text).not.to.contain("header-secret")
		expect(preview.text).not.to.contain("url-secret")
		expect(preview.text).not.to.contain("config-secret")
	})

	it("keeps every release-checklist route represented in the settings preview metadata", () => {
		expect(CURSOR_COMPATIBLE_ROUTE_LABELS.map((route) => route.path)).to.deep.equal([
			"/createchat",
			"/mcp/install",
			"/background-agent",
			"/settings",
			"/prompt",
			"/command",
			"/rule",
			"/pr-review",
			"/plugin/add",
			"/glass",
			"/automation/ingest",
			"/git/checkout",
			"/git/branch",
			"/git/commit",
		])
	})
})
