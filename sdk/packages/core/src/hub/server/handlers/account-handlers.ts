import type {
	HubCommandEnvelope,
	HubCurrentAccountResponse,
	HubReplyEnvelope,
} from "@cline/shared";
import {
	isOpenAICodexTokenExpired,
	loadOpenAICodexHomeCredentialsSync,
} from "../../../auth/codex";
import { getProviderConfig as getProviderDefaults } from "../../../services/llms/provider-defaults";
import { ProviderSettingsManager } from "../../../services/storage/provider-settings-manager";
import { errorReply, okReply } from "./context";

const OPENAI_CODEX_PROVIDER_ID = "openai-codex";

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function metadataString(
	metadata: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	return asString(metadata?.[key]);
}

function expiresAtIso(expires: number | undefined): string | undefined {
	if (typeof expires !== "number" || !Number.isFinite(expires)) {
		return undefined;
	}
	return new Date(expires).toISOString();
}

function readProviderSelection(): {
	providerId: string;
	modelId?: string;
	providerSource: HubCurrentAccountResponse["providerSource"];
} {
	const manager = new ProviderSettingsManager();
	const state = manager.read();
	const providerId = asString(state.lastUsedProvider) ?? OPENAI_CODEX_PROVIDER_ID;
	const settings = state.providers[providerId]?.settings as
		| Record<string, unknown>
		| undefined;
	const modelId =
		asString(settings?.model) ??
		asString(settings?.modelId) ??
		getProviderDefaults(providerId)?.modelId ??
		(providerId === OPENAI_CODEX_PROVIDER_ID
			? getProviderDefaults(OPENAI_CODEX_PROVIDER_ID)?.modelId
			: undefined);
	return {
		providerId,
		...(modelId ? { modelId } : {}),
		providerSource: state.lastUsedProvider ? "provider-settings" : "default",
	};
}

function buildCodexHomeStatus(): HubCurrentAccountResponse["codex"] {
	const credentials = loadOpenAICodexHomeCredentialsSync();
	if (!credentials) {
		return {
			authSource: "codex-home",
			authenticated: false,
		};
	}
	return {
		authSource: "codex-home",
		authenticated: true,
		...(metadataString(credentials.metadata, "tokenSource")
			? { tokenSource: metadataString(credentials.metadata, "tokenSource") }
			: {}),
		...(credentials.accountId ? { accountId: credentials.accountId } : {}),
		...(credentials.email ? { email: credentials.email } : {}),
		...(expiresAtIso(credentials.expires)
			? { expiresAt: expiresAtIso(credentials.expires) }
			: {}),
		expired: isOpenAICodexTokenExpired(credentials),
		...(metadataString(credentials.metadata, "installationId")
			? {
					installationId: metadataString(
						credentials.metadata,
						"installationId",
					),
				}
			: {}),
		...(metadataString(credentials.metadata, "clientVersion")
			? { clientVersion: metadataString(credentials.metadata, "clientVersion") }
			: {}),
		...(metadataString(credentials.metadata, "authMode")
			? { authMode: metadataString(credentials.metadata, "authMode") }
			: {}),
	};
}

export function handleAccountGetCurrent(
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	try {
		const selection = readProviderSelection();
		const payload: HubCurrentAccountResponse = {
			providerId: selection.providerId,
			...(selection.modelId ? { modelId: selection.modelId } : {}),
			providerSource: selection.providerSource,
			codex: buildCodexHomeStatus(),
		};
		return okReply(envelope, payload);
	} catch (error) {
		return errorReply(
			envelope,
			"account_get_current_failed",
			error instanceof Error ? error.message : String(error),
		);
	}
}
