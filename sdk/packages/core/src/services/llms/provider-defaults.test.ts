import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearLiveModelsCatalogCache,
	clearPrivateModelsCatalogCache,
	resolveProviderConfig,
} from "./provider-defaults";

const ORIGINAL_CODEX_HOME = process.env.CODEX_HOME;

function toBase64Url(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}

function createJwt(payload: Record<string, unknown>): string {
	return `${toBase64Url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${toBase64Url(
		JSON.stringify(payload),
	)}.sig`;
}

afterEach(() => {
	clearLiveModelsCatalogCache();
	clearPrivateModelsCatalogCache();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	if (ORIGINAL_CODEX_HOME === undefined) {
		delete process.env.CODEX_HOME;
	} else {
		process.env.CODEX_HOME = ORIGINAL_CODEX_HOME;
	}
});

describe("resolveProviderConfig", () => {
	it("returns bundled models for built-in providers without a base URL", async () => {
		const resolved = await resolveProviderConfig("bedrock");

		expect(resolved?.baseUrl).toBeUndefined();
		expect(resolved?.modelId).toBe("minimax.minimax-m2.5");
		expect(resolved?.knownModels?.["amazon.nova-2-lite-v1:0"]?.name).toBe(
			"Nova 2 Lite",
		);
		expect(Object.keys(resolved?.knownModels ?? {}).length).toBeGreaterThan(0);
	});

	it("uses catalog aliases when loading live models", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				return new Response(
					JSON.stringify({
						openrouter: {
							models: {
								"vendor/live-only-model": {
									name: "Live Only Model",
									tool_call: true,
								},
							},
						},
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			}),
		);

		const resolved = await resolveProviderConfig("cline", {
			loadLatestOnInit: true,
			failOnError: false,
			cacheTtlMs: 0,
		});

		expect(resolved?.knownModels?.["vendor/live-only-model"]?.name).toBe(
			"Live Only Model",
		);
	});

	it("uses the live OpenAI catalog for ChatGPT subscription models", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				return new Response(
					JSON.stringify({
						openai: {
							models: {
								"gpt-5.6-live": {
									name: "GPT-5.6 Live",
									tool_call: true,
									reasoning: true,
									family: "gpt",
									release_date: "2027-01-01",
								},
								"gpt-5.4-live": {
									name: "GPT-5.4 Live",
									tool_call: true,
									reasoning: true,
									family: "gpt",
									release_date: "2027-01-02",
								},
								"gpt-5.4-nano": {
									name: "GPT-5.4 nano",
									tool_call: true,
									reasoning: true,
									family: "gpt-nano",
									release_date: "2027-01-03",
								},
								"o-live": {
									name: "o live",
									tool_call: true,
									reasoning: true,
									family: "o",
									release_date: "2027-01-04",
								},
							},
						},
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			}),
		);

		const resolved = await resolveProviderConfig("openai-codex", {
			loadLatestOnInit: true,
			failOnError: false,
			cacheTtlMs: 0,
			url: "https://models.test/api.json",
		});

		expect(resolved?.knownModels?.["gpt-5.6-live"]?.name).toBe("GPT-5.6 Live");
		expect(resolved?.knownModels?.["gpt-5.4-live"]).toBeUndefined();
		expect(resolved?.knownModels?.["gpt-5.4-nano"]).toBeUndefined();
		expect(resolved?.knownModels?.["o-live"]).toBeUndefined();
	});

	it("uses built-in modelsSourceUrl for keyless local provider models", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({ models: [{ name: "local-llama" }] }),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const resolved = await resolveProviderConfig(
			"ollama",
			{ failOnError: false, cacheTtlMs: 0 },
			{
				providerId: "ollama",
				modelId: "",
				baseUrl: "http://tailscale-host:11434/v1",
			},
		);

		expect(fetchMock).toHaveBeenCalledWith(
			"http://tailscale-host:11434/api/tags",
			{ method: "GET" },
		);
		expect(Object.keys(resolved?.knownModels ?? {})).toEqual(["local-llama"]);
	});

	it("loads Poolside models from the authenticated models endpoint", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					data: [
						{
							id: "poolside/laguna-xs.2",
							name: "Poolside: Laguna XS.2",
							description: "Poolside coding model",
							context_length: 131_072,
							max_completion_tokens: 8192,
							supported_features: ["tools", "reasoning"],
							supported_sampling_parameters: ["temperature"],
							input_modalities: ["text"],
							pricing: { prompt: "0", completion: "0" },
						},
					],
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const resolved = await resolveProviderConfig(
			"poolside",
			{ failOnError: true, cacheTtlMs: 0 },
			{
				providerId: "poolside",
				modelId: "poolside/laguna-m.1",
				apiKey: "poolside-key",
				baseUrl: "https://inference.poolside.ai/v1",
			},
		);

		expect(fetchMock).toHaveBeenCalledWith(
			"https://inference.poolside.ai/v1/models",
			expect.objectContaining({
				method: "GET",
				headers: expect.objectContaining({
					Authorization: "Bearer poolside-key",
				}),
			}),
		);
		expect(resolved?.knownModels?.["poolside/laguna-xs.2"]).toEqual(
			expect.objectContaining({
				name: "Poolside: Laguna XS.2",
				contextWindow: 131_072,
				maxInputTokens: 131_072,
				maxTokens: 8192,
				capabilities: expect.arrayContaining([
					"streaming",
					"tools",
					"reasoning",
					"temperature",
				]),
				pricing: { input: 0, output: 0 },
				status: "active",
			}),
		);
	});

	it("derives ChatGPT subscription models from the generated OpenAI catalog", async () => {
		const resolved = await resolveProviderConfig("openai-codex");
		const openAiResolved = await resolveProviderConfig("openai-native");
		const modelIds = Object.keys(resolved?.knownModels ?? {});

		expect(modelIds).toEqual(
			expect.arrayContaining([
				"gpt-5.5",
				"gpt-5.5-pro",
				"gpt-5.2",
				"gpt-5.3-codex",
				"gpt-5.3-codex-spark",
				"gpt-5.4",
				"gpt-5.4-mini",
			]),
		);
		expect(modelIds).not.toContain("gpt-5.1-codex-max");
		expect(modelIds).not.toContain("gpt-5.2-codex");
		expect(modelIds).not.toContain("gpt-5.4-nano");
		expect(modelIds).not.toContain("o3");
		expect(resolved?.knownModels?.["gpt-5.4"]).toBeDefined();
		expect(resolved?.knownModels?.["gpt-5.5"]).toEqual(
			expect.objectContaining({
				...openAiResolved?.knownModels?.["gpt-5.5"],
				maxInputTokens: 272_000,
				contextWindow: 400_000,
			}),
		);
	});

	it("resolves ChatGPT OAuth models from the filtered catalog", async () => {
		const resolved = await resolveProviderConfig(
			"openai-codex",
			{ cacheTtlMs: 1, loadPrivateOnAuth: false },
			{
				providerId: "openai-codex",
				modelId: "gpt-5.4",
				apiKey: "oauth-token",
				accountId: "acct_123",
			},
		);

		expect(Object.keys(resolved?.knownModels ?? {})).toEqual(
			expect.arrayContaining([
				"gpt-5.2",
				"gpt-5.3-codex",
				"gpt-5.3-codex-spark",
				"gpt-5.4",
				"gpt-5.4-mini",
				"gpt-5.5",
			]),
		);
		expect(resolved?.knownModels?.["gpt-5.4-mini"]).toEqual(
			expect.objectContaining({
				name: "GPT-5.4 mini",
				maxInputTokens: 272_000,
				contextWindow: 400_000,
			}),
		);
		expect(resolved?.knownModels?.["gpt-5.4-nano"]).toBeUndefined();
	});

	it("loads OpenAI Codex models from the authenticated backend endpoint", async () => {
		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					models: [
						{
							display_name: "GPT-6 Codex",
							slug: "gpt-6-codex",
							supported_in_api: true,
						},
						{
							display_name: "Hidden Codex",
							slug: "hidden-codex",
							supported_in_api: false,
						},
						{
							display_name: "Backend GPT-5.5",
							slug: "gpt-5.5",
							supported_in_api: true,
						},
					],
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const resolved = await resolveProviderConfig(
			"openai-codex",
			{ cacheTtlMs: 0, failOnError: true },
			{
				providerId: "openai-codex",
				modelId: "gpt-5.5",
				apiKey: "oauth-token",
				accountId: "acct_123",
				codex: {
					clientVersion: "0.136.0-test",
					installationId: "install_123",
				},
			},
		);

		expect(fetchMock).toHaveBeenCalledWith(
			"https://chatgpt.com/backend-api/codex/models?client_version=0.136.0-test",
			expect.objectContaining({
				method: "GET",
				headers: expect.objectContaining({
					Authorization: "Bearer oauth-token",
					"ChatGPT-Account-Id": "acct_123",
					"x-codex-installation-id": "install_123",
					originator: "cline",
					session_id: expect.any(String),
					"User-Agent": expect.stringMatching(/^CodeVibe\//),
				}),
			}),
		);
		expect(resolved?.knownModels?.["gpt-6-codex"]).toEqual(
			expect.objectContaining({
				name: "GPT-6 Codex",
				capabilities: expect.arrayContaining([
					"streaming",
					"tools",
					"reasoning",
					"prompt-cache",
				]),
				status: "active",
			}),
		);
		expect(resolved?.knownModels?.["hidden-codex"]).toBeUndefined();
		expect(resolved?.knownModels?.["gpt-5.5"]?.maxInputTokens).toBe(272_000);
	});

	it("refreshes OpenAI Codex credentials and retries authenticated model discovery once", async () => {
		const refreshedToken = createJwt({
			exp: Math.floor(Date.now() / 1000) + 3600,
			"https://api.openai.com/auth": {
				chatgpt_account_id: "acct_refreshed",
			},
		});
		const fetchMock = vi.fn(
			async (url: string | URL | Request, _init?: RequestInit) => {
				const href = String(url);
				if (href.includes("/oauth/token")) {
					return new Response(
						JSON.stringify({
							access_token: refreshedToken,
							refresh_token: "refresh-new",
							expires_in: 3600,
						}),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					);
				}
				const modelCallCount = fetchMock.mock.calls.filter(([callUrl]) =>
					String(callUrl).includes("/models"),
				).length;
				if (modelCallCount === 1) {
					return new Response("expired", { status: 401 });
				}
				return new Response(
					JSON.stringify({
						models: [
							{
								display_name: "Refreshed Codex",
								slug: "gpt-refreshed-codex",
								supported_in_api: true,
							},
						],
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			},
		);
		vi.stubGlobal("fetch", fetchMock);

		const resolved = await resolveProviderConfig(
			"openai-codex",
			{ cacheTtlMs: 0, failOnError: true },
			{
				providerId: "openai-codex",
				modelId: "gpt-5.5",
				apiKey: "expired-token",
				refreshToken: "refresh-old",
				accountId: "acct_old",
				codex: {
					clientVersion: "0.136.0-test",
					installationId: "install_123",
				},
			},
		);

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"https://chatgpt.com/backend-api/codex/models?client_version=0.136.0-test",
			expect.objectContaining({
				method: "GET",
				headers: expect.objectContaining({
					Authorization: "Bearer expired-token",
					"ChatGPT-Account-Id": "acct_old",
					"x-codex-installation-id": "install_123",
					session_id: expect.any(String),
					"User-Agent": expect.stringMatching(/^CodeVibe\//),
				}),
			}),
		);
		expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/oauth/token");
		const firstModelsHeaders = fetchMock.mock.calls[0]?.[1]?.headers as
			| Record<string, string>
			| undefined;

		expect(fetchMock).toHaveBeenNthCalledWith(
			3,
			"https://chatgpt.com/backend-api/codex/models?client_version=0.136.0-test",
			expect.objectContaining({
				method: "GET",
				headers: expect.objectContaining({
					Authorization: `Bearer ${refreshedToken}`,
					"ChatGPT-Account-Id": "acct_refreshed",
					"x-codex-installation-id": "install_123",
					session_id: firstModelsHeaders?.session_id,
					"User-Agent": expect.stringMatching(/^CodeVibe\//),
				}),
			}),
		);
		expect(resolved?.knownModels?.["gpt-refreshed-codex"]).toEqual(
			expect.objectContaining({
				name: "Refreshed Codex",
				status: "active",
			}),
		);
	});

	it("uses Codex home credentials for first-run authenticated model discovery", async () => {
		const codexHome = mkdtempSync(
			join(tmpdir(), "provider-defaults-codex-home-"),
		);
		process.env.CODEX_HOME = codexHome;
		writeFileSync(
			join(codexHome, "auth.json"),
			JSON.stringify({
				auth_mode: "chatgpt",
				tokens: {
					access_token: createJwt({
						exp: Math.floor(Date.now() / 1000) + 3600,
						"https://api.openai.com/auth": {
							chatgpt_account_id: "acct_home",
						},
					}),
					refresh_token: "refresh-home",
				},
			}),
			"utf8",
		);
		writeFileSync(join(codexHome, "installation_id"), "install_home\n", "utf8");
		writeFileSync(
			join(codexHome, "models_cache.json"),
			JSON.stringify({ client_version: "0.136.0-home" }),
			"utf8",
		);

		const fetchMock = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					models: [
						{
							display_name: "GPT Home Codex",
							slug: "gpt-home-codex",
							supported_in_api: true,
						},
					],
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		try {
			const resolved = await resolveProviderConfig(
				"openai-codex",
				{
					loadPrivateOnAuth: true,
					cacheTtlMs: 0,
					failOnError: true,
				},
				undefined,
			);

			expect(fetchMock).toHaveBeenCalledWith(
				"https://chatgpt.com/backend-api/codex/models?client_version=0.136.0-home",
				expect.objectContaining({
					method: "GET",
					headers: expect.objectContaining({
						Authorization: expect.stringMatching(/^Bearer /),
						"ChatGPT-Account-Id": "acct_home",
						"x-codex-installation-id": "install_home",
						originator: "cline",
						session_id: expect.any(String),
						"User-Agent": expect.stringMatching(/^CodeVibe\//),
					}),
				}),
			);
			expect(resolved?.knownModels?.["gpt-home-codex"]).toEqual(
				expect.objectContaining({
					name: "GPT Home Codex",
					status: "active",
				}),
			);
		} finally {
			rmSync(codexHome, { recursive: true, force: true });
		}
	});
});
