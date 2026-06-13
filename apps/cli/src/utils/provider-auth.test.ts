import type { ProviderSettings } from "@cline/core";
import { describe, expect, it } from "vitest";
import {
	getAuthProviderDisplayName,
	isProviderConfigured,
	normalizeAuthProviderId,
	toProviderApiKey,
} from "./provider-auth";

describe("provider auth aliases and display names", () => {
	it("normalizes Codie auth aliases onto stable provider IDs", () => {
		expect(normalizeAuthProviderId("codie")).toBe("openai-codex");
		expect(normalizeAuthProviderId("codex")).toBe("openai-codex");
		expect(normalizeAuthProviderId("codie-cloud")).toBe("cline");
		expect(normalizeAuthProviderId("codevibe-cloud")).toBe("cline");
	});

	it("keeps stable IDs behind Codie display names", () => {
		expect(getAuthProviderDisplayName("openai-codex", "ChatGPT")).toBe("Codie");
		expect(getAuthProviderDisplayName("cline", "Cline")).toBe("Codie Cloud");
		expect(getAuthProviderDisplayName("oca")).toBe("OCA");
		expect(getAuthProviderDisplayName("anthropic", "Anthropic")).toBe(
			"Anthropic",
		);
	});

	it("treats Codie Cloud aliases as the legacy OAuth token format", () => {
		expect(toProviderApiKey("codie-cloud", { access: "oauth-access" })).toBe(
			"workos:oauth-access",
		);
	});
});

describe("isProviderConfigured", () => {
	it("returns false when settings is undefined", () => {
		expect(isProviderConfigured("anthropic", undefined)).toBe(false);
	});

	it("returns false when api-key settings have no useful fields", () => {
		expect(
			isProviderConfigured("anthropic", {
				provider: "anthropic",
			} satisfies ProviderSettings),
		).toBe(false);
	});

	it("treats any persisted api key as configured", () => {
		expect(
			isProviderConfigured("anthropic", {
				provider: "anthropic",
				apiKey: "sk-test",
			} satisfies ProviderSettings),
		).toBe(true);
	});

	it("treats a persisted base URL as configured", () => {
		expect(
			isProviderConfigured("ollama", {
				provider: "ollama",
				baseUrl: "http://localhost:11434/v1",
			} satisfies ProviderSettings),
		).toBe(true);
	});

	it("treats a persisted model id as configured", () => {
		expect(
			isProviderConfigured("ollama", {
				provider: "ollama",
				model: "llama3.1",
			} satisfies ProviderSettings),
		).toBe(true);
	});

	it("treats lmstudio with model + base url as configured", () => {
		expect(
			isProviderConfigured("lmstudio", {
				provider: "lmstudio",
				model: "qwen2",
				baseUrl: "http://localhost:1234/v1",
			} satisfies ProviderSettings),
		).toBe(true);
	});

	it("requires an OAuth access token for cline", () => {
		expect(
			isProviderConfigured("cline", {
				provider: "cline",
			} satisfies ProviderSettings),
		).toBe(false);

		expect(
			isProviderConfigured("cline", {
				provider: "cline",
				auth: { accessToken: "workos:abc" },
			} satisfies ProviderSettings),
		).toBe(true);
	});
});
