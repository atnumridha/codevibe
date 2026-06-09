import type { ApiConfiguration } from "@shared/api"
import { describe, expect, it } from "vitest"
import { getConfiguredProviders, getProviderLabel } from "../getConfiguredProviders"

describe("getConfiguredProviders", () => {
	it("defaults to OpenAI Codex before CodeVibe Cloud without configuration", () => {
		expect(getConfiguredProviders(undefined, undefined)).toEqual(["openai-codex", "cline"])
	})

	it("keeps OpenAI Codex first while preserving CodeVibe Cloud fallback", () => {
		const providers = getConfiguredProviders(undefined, {
			apiKey: "anthropic-key",
			openRouterApiKey: "openrouter-key",
		} as ApiConfiguration)

		expect(providers.slice(0, 2)).toEqual(["openai-codex", "cline"])
		expect(providers).toContain("anthropic")
		expect(providers).toContain("openrouter")
	})

	it("uses CodeVibe labels for Codex and legacy cloud providers", () => {
		expect(getProviderLabel("openai-codex")).toBe("CodeVibe Agent")
		expect(getProviderLabel("cline")).toBe("CodeVibe Cloud")
	})
})
