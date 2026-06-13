export type CodieSettingsSection =
	| "General"
	| "Providers"
	| "Customizations"
	| "MCP"
	| "Compatibility"
	| "Channels"
	| "Schedules"
	| "Account";

const CURSOR_SETTINGS_INTENT_PARAMS = new Set([
	"config",
	"query",
	"section",
	"tab",
]);

const CURSOR_LINK_INTENT_PATHS = new Set([
	"/createchat",
	"/mcp/install",
	"/background-agent",
	"/prompt",
	"/command",
	"/rule",
	"/pr-review",
	"/plugin/add",
	"/glass",
	"/automation/ingest",
	"/git/checkout",
	"/git/branch",
	"/git/commit",
]);

const EXACT_SECTION_SLUGS = new Map<string, CodieSettingsSection>([
	["account", "Account"],
	["accounts", "Account"],
	["automation-ingest", "Compatibility"],
	["browser-evaluate", "Compatibility"],
	["channels", "Channels"],
	["codex", "Providers"],
	["codex-auth", "Providers"],
	["compatibility", "Compatibility"],
	["connectors", "Channels"],
	["cursor-compatibility", "Compatibility"],
	["cursor-links", "Compatibility"],
	["customizations", "Customizations"],
	["deep-links", "Compatibility"],
	["deeplinks", "Compatibility"],
	["general", "General"],
	["mcp", "MCP"],
	["models", "Providers"],
	["ndjson", "Compatibility"],
	["openai-codex", "Providers"],
	["openai-codex-auth", "Providers"],
	["plugins", "Customizations"],
	["privacy-gate", "Compatibility"],
	["provider", "Providers"],
	["providers", "Providers"],
	["retrieval-indexing", "Compatibility"],
	["rules", "Customizations"],
	["safe-browser-evaluate", "Compatibility"],
	["sandbox", "Compatibility"],
	["sandbox-policy", "Compatibility"],
	["schedules", "Schedules"],
	["settings", "General"],
	["skills", "Customizations"],
]);

function normalizeLabel(value: string): string {
	return value
		.trim()
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.toLowerCase()
		.replace(/[_\s]+/g, "-")
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-|-$/g, "");
}

function searchParamsFrom(search: string | URLSearchParams): URLSearchParams {
	if (search instanceof URLSearchParams) {
		return search;
	}
	const query = search.startsWith("?") ? search.slice(1) : search;
	return new URLSearchParams(query);
}

function recordString(
	record: Record<string, unknown> | undefined,
	key: string,
): string {
	const value = record?.[key];
	return typeof value === "string" ? value.trim() : "";
}

export function normalizeCursorLinkPath(pathname: string): string {
	if (pathname.length > 1 && pathname.endsWith("/")) {
		return pathname.replace(/\/+$/, "");
	}
	return pathname;
}

export function hasCursorSettingsIntentParams(
	search: string | URLSearchParams,
): boolean {
	const params = searchParamsFrom(search);
	for (const key of params.keys()) {
		if (CURSOR_SETTINGS_INTENT_PARAMS.has(key)) {
			return true;
		}
	}
	return false;
}

export function isCursorSettingsIntentPath(
	pathname: string,
	search: string | URLSearchParams,
): boolean {
	return (
		normalizeCursorLinkPath(pathname) === "/settings" &&
		hasCursorSettingsIntentParams(search)
	);
}

export function isCursorLinkPreviewIntentPath(
	pathname: string,
	search: string | URLSearchParams = "",
): boolean {
	const normalized = normalizeCursorLinkPath(pathname);
	if (isCursorSettingsIntentPath(normalized, search)) {
		return false;
	}
	return CURSOR_LINK_INTENT_PATHS.has(normalized);
}

export function cursorSettingsSectionFromValues(values: {
	query?: string;
	sourceParam?: string;
}): CodieSettingsSection {
	const sourceParam = normalizeLabel(values.sourceParam ?? "");
	const query = normalizeLabel(values.query ?? "");
	const exact =
		EXACT_SECTION_SLUGS.get(query) ?? EXACT_SECTION_SLUGS.get(sourceParam);
	if (exact) {
		return exact;
	}

	const target = `${sourceParam} ${query}`;
	if (
		/\b(provider|model|models|api|apikey|api-key|api-provider)\b/.test(target)
	) {
		return "Providers";
	}
	if (/\b(mcp|server|servers|tool)\b/.test(target)) {
		return "MCP";
	}
	if (
		/\b(rule|rules|customization|customizations|hook|hooks|skill|skills|plugin|plugins)\b/.test(
			target,
		)
	) {
		return "Customizations";
	}
	if (
		/\b(cursor-link|cursor-links|deeplink|deep-link|uri|url|ndjson|sandbox|browser-evaluate)\b/.test(
			target,
		)
	) {
		return "Compatibility";
	}
	if (
		/\b(channel|channels|connector|connectors|slack|outlook|sharepoint)\b/.test(
			target,
		)
	) {
		return "Channels";
	}
	if (/\b(schedule|schedules|routine|cron|automation)\b/.test(target)) {
		return "Schedules";
	}
	if (/\b(account|accounts|auth|login|sign-in|oauth)\b/.test(target)) {
		return "Account";
	}
	return "General";
}

export function cursorSettingsSectionFromSearch(
	search: string | URLSearchParams,
): CodieSettingsSection {
	const params = searchParamsFrom(search);
	for (const key of ["section", "tab", "query", "config"]) {
		const value = params.get(key)?.trim();
		if (value) {
			return cursorSettingsSectionFromValues({
				query: value,
				sourceParam: key,
			});
		}
	}
	return "General";
}

export function cursorSettingsSectionFromPreview(
	previewRecord: Record<string, unknown> | undefined,
): CodieSettingsSection {
	return cursorSettingsSectionFromValues({
		query: recordString(previewRecord, "query"),
		sourceParam: recordString(previewRecord, "sourceParam"),
	});
}
