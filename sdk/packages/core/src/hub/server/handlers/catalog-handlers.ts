import type {
	HubCommandEnvelope,
	HubModelCatalog,
	HubModelCatalogModel,
	HubModelCatalogProvider,
	HubReplyEnvelope,
} from "@cline/shared";
import { getProviderConfig as getProviderDefaults } from "../../../services/llms/provider-defaults";
import type { ModelInfo } from "../../../services/llms/provider-settings";
import { BUILT_IN_PROVIDER_IDS } from "../../../services/llms/provider-settings";
import { ProviderSettingsManager } from "../../../services/storage/provider-settings-manager";
import { errorReply, okReply } from "./context";

const OPENAI_CODEX_PROVIDER_ID = "openai-codex";

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function titleCaseProviderName(providerId: string): string {
	return providerId
		.split(/[-_]/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function toHubModels(
	knownModels: Record<string, ModelInfo> | undefined,
): HubModelCatalogModel[] {
	return Object.entries(knownModels ?? {}).map(([id, info]) => ({
		id,
		...(asString(info.name) ? { name: asString(info.name) } : {}),
		...(info.thinkingConfig || info.capabilities?.includes("reasoning")
			? { supportsThinking: true }
			: {}),
	}));
}

function readSelectionModel(settings: unknown): string | undefined {
	const record =
		settings && typeof settings === "object" && !Array.isArray(settings)
			? (settings as Record<string, unknown>)
			: undefined;
	return asString(record?.model) ?? asString(record?.modelId);
}

export function handleCatalogList(
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	try {
		const manager = new ProviderSettingsManager();
		const state = manager.read();
		const defaultProviderId =
			asString(state.lastUsedProvider) ?? OPENAI_CODEX_PROVIDER_ID;
		const providerIds = [
			...new Set([
				OPENAI_CODEX_PROVIDER_ID,
				...BUILT_IN_PROVIDER_IDS,
				...Object.keys(state.providers),
			]),
		];
		const providers: HubModelCatalogProvider[] = [];
		const modelsByProvider: HubModelCatalog["modelsByProvider"] = {};

		for (const providerId of providerIds) {
			const defaults = getProviderDefaults(providerId);
			const settingsEntry = state.providers[providerId];
			const selectedModel = readSelectionModel(settingsEntry?.settings);
			const defaultModelId = selectedModel ?? defaults?.modelId;
			const models = defaults?.knownModels
				? toHubModels(defaults.knownModels)
				: defaultModelId
					? [{ id: defaultModelId }]
					: [];
			providers.push({
				id: providerId,
				name: titleCaseProviderName(providerId),
				enabled: providerId === defaultProviderId || Boolean(settingsEntry),
				...(defaultModelId ? { defaultModelId } : {}),
			});
			modelsByProvider[providerId] = models;
		}

		const defaultModelId =
			readSelectionModel(state.providers[defaultProviderId]?.settings) ??
			getProviderDefaults(defaultProviderId)?.modelId ??
			getProviderDefaults(OPENAI_CODEX_PROVIDER_ID)?.modelId;
		const catalog: HubModelCatalog = {
			providers,
			modelsByProvider,
			...(defaultModelId
				? {
						defaultSelection: {
							providerId: defaultProviderId,
							modelId: defaultModelId,
						},
					}
				: {}),
		};
		return okReply(envelope, { catalog });
	} catch (error) {
		return errorReply(
			envelope,
			"catalog_list_failed",
			error instanceof Error ? error.message : String(error),
		);
	}
}
