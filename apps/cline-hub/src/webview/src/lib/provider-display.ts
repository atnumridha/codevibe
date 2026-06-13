"use client";

import { normalizeProviderId } from "@/lib/provider-id";

export const CODIE_AGENT_PROVIDER_ID = "openai-codex";

const CODIE_PROVIDER_LABELS: Record<string, string> = {
	[CODIE_AGENT_PROVIDER_ID]: "Codie Agent",
	anthropic: "Anthropic",
	bedrock: "Amazon Bedrock",
	"openai-codex-cli": "Codie Local CLI",
	cline: "Codie Cloud",
	deepseek: "DeepSeek",
	gemini: "Google Gemini",
	lmstudio: "LM Studio",
	ollama: "Ollama",
	oca: "Codie OCA",
	openai: "OpenAI",
	"openai-compatible": "OpenAI Compatible",
	openrouter: "OpenRouter",
	qwen: "Qwen",
	vertex: "Google Vertex AI",
	xai: "xAI",
	zai: "Z.ai",
};

function titleCaseProviderId(providerId: string): string {
	return providerId
		.split(/[-_.\s/]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

export function isCopilotProviderId(providerId: string): boolean {
	const normalizedProvider = normalizeProviderId(providerId).toLowerCase();
	return (
		normalizedProvider === "copilot" ||
		normalizedProvider === "copilot-cli" ||
		normalizedProvider === "github-copilot" ||
		normalizedProvider === "github-copilot-cli" ||
		normalizedProvider.includes("copilot")
	);
}

export function getProviderDisplayLabel(providerId: string): string {
	const normalizedProvider = normalizeProviderId(providerId);
	if (!normalizedProvider) {
		return "Codie Agent";
	}
	return (
		CODIE_PROVIDER_LABELS[normalizedProvider] ??
		titleCaseProviderId(normalizedProvider)
	);
}

export function getProviderDisplayName(provider: {
	id: string;
	name?: string;
}): string {
	const normalizedProvider = normalizeProviderId(provider.id);
	if (normalizedProvider in CODIE_PROVIDER_LABELS) {
		return getProviderDisplayLabel(normalizedProvider);
	}
	return provider.name?.trim() || getProviderDisplayLabel(normalizedProvider);
}

export function getPersistableDefaultProviderId(providerId: string): string {
	const normalizedProvider = normalizeProviderId(providerId);
	if (!normalizedProvider || isCopilotProviderId(normalizedProvider)) {
		return CODIE_AGENT_PROVIDER_ID;
	}
	return normalizedProvider;
}

export function prioritizeCodieProviderIds(providerIds: string[]): string[] {
	const seen = new Set<string>();
	const normalized = providerIds
		.map((providerId) => normalizeProviderId(providerId))
		.filter((providerId) => {
			if (!providerId || seen.has(providerId)) {
				return false;
			}
			seen.add(providerId);
			return true;
		});

	return normalized.sort((a, b) => {
		if (a === CODIE_AGENT_PROVIDER_ID) return -1;
		if (b === CODIE_AGENT_PROVIDER_ID) return 1;
		if (a === "openai-codex-cli") return -1;
		if (b === "openai-codex-cli") return 1;
		const aCopilot = isCopilotProviderId(a);
		const bCopilot = isCopilotProviderId(b);
		if (aCopilot !== bCopilot) {
			return aCopilot ? 1 : -1;
		}
		return (
			getProviderDisplayLabel(a).localeCompare(getProviderDisplayLabel(b)) ||
			a.localeCompare(b)
		);
	});
}

export function prioritizeCodieProviders<T extends { id: string }>(
	providers: T[],
): T[] {
	const orderedIds = prioritizeCodieProviderIds(
		providers.map((provider) => provider.id),
	);
	const orderById = new Map(
		orderedIds.map((providerId, index) => [providerId, index]),
	);

	return [...providers].sort((a, b) => {
		const aId = normalizeProviderId(a.id);
		const bId = normalizeProviderId(b.id);
		const aOrder = orderById.get(aId) ?? Number.MAX_SAFE_INTEGER;
		const bOrder = orderById.get(bId) ?? Number.MAX_SAFE_INTEGER;
		if (aOrder !== bOrder) {
			return aOrder - bOrder;
		}
		return (
			getProviderDisplayLabel(aId).localeCompare(
				getProviderDisplayLabel(bId),
			) || aId.localeCompare(bId)
		);
	});
}
