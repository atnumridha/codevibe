import { expect } from "chai"
import { redactUriForLogging } from "./UriRedaction"

describe("UriRedaction", () => {
	it("redacts secret query params and nested config secrets", () => {
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

		const redacted = redactUriForLogging(
			`vscode://atnumridha.codevibe/mcp/install?name=docs&access_token=query-secret&config=${config}`,
		)

		expect(redacted).to.contain("name=docs")
		expect(redacted).to.contain("REDACTED")
		expect(redacted).not.to.contain("query-secret")
		expect(redacted).not.to.contain("header-secret")
		expect(redacted).not.to.contain("url-secret")
		expect(redacted).not.to.contain("config-secret")
	})

	it("redacts secret-like text even when the URI cannot be parsed", () => {
		const redacted = redactUriForLogging("not a uri ?token=query-secret Authorization: Bearer bearer-secret")

		expect(redacted).to.contain("REDACTED")
		expect(redacted).not.to.contain("query-secret")
		expect(redacted).not.to.contain("bearer-secret")
	})
})
