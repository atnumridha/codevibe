import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import {
	convertMcpServersToProtoMcpServers,
	convertProtoMcpServersToMcpServers,
} from "./mcp-server-conversion"

describe("MCP server proto conversion", () => {
	it("preserves settings source metadata for Cursor-imported servers", () => {
		const [protoServer] = convertMcpServersToProtoMcpServers([
			{
				name: "docs",
				config: JSON.stringify({ type: "stdio", command: "node" }),
				status: "connected",
				settingsSource: "cursor-workspace",
				settingsPath: "/workspace/.cursor/mcp.json",
			},
		])

		assert.equal(protoServer.settingsSource, "cursor-workspace")
		assert.equal(protoServer.settingsPath, "/workspace/.cursor/mcp.json")

		const [server] = convertProtoMcpServersToMcpServers([protoServer])

		assert.equal(server.settingsSource, "cursor-workspace")
		assert.equal(server.settingsPath, "/workspace/.cursor/mcp.json")
	})
})
