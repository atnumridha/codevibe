/**
 * Identifier for the MCP tools that are used in native tool calls,
 * where each tool name is the combination of the server name + identifier + tool name.
 * This enables to uniquely identify which MCP server a tool belongs to.
 */
export const CLINE_MCP_TOOL_IDENTIFIER = "0mcp0"
export const DEFAULT_MCP_TIMEOUT_SECONDS = 60 // matches Anthropic's default timeout in their MCP SDK
export const MIN_MCP_TIMEOUT_SECONDS = 1
export type McpMode = "full" | "server-use-only" | "off"
export type McpServerSettingsSource = "cline" | "cursor-workspace" | "cursor-global"

export type McpServer = {
	name: string
	config: string
	status: "connected" | "connecting" | "disconnected"
	error?: string
	tools?: McpTool[]
	resources?: McpResource[]
	resourceTemplates?: McpResourceTemplate[]
	prompts?: McpPrompt[]
	disabled?: boolean
	timeout?: number
	uid?: string
	oauthRequired?: boolean
	oauthAuthStatus?: McpOAuthAuthStatus
	settingsSource?: McpServerSettingsSource
	settingsPath?: string
}

export type McpOAuthAuthStatus = "authenticated" | "unauthenticated" | "pending"

export type McpTool = {
	name: string
	description?: string
	inputSchema?: object
	autoApprove?: boolean
}

export type McpResource = {
	uri: string
	name: string
	mimeType?: string
	description?: string
}

export type McpResourceTemplate = {
	uriTemplate: string
	name: string
	description?: string
	mimeType?: string
}

export type McpPromptArgument = {
	name: string
	description?: string
	required?: boolean
}

export type McpPrompt = {
	name: string
	title?: string
	description?: string
	arguments?: McpPromptArgument[]
}

export type McpPromptMessageContent =
	| {
			type: "text"
			text: string
	  }
	| {
			type: "image"
			data: string
			mimeType: string
	  }
	| {
			type: "audio"
			data: string
			mimeType: string
	  }
	| {
			type: "resource"
			resource: {
				uri: string
				mimeType?: string
				text?: string
				blob?: string
			}
	  }

export type McpPromptMessage = {
	role: "user" | "assistant"
	content: McpPromptMessageContent
}

export type McpPromptResponse = {
	description?: string
	messages: McpPromptMessage[]
}

export type McpResourceResponse = {
	_meta?: Record<string, any>
	contents: Array<{
		uri: string
		mimeType?: string
		text?: string
		blob?: string
	}>
}

export type McpToolCallResponse = {
	_meta?: Record<string, any>
	content: Array<
		| {
				type: "text"
				text: string
		  }
		| {
				type: "image"
				data: string
				mimeType: string
		  }
		| {
				type: "audio"
				data: string
				mimeType: string
		  }
		| {
				type: "resource"
				resource: {
					uri: string
					mimeType?: string
					text?: string
					blob?: string
				}
		  }
		| {
				type: "resource_link"
				uri: string
				name?: string
				description?: string
				mimeType?: string
		  }
	>
	isError?: boolean
}

export interface McpMarketplaceItem {
	mcpId: string
	githubUrl: string
	name: string
	author: string
	description: string
	codiconIcon: string
	logoUrl: string
	category: string
	tags: string[]
	requiresApiKey: boolean
	readmeContent?: string
	llmsInstallationContent?: string
	isRecommended: boolean
	githubStars: number
	downloadCount: number
	createdAt: string
	updatedAt: string
	lastGithubSync: string
}

export interface McpMarketplaceCatalog {
	items: McpMarketplaceItem[]
}

function normalizeCodeVibeMarketplaceText(value: string | undefined): string | undefined {
	return value
		?.replace(/\bCline's\b/g, "Codie's")
		.replace(/\bcline's\b/g, "Codie's")
		.replace(/\bCline\b/g, "Codie")
		.replace(/\bcline\b/g, "Codie")
}

export function normalizeMcpMarketplaceItem(item: McpMarketplaceItem): McpMarketplaceItem {
	return {
		...item,
		name: normalizeCodeVibeMarketplaceText(item.name) ?? item.name,
		description: normalizeCodeVibeMarketplaceText(item.description) ?? item.description,
		readmeContent: normalizeCodeVibeMarketplaceText(item.readmeContent),
		llmsInstallationContent: normalizeCodeVibeMarketplaceText(item.llmsInstallationContent),
		githubStars: item.githubStars ?? 0,
		downloadCount: item.downloadCount ?? 0,
		tags: item.tags ?? [],
	}
}

export function normalizeMcpMarketplaceCatalog(catalog: McpMarketplaceCatalog): McpMarketplaceCatalog {
	return { items: (catalog.items ?? []).map((item) => normalizeMcpMarketplaceItem(item)) }
}

export interface McpDownloadResponse {
	mcpId: string
	githubUrl: string
	name: string
	author: string
	description: string
	readmeContent: string
	llmsInstallationContent: string
	requiresApiKey: boolean
}

export type McpViewTab = "marketplace" | "addRemote" | "configure"
