import { describe, expect, it } from "vitest"
import {
	getCodieHostedModelDisplayName,
	getCodieHostedProviderLabel,
	sanitizeCodieHostedErrorText,
	sanitizeCodieHostedModelDescription,
} from "../codieBranding"

describe("codieBranding", () => {
	it("maps hosted provider IDs to Codie without changing other providers", () => {
		expect(getCodieHostedProviderLabel("openai-codex")).toBe("Codie")
		expect(getCodieHostedProviderLabel("cline")).toBe("Codie")
		expect(getCodieHostedProviderLabel("openrouter")).toBe("openrouter")
	})

	it("returns neutral hosted model display names for raw vendor models", () => {
		expect(
			getCodieHostedModelDisplayName(
				{
					id: "anthropic/claude-opus-4.6",
					name: "Anthropic Claude Opus 4.6",
					description: "Most intelligent model for agents and coding",
				},
				"RECOMMENDED",
			),
		).toBe("Advanced coding model")

		expect(
			getCodieHostedModelDisplayName(
				{
					id: "openai/gpt-5.3-codex",
					name: "OpenAI GPT-5.3 Codex",
					description: "OpenAI's latest with strong coding abilities",
				},
				"RECOMMENDED",
			),
		).toBe("Recommended model")
	})

	it("sanitizes hosted model descriptions", () => {
		expect(sanitizeCodieHostedModelDescription("OpenAI's latest Codex model with Pro access")).toBe(
			"This model's latest Codie model with advanced access",
		)
	})

	it("sanitizes hosted error text", () => {
		expect(sanitizeCodieHostedErrorText("openai-codex ChatGPT Pro subscription billing credits API key")).toBe(
			"Codie Codie access access capacity sign-in",
		)
	})
})
