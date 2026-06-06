import { describe, it } from "mocha"
import "should"
import { ServerConfigSchema } from "../schemas"

describe("MCP schema Cursor compatibility", () => {
	it("normalizes nested streamable-http transport configs", () => {
		const parsed = ServerConfigSchema.parse({
			transport: {
				type: "streamable-http",
				url: "https://mcp.example.com/context",
				headers: {
					Authorization: "Bearer token",
				},
			},
			disabled: true,
			autoApprove: ["search"],
		}) as any

		parsed.type.should.equal("streamableHttp")
		parsed.url.should.equal("https://mcp.example.com/context")
		parsed.headers.should.deepEqual({ Authorization: "Bearer token" })
		parsed.disabled.should.equal(true)
		parsed.autoApprove.should.deepEqual(["search"])
		;(parsed.transport === undefined).should.be.true()
		;(parsed.transportType === undefined).should.be.true()
	})

	it("normalizes Cursor transportType aliases", () => {
		const parsed = ServerConfigSchema.parse({
			transportType: "streamable_http",
			url: "https://mcp.example.com/context",
		}) as any

		parsed.type.should.equal("streamableHttp")
		parsed.url.should.equal("https://mcp.example.com/context")
		;(parsed.transportType === undefined).should.be.true()
	})
})
