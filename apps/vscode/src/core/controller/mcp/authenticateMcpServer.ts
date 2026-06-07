import type { StringRequest } from "@shared/proto/cline/common"
import { McpServerAuthResponse } from "@shared/proto/cline/mcp"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * Initiates OAuth authentication for an MCP server
 * @param controller The controller instance
 * @param request The request containing server name
 * @returns Structured MCP server authentication response
 */
export async function authenticateMcpServer(controller: Controller, request: StringRequest): Promise<McpServerAuthResponse> {
	const serverName = request.value?.trim() ?? ""
	try {
		if (!serverName) {
			throw new Error("Server name is required")
		}
		if (!controller.mcpHub) {
			throw new Error("MCP hub is not available")
		}

		await controller.mcpHub.initiateOAuth(serverName)
		const server = controller.mcpHub.getServers().find((candidate) => candidate.name === serverName)

		return McpServerAuthResponse.create({
			initiated: true,
			serverName,
			oauthRequired: server?.oauthRequired,
			oauthAuthStatus: server?.oauthAuthStatus,
			detail: "OAuth authentication flow initiated.",
		})
	} catch (error) {
		Logger.error(`Failed to initiate OAuth for MCP server:`, error)
		return McpServerAuthResponse.create({
			initiated: false,
			serverName,
			error: error instanceof Error ? error.message : String(error),
		})
	}
}
