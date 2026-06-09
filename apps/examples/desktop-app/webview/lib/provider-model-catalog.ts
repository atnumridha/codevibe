"use client"

import { desktopClient } from "@/lib/desktop-client"
import {
	CODEVIBE_AGENT_DEFAULT_MODEL_ID,
	CODEVIBE_AGENT_PROVIDER_ID,
	prioritizeCodeVibeProviderIds,
} from "@/lib/provider-display"
import type { Provider, ProviderCatalogResponse, ProviderModel, ProviderModelsResponse } from "@/lib/provider-schema"

export type ProviderModelCatalog = {
	providers: Provider[]
	enabledProviderIds: string[]
	providerModels: Record<string, string[]>
	providerReasoningModels: Record<string, string[]>
}

function toModelIds(models: ProviderModel[] | undefined): string[] {
	return (models ?? []).map((model) => model.id)
}

function toReasoningModelIds(models: ProviderModel[] | undefined): string[] {
	return (models ?? []).filter((model) => model.supportsReasoning).map((model) => model.id)
}

const CODEVIBE_AGENT_MODEL: ProviderModel = {
	id: CODEVIBE_AGENT_DEFAULT_MODEL_ID,
	name: "GPT-5.5",
	supportsReasoning: true,
}

function withCodeVibeAgentProvider(providers: Provider[]): Provider[] {
	const existing = providers.find((provider) => provider.id === CODEVIBE_AGENT_PROVIDER_ID)
	if (existing) {
		const modelList = existing.modelList && existing.modelList.length > 0 ? existing.modelList : [CODEVIBE_AGENT_MODEL]
		return providers.map((provider) =>
			provider.id === CODEVIBE_AGENT_PROVIDER_ID
				? {
						...provider,
						name: "CodeVibe Agent",
						letter: "CV",
						enabled: true,
						defaultModelId: provider.defaultModelId || CODEVIBE_AGENT_DEFAULT_MODEL_ID,
						models: Math.max(provider.models ?? 0, modelList.length),
						modelList,
					}
				: provider,
		)
	}
	return [
		{
			id: CODEVIBE_AGENT_PROVIDER_ID,
			name: "CodeVibe Agent",
			models: 1,
			color: "#5b9bd5",
			letter: "CV",
			enabled: true,
			defaultModelId: CODEVIBE_AGENT_DEFAULT_MODEL_ID,
			authDescription: "Uses your local Codex auth from ~/.codex/auth.json by default.",
			baseUrlDescription: "Uses the Codex backend endpoint unless overridden in settings.",
			modelList: [CODEVIBE_AGENT_MODEL],
		},
		...providers,
	]
}

function orderModelsForProvider(providerId: string, modelIds: string[]): string[] {
	if (providerId !== CODEVIBE_AGENT_PROVIDER_ID) {
		return modelIds
	}
	return [...modelIds].sort((a, b) => {
		if (a === CODEVIBE_AGENT_DEFAULT_MODEL_ID) return -1
		if (b === CODEVIBE_AGENT_DEFAULT_MODEL_ID) return 1
		return a.localeCompare(b)
	})
}

export function buildProviderModelCatalog(providers: Provider[]): ProviderModelCatalog {
	const normalizedProviders = withCodeVibeAgentProvider(providers)
	return {
		providers: [...normalizedProviders].sort((a, b) => {
			if (a.id === CODEVIBE_AGENT_PROVIDER_ID) return -1
			if (b.id === CODEVIBE_AGENT_PROVIDER_ID) return 1
			return a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
		}),
		enabledProviderIds: prioritizeCodeVibeProviderIds(
			normalizedProviders.filter((provider) => provider.enabled).map((provider) => provider.id),
		),
		providerModels: Object.fromEntries(
			normalizedProviders.map((provider) => [
				provider.id,
				orderModelsForProvider(provider.id, toModelIds(provider.modelList)),
			]),
		),
		providerReasoningModels: Object.fromEntries(
			normalizedProviders.map((provider) => [provider.id, toReasoningModelIds(provider.modelList)]),
		),
	}
}

export async function loadProviderModelCatalog(): Promise<ProviderModelCatalog> {
	const payload = await desktopClient.invoke<ProviderCatalogResponse>("list_provider_catalog")
	return buildProviderModelCatalog(payload.providers ?? [])
}

export async function loadProviderModels(providerId: string): Promise<ProviderModel[]> {
	const payload = await desktopClient.invoke<ProviderModelsResponse>("list_provider_models", {
		provider: providerId,
	})
	return payload.models ?? []
}
