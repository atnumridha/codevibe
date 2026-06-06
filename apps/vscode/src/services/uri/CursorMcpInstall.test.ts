import { expect } from "chai"
import { describe, it } from "mocha"
import {
	buildCursorMcpInstallRequest,
	CursorMcpInstallError,
	formatCursorMcpInstallDetail,
} from "./CursorMcpInstall"
import type { CursorCompatibleUriRoute } from "./CursorUriRoutes"

function route(params: CursorCompatibleUriRoute["params"]): CursorCompatibleUriRoute {
	return {
		kind: "mcp-install",
		path: "/mcp/install",
		params,
	}
}

describe("CursorMcpInstall", () => {
	it("builds a streamable HTTP server from direct URL params", () => {
		const request = buildCursorMcpInstallRequest(
			route({ name: "docs", url: "https://mcp.example.com/sse" }),
		)

		expect(request.serverName).to.equal("docs")
		expect(request.source).to.equal("direct")
		expect(request.serverConfig.type).to.equal("streamableHttp")
		expect((request.serverConfig as any).url).to.equal("https://mcp.example.com/sse")
	})

	it("builds a stdio package install without executing the package", () => {
		const request = buildCursorMcpInstallRequest(route({ name: "linear", package: "@modelcontextprotocol/server-linear" }))

		expect(request.serverConfig.type).to.equal("stdio")
		expect((request.serverConfig as any).command).to.equal("npx")
		expect((request.serverConfig as any).args).to.deep.equal(["-y", "@modelcontextprotocol/server-linear"])
	})

	it("derives safe direct-install names when no explicit name is provided", () => {
		const packageRequest = buildCursorMcpInstallRequest(route({ package: "@modelcontextprotocol/server-filesystem" }))
		const urlRequest = buildCursorMcpInstallRequest(route({ url: "https://mcp.example.com/context/server" }))

		expect(packageRequest.serverName).to.equal("modelcontextprotocol-server-filesystem")
		expect(urlRequest.serverName).to.equal("mcp.example.com-server")
	})

	it("selects the named server from a full MCP config", () => {
		const request = buildCursorMcpInstallRequest(
			route({
				name: "beta",
				config: {
					mcpServers: {
						alpha: { command: "node", args: ["alpha.js"] },
						beta: { command: "node", args: ["beta.js"], env: { TOKEN: "secret" } },
					},
				},
			}),
		)

		expect(request.serverName).to.equal("beta")
		expect(request.source).to.equal("config")
		expect((request.serverConfig as any).command).to.equal("node")
		expect(formatCursorMcpInstallDetail(request)).to.contain("Environment keys: TOKEN")
		expect(formatCursorMcpInstallDetail(request)).to.not.contain("secret")
	})

	it("selects a named server from Cursor bare config maps", () => {
		const request = buildCursorMcpInstallRequest(
			route({
				name: "postgres",
				config: {
					postgres: {
						command: "node",
						args: ["postgres-mcp.js"],
						env: { POSTGRES_TOKEN: "secret" },
					},
				},
			}),
		)

		expect(request.serverName).to.equal("postgres")
		expect(request.source).to.equal("config")
		expect((request.serverConfig as any).command).to.equal("node")
		expect((request.serverConfig as any).args).to.deep.equal(["postgres-mcp.js"])
		expect(formatCursorMcpInstallDetail(request)).to.contain("Environment keys: POSTGRES_TOKEN")
		expect(formatCursorMcpInstallDetail(request)).to.not.contain("secret")
	})

	it("requires a server selector when config contains multiple servers", () => {
		expect(() =>
			buildCursorMcpInstallRequest(
				route({
					config: {
						mcpServers: {
							alpha: { command: "node" },
							beta: { command: "node" },
						},
					},
				}),
			),
		).to.throw(CursorMcpInstallError, "multiple servers")
	})

	it("requires a selector when Cursor bare config maps contain multiple servers", () => {
		expect(() =>
			buildCursorMcpInstallRequest(
				route({
					config: {
						alpha: { command: "node" },
						beta: { command: "node" },
					},
				}),
			),
		).to.throw(CursorMcpInstallError, "multiple servers")
	})

	it("rejects unsafe server names", () => {
		expect(() =>
			buildCursorMcpInstallRequest(route({ name: "../bad", url: "https://mcp.example.com" })),
		).to.throw(CursorMcpInstallError, "unsafe")
	})
})
