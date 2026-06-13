const CODIE_WEB_TOOLS_PROVIDER_IDS = new Set(["cline", "openai-codex"])

export function supportsCodieWebToolsProvider(providerId: string | undefined): boolean {
	return CODIE_WEB_TOOLS_PROVIDER_IDS.has(providerId?.trim().toLowerCase() ?? "")
}
