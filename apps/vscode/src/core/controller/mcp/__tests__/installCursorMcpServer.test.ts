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
		const addServerFromConfig = sinon.stub().resolves([])
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
