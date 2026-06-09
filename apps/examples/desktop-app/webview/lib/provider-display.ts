"use client";

import { normalizeProviderId } from "@/lib/provider-id";

export const CODEVIBE_AGENT_PROVIDER_ID = "openai-codex";

const CODEVIBE_PROVIDER_LABELS: Record<string, string> = {
	[CODEVIBE_AGENT_PROVIDER_ID]: "CodeVibe Agent",
	"openai-codex-cli": "CodeVibe Agent (Codex CLI)",
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
		return "CodeVibe Agent";
	}
	return (
		CODEVIBE_PROVIDER_LABELS[normalizedProvider] ??
		titleCaseProviderId(normalizedProvider)
	);
}

export function prioritizeCodeVibeProviderIds(providerIds: string[]): string[] {
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
		if (a === CODEVIBE_AGENT_PROVIDER_ID) return -1;
		if (b === CODEVIBE_AGENT_PROVIDER_ID) return 1;
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
