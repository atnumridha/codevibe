import {
	getClineEnvironmentConfig,
	type ITelemetryService,
	isOAuthProviderId,
	type OAuthProviderId,
} from "@cline/shared";
import {
	type ClineOAuthCredentials,
	getValidClineCredentials,
} from "../../auth/cline";
import {
	getValidOpenAICodexCredentials,
	loadOpenAICodexHomeCredentialsSync,
} from "../../auth/codex";
import { getValidOcaCredentials } from "../../auth/oca";
import { decodeJwtPayload } from "../../auth/utils";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";
import type { ProviderSettings } from "../../types/provider-settings";

const WORKOS_TOKEN_PREFIX = "workos:";

type ManagedOAuthProviderId = OAuthProviderId;

function toStoredAccessToken(
	providerId: ManagedOAuthProviderId,
	accessToken: string,
): string {
	if (providerId === "cline") {
		return `${WORKOS_TOKEN_PREFIX}${accessToken}`;
	}
	return accessToken;
}

function fromStoredAccessToken(
	providerId: ManagedOAuthProviderId,
	accessToken: string,
): string {
	if (
		providerId === "cline" &&
		accessToken.toLowerCase().startsWith(WORKOS_TOKEN_PREFIX)
	) {
		return accessToken.slice(WORKOS_TOKEN_PREFIX.length);
	}
	return accessToken;
}

function readExpiryFromToken(accessToken: string): number | null {
	const payload = decodeJwtPayload(accessToken);
	const exp = payload?.exp;
	if (typeof exp === "number" && exp > 0) {
		return exp * 1000;
	}
	return null;
}

function deriveCredentialExpiry(
	settings: ProviderSettings,
	normalizedAccessToken: string,
): number {
	const explicitExpiry = (
		settings.auth as
			| (ProviderSettings["auth"] & { expiresAt?: number })
			| undefined
	)?.expiresAt;
	if (
		typeof explicitExpiry === "number" &&
		Number.isFinite(explicitExpiry) &&
		explicitExpiry > 0
	) {
		return explicitExpiry;
	}

	const jwtExpiry = readExpiryFromToken(normalizedAccessToken);
	if (jwtExpiry) {
		return jwtExpiry;
	}

	// Unknown expiry should trigger refresh on next resolution.
	return Date.now() - 1;
}

function trimStringField(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export type RuntimeOpenAICodexMetadata = {
	accountId?: string;
	installationId?: string;
	clientVersion?: string;
	tokenSource?: string;
	authMode?: string;
};

function compactCodexMetadata(
	metadata: RuntimeOpenAICodexMetadata,
): RuntimeOpenAICodexMetadata | undefined {
	const compacted = Object.fromEntries(
		Object.entries(metadata).filter(([, value]) => value !== undefined),
	) as RuntimeOpenAICodexMetadata;
	return Object.keys(compacted).length > 0 ? compacted : undefined;
}

function readCodexMetadataFromAuth(
	auth: ProviderSettings["auth"] | undefined,
): RuntimeOpenAICodexMetadata | undefined {
	return compactCodexMetadata({
		accountId: trimStringField(auth?.accountId),
		installationId: trimStringField(auth?.installationId),
		clientVersion: trimStringField(auth?.clientVersion),
		tokenSource: trimStringField(auth?.tokenSource),
		authMode: trimStringField(auth?.authMode),
	});
}

function readCodexMetadataFromCredentials(
	credentials: ClineOAuthCredentials,
	fallbackAuth: ProviderSettings["auth"] | undefined,
): RuntimeOpenAICodexMetadata | undefined {
	const metadata = credentials.metadata ?? {};
	return compactCodexMetadata({
		accountId:
			trimStringField(credentials.accountId) ??
			trimStringField(metadata.accountId) ??
			trimStringField(fallbackAuth?.accountId),
		installationId:
			trimStringField(metadata.installationId) ??
			trimStringField(fallbackAuth?.installationId),
		clientVersion:
			trimStringField(metadata.clientVersion) ??
			trimStringField(fallbackAuth?.clientVersion),
		tokenSource:
			trimStringField(metadata.tokenSource) ??
			trimStringField(fallbackAuth?.tokenSource),
		authMode:
			trimStringField(metadata.authMode) ??
			trimStringField(fallbackAuth?.authMode),
	});
}

function toCredentials(
	providerId: ManagedOAuthProviderId,
	settings: ProviderSettings,
): ClineOAuthCredentials | null {
	const rawAccess = settings.auth?.accessToken?.trim();
	const refreshToken = settings.auth?.refreshToken?.trim();
	if (!rawAccess || !refreshToken) {
		return null;
	}
	const access = fromStoredAccessToken(providerId, rawAccess);
	if (!access) {
		return null;
	}

	return {
		access,
		refresh: refreshToken,
		expires: deriveCredentialExpiry(settings, access),
		accountId: settings.auth?.accountId,
		...(providerId === "openai-codex"
			? {
					metadata: {
						provider: "openai-codex",
						...(readCodexMetadataFromAuth(settings.auth) ?? {}),
					},
				}
			: {}),
	};
}

function toOpenAICodexSettingsFromCredentials(
	credentials: ClineOAuthCredentials,
): ProviderSettings {
	const codex = readCodexMetadataFromCredentials(credentials, undefined);
	const auth = {
		accessToken: toStoredAccessToken("openai-codex", credentials.access),
		refreshToken: credentials.refresh,
		accountId: credentials.accountId ?? codex?.accountId,
		...(codex ?? {}),
	} as ProviderSettings["auth"] & { expiresAt?: number };
	auth.expiresAt = credentials.expires;
	return {
		provider: "openai-codex",
		auth,
	};
}

function authSettingsEqual(
	a: ProviderSettings["auth"] | undefined,
	b: ProviderSettings["auth"] | undefined,
): boolean {
	const aExpiry = (
		a as (ProviderSettings["auth"] & { expiresAt?: number }) | undefined
	)?.expiresAt;
	const bExpiry = (
		b as (ProviderSettings["auth"] & { expiresAt?: number }) | undefined
	)?.expiresAt;
	return (
		a?.accessToken === b?.accessToken &&
		a?.refreshToken === b?.refreshToken &&
		a?.accountId === b?.accountId &&
		a?.installationId === b?.installationId &&
		a?.clientVersion === b?.clientVersion &&
		a?.tokenSource === b?.tokenSource &&
		a?.authMode === b?.authMode &&
		aExpiry === bExpiry
	);
}

export class OAuthReauthRequiredError extends Error {
	public readonly providerId: ManagedOAuthProviderId;

	constructor(providerId: ManagedOAuthProviderId) {
		super(
			`OAuth credentials for provider "${providerId}" are no longer valid. Re-run authentication for this provider.`,
		);
		this.name = "OAuthReauthRequiredError";
		this.providerId = providerId;
	}
}

export type RuntimeOAuthResolution = {
	providerId: ManagedOAuthProviderId;
	apiKey: string;
	accountId?: string;
	codex?: RuntimeOpenAICodexMetadata;
	refreshed: boolean;
};

export class RuntimeOAuthTokenManager {
	private readonly providerSettingsManager: ProviderSettingsManager;
	private readonly telemetry?: ITelemetryService;
	private readonly refreshInFlight = new Map<
		string,
		Promise<RuntimeOAuthResolution | null>
	>();

	constructor(options?: {
		providerSettingsManager?: ProviderSettingsManager;
		telemetry?: ITelemetryService;
	}) {
		this.providerSettingsManager =
			options?.providerSettingsManager ?? new ProviderSettingsManager();
		this.telemetry = options?.telemetry;
	}

	public async resolveProviderApiKey(input: {
		providerId: string;
		forceRefresh?: boolean;
		workspaceRoots?: readonly string[];
	}): Promise<RuntimeOAuthResolution | null> {
		if (!isOAuthProviderId(input.providerId)) {
			return null;
		}
		return this.resolveWithSingleFlight(
			input.providerId,
			input.forceRefresh,
			input.workspaceRoots,
		);
	}

	private async resolveWithSingleFlight(
		providerId: ManagedOAuthProviderId,
		forceRefresh = false,
		workspaceRoots?: readonly string[],
	): Promise<RuntimeOAuthResolution | null> {
		const singleFlightKey = `${providerId}:${(workspaceRoots ?? []).join("\0")}`;
		const currentInFlight = this.refreshInFlight.get(singleFlightKey);
		if (currentInFlight) {
			return currentInFlight;
		}
		const pending = this.resolveProviderApiKeyInternal(
			providerId,
			forceRefresh,
			workspaceRoots,
		)
			.catch((error) => {
				throw error;
			})
			.finally(() => {
				this.refreshInFlight.delete(singleFlightKey);
			});
		this.refreshInFlight.set(singleFlightKey, pending);
		return pending;
	}

	private async resolveProviderApiKeyInternal(
		providerId: ManagedOAuthProviderId,
		forceRefresh: boolean,
		workspaceRoots?: readonly string[],
	): Promise<RuntimeOAuthResolution | null> {
		let settings = this.providerSettingsManager.getProviderSettings(providerId);
		let settingsFromCodexHome = false;
		if (!settings && providerId === "openai-codex") {
			let codexHomeCredentials: ClineOAuthCredentials | null;
			try {
				codexHomeCredentials = loadOpenAICodexHomeCredentialsSync({
					workspaceRoots,
				});
			} catch {
				codexHomeCredentials = null;
			}
			if (codexHomeCredentials) {
				settings =
					toOpenAICodexSettingsFromCredentials(codexHomeCredentials);
				settingsFromCodexHome = true;
			}
		}
		if (!settings) {
			return null;
		}

		const currentCredentials = toCredentials(providerId, settings);
		if (!currentCredentials) {
			return null;
		}

		const nextCredentials = await this.resolveCredentials(
			providerId,
			settings,
			currentCredentials,
			forceRefresh,
		);
		if (!nextCredentials) {
			throw new OAuthReauthRequiredError(providerId);
		}

		const persistedAccessToken = toStoredAccessToken(
			providerId,
			nextCredentials.access,
		);
		const codex =
			providerId === "openai-codex"
				? readCodexMetadataFromCredentials(nextCredentials, settings.auth)
				: undefined;
		const nextAuth = {
			...(settings.auth ?? {}),
			accessToken: persistedAccessToken,
			refreshToken: nextCredentials.refresh,
			accountId: nextCredentials.accountId ?? settings.auth?.accountId,
			...(codex ?? {}),
		} as ProviderSettings["auth"] & { expiresAt?: number };
		nextAuth.expiresAt = nextCredentials.expires;
		const nextSettings: ProviderSettings = {
			...settings,
			auth: nextAuth,
		};
		const wasRefreshed = !authSettingsEqual(settings.auth, nextSettings.auth);
		if (wasRefreshed || settingsFromCodexHome) {
			this.providerSettingsManager.saveProviderSettings(nextSettings, {
				setLastUsed: false,
				tokenSource: "oauth",
			});
		}

		return {
			providerId,
			apiKey: persistedAccessToken,
			accountId: nextAuth.accountId,
			...(codex ? { codex } : {}),
			refreshed: wasRefreshed,
		};
	}

	private async resolveCredentials(
		providerId: ManagedOAuthProviderId,
		settings: ProviderSettings,
		currentCredentials: ClineOAuthCredentials,
		forceRefresh: boolean,
	): Promise<ClineOAuthCredentials | null> {
		if (providerId === "cline") {
			return getValidClineCredentials(
				currentCredentials,
				{
					apiBaseUrl:
						settings.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl,
					telemetry: this.telemetry,
				},
				{ forceRefresh },
			);
		}
		if (providerId === "oca") {
			return getValidOcaCredentials(
				currentCredentials,
				{ forceRefresh, telemetry: this.telemetry },
				{ mode: settings.oca?.mode, telemetry: this.telemetry },
			);
		}
		return getValidOpenAICodexCredentials(currentCredentials, {
			forceRefresh,
			telemetry: this.telemetry,
		});
	}
}
