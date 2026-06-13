import type { ApiConfiguration } from "@shared/api"
import { describe, expect, it } from "vitest"
import { getConfiguredProviders, getProviderLabel } from "../getConfiguredProviders"

describe("getConfiguredProviders", () => {
	it("defaults to ChatGPT for Codie before Codie Cloud without configuration", () => {
		expect(getConfiguredProviders(undefined, undefined)).toEqual(["openai-codex", "cline"])
	})

	it("keeps ChatGPT for Codie first while preserving Codie Cloud fallback", () => {
		const providers = getConfiguredProviders(undefined, {
			apiKey: "anthropic-key",
			openRouterApiKey: "openrouter-key",
		} as ApiConfiguration)

		expect(providers.slice(0, 2)).toEqual(["openai-codex", "cline"])
		expect(providers).toContain("anthropic")
		expect(providers).toContain("openrouter")
	})

	it("uses Codie labels for Codex and legacy cloud providers", () => {
		expect(getProviderLabel("openai-codex")).toBe("Codie Agent")
		expect(getProviderLabel("cline")).toBe("Codie Cloud")
	})
})
