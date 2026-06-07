import { createOpenAI } from "@ai-sdk/openai";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { resolveApiKey } from "../http";
import type { ProviderFactoryResult } from "./types";

function readOptions(
	config: GatewayResolvedProviderConfig,
): Record<string, unknown> {
	return (config.options as Record<string, unknown> | undefined) ?? {};
}

function readStringOption(
	options: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = options[key];
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
	const normalized = name.toLowerCase();
	return Object.keys(headers).some((key) => key.toLowerCase() === normalized);
}

function withCodexClientVersion(url: URL, clientVersion: string): URL {
	const nextUrl = new URL(url.toString());
	const path = nextUrl.pathname.replace(/\/+$/, "");
	if (path.endsWith("/backend-api/codex/responses")) {
		nextUrl.searchParams.set("client_version", clientVersion);
	}
	return nextUrl;
}

function tryParseUrl(input: string): URL | undefined {
	try {
		return new URL(input);
	} catch {
		return undefined;
	}
}

function wrapCodexFetch(
	fetchFn: typeof fetch | undefined,
	clientVersion: string | undefined,
): typeof fetch | undefined {
	if (!clientVersion) {
		return fetchFn;
	}
	const innerFetch = fetchFn ?? globalThis.fetch?.bind(globalThis);
	if (!innerFetch) {
		return fetchFn;
	}
	return ((
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	) => {
		if (typeof input === "string") {
			const url = tryParseUrl(input);
			return innerFetch(
				url ? withCodexClientVersion(url, clientVersion).toString() : input,
				init,
			);
		}
		if (input instanceof URL) {
			return innerFetch(withCodexClientVersion(input, clientVersion), init);
		}
		if (typeof Request !== "undefined" && input instanceof Request) {
			const url = tryParseUrl(input.url);
			return innerFetch(
				url
					? new Request(withCodexClientVersion(url, clientVersion), input)
					: input,
				init,
			);
		}
		return innerFetch(input, init);
	}) as typeof fetch;
}

function buildOpenAIHeaders(
	config: GatewayResolvedProviderConfig,
): Record<string, string> | undefined {
	const headers = { ...(config.headers ?? {}) };
	if (config.providerId !== "openai-codex") {
		return Object.keys(headers).length > 0 ? headers : undefined;
	}

	const options = readOptions(config);
	const accountId = readStringOption(options, "accountId");
	const installationId = readStringOption(options, "installationId");
	if (accountId && !hasHeader(headers, "ChatGPT-Account-Id")) {
		headers["ChatGPT-Account-Id"] = accountId;
	}
	if (installationId && !hasHeader(headers, "x-codex-installation-id")) {
		headers["x-codex-installation-id"] = installationId;
	}
	return Object.keys(headers).length > 0 ? headers : undefined;
}

function buildOpenAIFetch(
	config: GatewayResolvedProviderConfig,
): typeof fetch | undefined {
	if (config.providerId !== "openai-codex") {
		return config.fetch;
	}
	const clientVersion = readStringOption(readOptions(config), "clientVersion");
	return wrapCodexFetch(config.fetch, clientVersion);
}

export async function createOpenAIProviderModule(
	config: GatewayResolvedProviderConfig,
	context: GatewayProviderContext,
): Promise<ProviderFactoryResult> {
	const apiKey = await resolveApiKey(config);
	const provider = createOpenAI({
		apiKey,
		baseURL: config.baseUrl,
		headers: buildOpenAIHeaders(config),
		fetch: buildOpenAIFetch(config),
		name: context.provider.id,
	});
	return {
		model: (modelId) => provider.responses(modelId),
	};
}
