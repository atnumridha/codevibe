import { expect } from "chai"
import { describe, it } from "mocha"
import sinon from "sinon"
import { CursorMcpServerInstallRequest } from "@shared/proto/cline/mcp"
import { installCursorMcpServer } from "../installCursorMcpServer"

function createController(addServerFromConfig = sinon.stub().resolves([])) {
	return {
		mcpHub: {
			addServerFromConfig,
		},
	} as any
}

describe("installCursorMcpServer", () => {
	it("previews a Cursor MCP install without writing settings when unconfirmed", async () => {
		const addServerFromConfig = sinon.stub().resolves([])
		const response = await installCursorMcpServer(
			createController(addServerFromConfig),
			CursorMcpServerInstallRequest.create({
				uri: "vscode://cline.cline/mcp/install?name=docs&url=https%3A%2F%2Fmcp.example.com",
				confirmed: false,
			}),
		)

		expect(response.installed).to.equal(false)
		expect(response.serverName).to.equal("docs")
		expect(response.detail).to.contain("https://mcp.example.com")
		expect(response.error).to.equal(undefined)
		expect(addServerFromConfig.called).to.equal(false)
	})

	it("previews native cursor:// MCP install routes", async () => {
		const addServerFromConfig = sinon.stub().resolves([])
		const response = await installCursorMcpServer(
			createController(addServerFromConfig),
			CursorMcpServerInstallRequest.create({
				uri: "cursor://mcp/install?name=docs&url=https%3A%2F%2Fmcp.example.com",
				confirmed: false,
			}),
		)

		expect(response.installed).to.equal(false)
		expect(response.serverName).to.equal("docs")
		expect(response.detail).to.contain("https://mcp.example.com")
		expect(response.error).to.equal(undefined)
		expect(addServerFromConfig.called).to.equal(false)
	})

	it("installs a Cursor MCP server after explicit confirmation", async () => {
		const addServerFromConfig = sinon.stub().resolves([
			{
				name: "linear",
				config: "{}",
				status: "connected",
				oauthRequired: false,
				oauthAuthStatus: "authenticated",
			},
		])
		const response = await installCursorMcpServer(
			createController(addServerFromConfig),
			CursorMcpServerInstallRequest.create({
				uri: "vscode://cline.cline/mcp/install?name=linear&package=%40modelcontextprotocol%2Fserver-linear",
				confirmed: true,
			}),
		)

		expect(response.installed).to.equal(true)
		expect(response.serverName).to.equal("linear")
		sinon.assert.calledOnce(addServerFromConfig)
		expect(addServerFromConfig.firstCall.args[0]).to.equal("linear")
		expect(addServerFromConfig.firstCall.args[1]).to.deep.include({
			type: "stdio",
			command: "npx",
		})
		expect(addServerFromConfig.firstCall.args[1].args).to.deep.equal(["-y", "@modelcontextprotocol/server-linear"])
		expect(response.oauthRequired).to.equal(false)
		expect(response.oauthAuthStatus).to.equal("authenticated")
		expect(response.oauthNextAction).to.equal("none")
	})

	it("summarizes OAuth action after installing a Cursor MCP server that requires authentication", async () => {
		const addServerFromConfig = sinon.stub().resolves([
			{
				name: "linear",
				config: '{"type":"streamableHttp","url":"https://mcp.linear.app"}',
				status: "disconnected",
				error: "This MCP server requires authentication to get started.",
				oauthRequired: true,
				oauthAuthStatus: "unauthenticated",
			},
		])
		const response = await installCursorMcpServer(
			createController(addServerFromConfig),
			CursorMcpServerInstallRequest.create({
				uri: "cursor://mcp/install?name=linear&url=https%3A%2F%2Fmcp.linear.app",
				confirmed: true,
			}),
		)

		expect(response.installed).to.equal(true)
		expect(response.serverName).to.equal("linear")
		expect(response.oauthRequired).to.equal(true)
		expect(response.oauthAuthStatus).to.equal("unauthenticated")
		expect(response.oauthNextAction).to.equal("authenticate")
		expect(response.oauthDetail).to.contain("requires authentication")
		expect(response.mcpServers?.mcpServers[0]?.oauthRequired).to.equal(true)
		expect(response.mcpServers?.mcpServers[0]?.oauthAuthStatus).to.equal("unauthenticated")
	})

	it("returns a structured error for non-MCP routes", async () => {
		const response = await installCursorMcpServer(
			createController(),
			CursorMcpServerInstallRequest.create({
				uri: "vscode://cline.cline/createchat?prompt=hello",
				confirmed: true,
			}),
		)

		expect(response.installed).to.equal(false)
		expect(response.error).to.contain("Expected /mcp/install route")
	})
})
