import { Llms, type ProviderSettings } from "@cline/core";
import { isOAuthProviderId } from "@cline/shared";

export const DEFAULT_CLI_PROVIDER_ID = Llms.BUILT_IN_PROVIDER.OPENAI_CODEX;
export const DEFAULT_CLI_MODEL_ID =
	Llms.MODEL_COLLECTIONS_BY_PROVIDER_ID[DEFAULT_CLI_PROVIDER_ID]?.provider
		.defaultModelId ?? "gpt-5.5-pro";

export type OAuthCredentials = {
	access: string;
	refresh: string;
	expires: number;
	accountId?: string;
	email?: string;
	metadata?: Record<string, unknown>;
};

export function normalizeProviderId(providerId: string): string {
	return Llms.normalizeProviderId(providerId.trim());
}

export function normalizeAuthProviderId(providerId: string): string {
	const normalized = providerId.trim().toLowerCase();
	if (
		normalized === "codex" ||
		normalized === "codie" ||
		normalized === "openai-codex"
	) {
		return "openai-codex";
	}
	if (normalized === "codie-cloud" || normalized === "codevibe-cloud") {
		return "cline";
	}
	return normalizeProviderId(normalized);
}

export function getAuthProviderDisplayName(
	providerId: string,
	fallbackName?: string,
): string {
	const normalized = normalizeAuthProviderId(providerId);
	if (normalized === "openai-codex") {
		return "Codie";
	}
	if (normalized === "cline") {
		return "Codie Cloud";
	}
	if (normalized === "oca") {
		return "OCA";
	}
	return fallbackName?.trim() || providerId;
}

/**
 * Re-exports `isOAuthProviderId` from `@cline/shared` so the CLI has a
 * single source of truth for the OAuth provider list. Existing call sites
 * keep their `isOAuthProvider` import name.
 */
export const isOAuthProvider = isOAuthProviderId;

export function toProviderApiKey(
	providerId: string,
	credentials: Pick<OAuthCredentials, "access">,
): string {
	if (normalizeAuthProviderId(providerId) === "cline") {
		return credentials.access.startsWith("workos:")
			? credentials.access
			: `workos:${credentials.access}`;
	}
	return credentials.access;
}

export function getPersistedProviderApiKey(
	providerId: string,
	settings?: ProviderSettings,
): string | undefined {
	const accessToken = settings?.auth?.accessToken?.trim();
	if (accessToken) {
		return toProviderApiKey(providerId, { access: accessToken });
	}
	const shorthandKey = settings?.apiKey?.trim();
	if (shorthandKey) {
		return shorthandKey;
	}
	const authKey = settings?.auth?.apiKey?.trim();
	if (authKey) {
		return authKey;
	}
	return undefined;
}

/**
 * Returns true when the user has previously saved any meaningful credentials
 * or endpoint config for the provider. Used by the picker to decide whether
 * to offer "Use existing configuration?" before opening the configure dialog.
 *
 * Treats OAuth providers as configured when an access token is present; for
 * everything else, any persisted API key, base URL, or model id counts. We
 * don't enforce required fields here — the runtime no longer pre-flights
 * credentials, so a missing key only matters when the API call actually
 * runs and the provider's own auth error is surfaced.
 */
export function isProviderConfigured(
	providerId: string,
	settings: ProviderSettings | undefined,
): boolean {
	if (!settings) return false;
	const normalizedProviderId = normalizeAuthProviderId(providerId);
	if (isOAuthProviderId(normalizedProviderId)) {
		return Boolean(settings.auth?.accessToken?.trim());
	}
	if (getPersistedProviderApiKey(normalizedProviderId, settings)) return true;
	if (settings.baseUrl?.trim()) return true;
	if (settings.model?.trim()) return true;
	return false;
}

export async function ensureOAuthProviderApiKey(
	input: Parameters<
		typeof import("../commands/auth").ensureOAuthProviderApiKey
	>[0],
): Promise<
	Awaited<
		ReturnType<typeof import("../commands/auth").ensureOAuthProviderApiKey>
	>
> {
	const { ensureOAuthProviderApiKey: ensureFromCommand } = await import(
		"../commands/auth"
	);
	return await ensureFromCommand(input);
}
