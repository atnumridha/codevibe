import process from "node:process";
import {
	ensureCustomProvidersLoaded,
	getLocalProviderModels,
	Llms,
	listLocalProviders,
	loginLocalProvider,
	normalizeOAuthProvider,
	saveLocalProviderOAuthCredentials,
	saveLocalProviderSettings,
} from "@cline/core";
import {
	DEFAULT_HUB_MODEL_ID,
	DEFAULT_HUB_PROVIDER_ID,
	type WebviewInboundMessage,
	type WebviewProviderModel,
} from "../webview-protocol";
import { providerSettingsManager, workspaceRoot } from "./deps";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";
import { openExternalUrl } from "./utils";

export function isCopilotProviderId(providerId: string | undefined): boolean {
	const normalizedProvider = providerId?.trim().toLowerCase() ?? "";
	return (
		normalizedProvider === "copilot" ||
		normalizedProvider === "copilot-cli" ||
		normalizedProvider === "github-copilot" ||
		normalizedProvider === "github-copilot-cli" ||
		normalizedProvider.includes("copilot")
	);
}

export function getDefaultableProviderId(
	providerId: string | undefined,
): string {
	const trimmed = providerId?.trim();
	if (!trimmed || isCopilotProviderId(trimmed)) {
		return DEFAULT_HUB_PROVIDER_ID;
	}
	return trimmed;
}

function providerSortKey(providerId: string): number {
	const normalizedProvider = providerId.trim();
	if (normalizedProvider === DEFAULT_HUB_PROVIDER_ID) return 0;
	if (normalizedProvider === "openai-codex-cli") return 1;
	if (isCopilotProviderId(normalizedProvider)) return 100;
	return 10;
}

function sortProviders<T extends { id: string }>(providers: T[]): T[] {
	return [...providers].sort((a, b) => {
		const aRank = providerSortKey(a.id);
		const bRank = providerSortKey(b.id);
		if (aRank !== bRank) return aRank - bRank;
		return a.id.localeCompare(b.id);
	});
}

function getConfiguredEnvProvider(): string | undefined {
	return process.env.CODEVIBE_PROVIDER?.trim() || process.env.CLINE_PROVIDER?.trim() || undefined;
}

function getConfiguredEnvModel(): string | undefined {
	return process.env.CODEVIBE_MODEL?.trim() || process.env.CLINE_MODEL?.trim() || undefined;
}

export function getMatchingLastUsedModel(providerId: string): string | undefined {
	const lastUsed = providerSettingsManager.getLastUsedProviderSettings();
	if (lastUsed?.provider?.trim() !== providerId) {
		return undefined;
	}
	return lastUsed.model?.trim() || undefined;
}

export function resolveBrowserDefaults(ctx: HubContext): {
	provider?: string;
	model?: string;
	workspaceRoot: string;
	cwd: string;
} {
	const envProvider = getConfiguredEnvProvider();
	const envModel = getConfiguredEnvModel();
	const inheritedProvider = ctx.lastSessionContext?.providerId ?? envProvider;
	const provider = getDefaultableProviderId(inheritedProvider);
	const providerWasDemoted =
		Boolean(inheritedProvider?.trim()) &&
		provider !== inheritedProvider?.trim();
	const lastSessionModel =
		ctx.lastSessionContext?.providerId === provider
			? ctx.lastSessionContext.modelId
			: undefined;
	const envModelForProvider =
		envProvider && getDefaultableProviderId(envProvider) === provider
			? envModel
			: undefined;
	return {
		provider,
		model: providerWasDemoted
			? DEFAULT_HUB_MODEL_ID
			: (lastSessionModel ??
				envModelForProvider ??
				getMatchingLastUsedModel(provider) ??
				DEFAULT_HUB_MODEL_ID),
		workspaceRoot: ctx.lastSessionContext?.workspaceRoot ?? workspaceRoot,
		cwd:
			ctx.lastSessionContext?.cwd ??
			ctx.lastSessionContext?.workspaceRoot ??
			workspaceRoot,
	};
}

export async function loadProviders(
	ctx: HubContext,
	peer: BrowserPeer,
): Promise<void> {
	await ensureCustomProvidersLoaded(providerSettingsManager);
	const state = providerSettingsManager.read();
	const defaults = resolveBrowserDefaults(ctx);
	const ids = sortProviders(Llms.getProviderIds().map((id) => ({ id }))).map(
		(provider) => provider.id,
	);
	const providers = (
		await Promise.all(
			ids.map(async (id) => {
				const info = await Llms.getProvider(id);
				const enabled =
					Boolean(state.providers[id]?.settings) || id === defaults.provider;
				return {
					id,
					name: info?.name ?? id,
					enabled,
					defaultModelId: info?.defaultModelId,
				};
			}),
		)
	).filter((provider) => provider.enabled);
	const orderedProviders = sortProviders(providers);
	ctx.send(peer, { type: "providers", providers: orderedProviders });
	const selected =
		(defaults.provider &&
			orderedProviders.find((provider) => provider.id === defaults.provider)) ||
		orderedProviders[0];
	if (selected) {
		await loadModels(ctx, peer, selected.id);
	}
}

export async function loadModels(
	ctx: HubContext,
	peer: BrowserPeer,
	providerId: string,
): Promise<void> {
	const provider = providerId.trim();
	if (!provider) return;
	const payload = await getLocalProviderModels(
		provider,
		providerSettingsManager.getProviderConfig(provider),
	);
	const models: WebviewProviderModel[] = payload.models.map((model) => ({
		id: model.id,
		name: model.name,
		supportsReasoning: model.supportsReasoning,
		supportsThinking: model.supportsReasoning,
	}));
	ctx.send(peer, { type: "models", providerId: provider, models });
}

export async function sendProviderCatalog(
	ctx: HubContext,
	peer: BrowserPeer,
): Promise<void> {
	await ensureCustomProvidersLoaded(providerSettingsManager);
	const payload = await listLocalProviders(providerSettingsManager);
	ctx.send(peer, {
		type: "provider_catalog",
		providers: payload.providers,
		settingsPath: payload.settingsPath,
	});
}

export async function saveProviderSettings(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: Extract<WebviewInboundMessage, { type: "saveProviderSettings" }>,
): Promise<void> {
	const result = saveLocalProviderSettings(providerSettingsManager, {
		providerId: frame.providerId,
		enabled: frame.enabled,
		apiKey: frame.apiKey,
		baseUrl: frame.baseUrl,
	});
	ctx.send(peer, {
		type: "provider_settings_saved",
		providerId: result.providerId,
		enabled: result.enabled,
	});
	await sendProviderCatalog(ctx, peer);
	await loadProviders(ctx, peer);
}

export async function runProviderOAuthLogin(
	ctx: HubContext,
	peer: BrowserPeer,
	providerId: string,
): Promise<void> {
	const normalized = normalizeOAuthProvider(providerId);
	const existing = providerSettingsManager.getProviderSettings(normalized);
	const credentials = await loginLocalProvider(
		normalized,
		existing,
		openExternalUrl,
	);
	const saved = saveLocalProviderOAuthCredentials(
		providerSettingsManager,
		normalized,
		existing,
		credentials,
	);
	ctx.send(peer, {
		type: "provider_oauth_login_done",
		providerId: normalized,
		accessTokenPresent:
			(saved.auth?.accessToken?.trim() ?? saved.apiKey?.trim() ?? "").length >
			0,
	});
	await sendProviderCatalog(ctx, peer);
	await loadProviders(ctx, peer);
}
