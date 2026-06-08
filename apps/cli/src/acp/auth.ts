import {
	loadOpenAICodexHomeCredentialsSync,
	type ProviderSettings,
	type ProviderSettingsManager,
} from "@cline/core";
import { getClineEnvironmentConfig } from "@cline/shared";
import type { OAuthCredentials } from "../commands/auth";
import {
	getPersistedProviderApiKey,
	saveOAuthProviderSettings,
	toProviderApiKey,
} from "../commands/auth";
import { writeDiagnostic } from "../utils/output";

/**
 * Supported ACP OAuth provider IDs.
 */
export const ACP_AUTH_METHODS = [
	{ id: "openai-codex", name: "Sign in with ChatGPT Subscription" },
	{ id: "cline", name: "Sign in with CodeVibe Account" },
] as const;

export type AcpAuthMethodId = (typeof ACP_AUTH_METHODS)[number]["id"];

export function isAcpAuthMethodId(id: string): id is AcpAuthMethodId {
	return ACP_AUTH_METHODS.some((m) => m.id === id);
}

/**
 * Perform an OAuth login for the given provider in ACP mode.
 *
 * Since stdin/stdout are used for the JSON-RPC transport, all user-facing
 * output is written to stderr and URLs are opened via the `open` package.
 * If the OAuth flow requires interactive prompts (rare), defaults are used
 * when available; otherwise an error is thrown.
 */
async function performOAuthLogin(
	providerId: AcpAuthMethodId,
	existingSettings: ProviderSettings | undefined,
): Promise<OAuthCredentials> {
	const [{ createOAuthClientCallbacks }, { default: open }, coreOAuth] =
		await Promise.all([
			import("@cline/core"),
			import("open"),
			import("@cline/core").then((m) => ({
				loginClineOAuth: m.loginClineOAuth as (input: {
					useWorkOSDeviceAuth?: boolean;
					apiBaseUrl: string;
					callbacks: {
						onAuth: (info: { url: string; instructions?: string }) => void;
						onPrompt: (prompt: {
							message: string;
							defaultValue?: string;
						}) => Promise<string>;
						onManualCodeInput?: () => Promise<string>;
					};
				}) => Promise<OAuthCredentials>,
				loginOpenAICodex: m.loginOpenAICodex as (input: {
					onAuth: (info: { url: string; instructions?: string }) => void;
					onPrompt: (prompt: {
						message: string;
						defaultValue?: string;
					}) => Promise<string>;
					onManualCodeInput?: () => Promise<string>;
				}) => Promise<OAuthCredentials>,
			})),
		]);

	const callbacks = createOAuthClientCallbacks({
		onPrompt: ({ defaultValue }) => {
			if (defaultValue) {
				return Promise.resolve(defaultValue);
			}
			return Promise.reject(
				new Error(
					"OAuth flow requires interactive input which is unavailable in ACP mode",
				),
			);
		},
		onOutput: (message) => writeDiagnostic(`[acp/auth] ${message}`),
		openUrl: (url) => open(url, { wait: false }).then(() => undefined),
		onOpenUrlError: ({ url }) => {
			writeDiagnostic(
				`[acp/auth] Could not open browser automatically. Open this URL manually:\n${url}`,
			);
		},
	});

	if (providerId === "cline") {
		return coreOAuth.loginClineOAuth({
			apiBaseUrl:
				existingSettings?.baseUrl?.trim() ||
				getClineEnvironmentConfig().apiBaseUrl,
			callbacks,
			useWorkOSDeviceAuth: true,
		});
	}

	// openai-codex
	return coreOAuth.loginOpenAICodex(callbacks);
}

export interface AcpAuthResult {
	providerId: AcpAuthMethodId;
	apiKey: string;
}

export function restoreOpenAICodexHomeAcpAuth(
	providerSettingsManager: ProviderSettingsManager,
): AcpAuthResult | undefined {
	let credentials: OAuthCredentials | null;
	try {
		credentials = loadOpenAICodexHomeCredentialsSync();
	} catch {
		return undefined;
	}
	if (!credentials) {
		return undefined;
	}

	const providerId = "openai-codex";
	const existing = providerSettingsManager.getProviderSettings(providerId);
	const settings = saveOAuthProviderSettings(
		providerSettingsManager,
		providerId,
		existing,
		credentials,
	);
	return {
		providerId,
		apiKey:
			getPersistedProviderApiKey(providerId, settings) ??
			toProviderApiKey(providerId, credentials),
	};
}

/**
 * Authenticate via OAuth for the given ACP auth method.
 *
 * Uses `ProviderSettingsManager` to check for existing credentials first,
 * falling back to a fresh OAuth login if needed.
 */
export async function authenticateAcpProvider(
	methodId: AcpAuthMethodId,
	providerSettingsManager: ProviderSettingsManager,
): Promise<AcpAuthResult> {
	const existing = providerSettingsManager.getProviderSettings(methodId);

	// Check for already-stored credentials.
	const existingKey = getPersistedProviderApiKey(methodId, existing);
	if (existingKey) {
		writeDiagnostic(`[acp/auth] Using existing credentials for ${methodId}`);
		return { providerId: methodId, apiKey: existingKey };
	}

	if (methodId === "openai-codex") {
		const codexHomeAuth =
			restoreOpenAICodexHomeAcpAuth(providerSettingsManager);
		if (codexHomeAuth) {
			writeDiagnostic(`[acp/auth] Using Codex Home credentials for ${methodId}`);
			return codexHomeAuth;
		}
	}

	// Perform a fresh OAuth login.
	writeDiagnostic(`[acp/auth] Starting OAuth login for ${methodId}…`);
	const credentials = await performOAuthLogin(methodId, existing);

	saveOAuthProviderSettings(
		providerSettingsManager,
		methodId,
		existing,
		credentials,
	);

	const apiKey = toProviderApiKey(methodId, credentials);
	writeDiagnostic(`[acp/auth] Successfully authenticated with ${methodId}`);
	return { providerId: methodId, apiKey };
}
