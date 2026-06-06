import type { CursorMcpServerInstallRequest } from "@shared/proto/cline/mcp"
import { CursorMcpServerInstallResponse, McpServers } from "@shared/proto/cline/mcp"
import { convertMcpServersToProtoMcpServers } from "@/shared/proto-conversions/mcp/mcp-server-conversion"
import { Logger } from "@/shared/services/Logger"
import {
	buildCursorMcpInstallRequest,
	formatCursorMcpInstallDetail,
} from "@/services/uri/CursorMcpInstall"
import {
	getCursorCompatibleUriPath,
	parseCursorCompatibleUri,
} from "@/services/uri/CursorUriRoutes"
import type { Controller } from "../index"

function buildQueryPreservingPlus(parsedUrl: URL): URLSearchParams {
	return new URLSearchParams(parsedUrl.search.slice(1).replace(/\+/g, "%2B"))
}

function parseCursorMcpInstallRoute(uri: string) {
	const parsedUrl = new URL(uri)
	const parsedRoute = parseCursorCompatibleUri(
		getCursorCompatibleUriPath(parsedUrl),
		buildQueryPreservingPlus(parsedUrl),
	)
	if (!parsedRoute.recognized) {
		throw new Error("URI is not a recognized Cursor-compatible route")
	}
	if ("error" in parsedRoute) {
		throw new Error(parsedRoute.error)
	}
	if (parsedRoute.route.kind !== "mcp-install") {
		throw new Error(`Expected /mcp/install route, received ${parsedRoute.route.path}`)
	}
	return parsedRoute.route
}

export async function installCursorMcpServer(
	controller: Controller,
	request: CursorMcpServerInstallRequest,
): Promise<CursorMcpServerInstallResponse> {
	try {
		const uri = request.uri?.trim()
		if (!uri) {
			throw new Error("URI is required")
		}

		const installRequest = buildCursorMcpInstallRequest(parseCursorMcpInstallRoute(uri))
		const detail = formatCursorMcpInstallDetail(installRequest)

		if (!request.confirmed) {
			return CursorMcpServerInstallResponse.create({
				installed: false,
				serverName: installRequest.serverName,
				detail,
			})
		}

		const servers = await controller.mcpHub.addServerFromConfig(
			installRequest.serverName,
			installRequest.serverConfig,
		)

		return CursorMcpServerInstallResponse.create({
			installed: true,
			serverName: installRequest.serverName,
			detail,
			mcpServers: McpServers.create({ mcpServers: convertMcpServersToProtoMcpServers(servers) }),
		})
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		Logger.error("Failed to install Cursor MCP server:", error)
		return CursorMcpServerInstallResponse.create({
			installed: false,
			error: message,
		})
	}
}
