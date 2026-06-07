import {
	DEFAULT_API_PROVIDER,
	openAiCodexDefaultModelId,
	type ApiConfiguration,
	type ModelInfo,
} from "@shared/api"
import { describe, expect, it } from "vitest"
import {
	getModelsForProvider,
	getOpenAiCodexModelOptions,
	normalizeApiConfiguration,
} from "../providerUtils"

function model(name: string): ModelInfo {
	return {
		name,
		supportsPromptCache: true,
		supportsReasoning: true,
	}
}

describe("providerUtils OpenAI Codex models", () => {
	it("merges authenticated backend Codex models with bundled models", () => {
		const models = getOpenAiCodexModelOptions({
			"gpt-6-codex-preview": model("GPT-6 Codex Preview"),
		})

		expect(models["gpt-6-codex-preview"]?.name).toBe("GPT-6 Codex Preview")
		expect(models["gpt-5.5"]).toBeDefined()
	})

	it("prefers authenticated backend Codex model metadata over bundled metadata", () => {
		const models = getOpenAiCodexModelOptions({
			"gpt-5.5": {
				...model("GPT-5.5 Backend"),
				contextWindow: 1_000_000,
				supportsImages: false,
			},
		})

		expect(models["gpt-5.5"]?.name).toBe("GPT-5.5 Backend")
		expect(models["gpt-5.5"]?.contextWindow).toBe(1_000_000)
		expect(models["gpt-5.5"]?.supportsImages).toBe(false)
	})

	it("returns backend Codex models from provider model lookup", () => {
		const models = getModelsForProvider("openai-codex", undefined, {
			openAiCodexModels: {
				"gpt-6-codex-preview": model("GPT-6 Codex Preview"),
			},
		})

		expect(models?.["gpt-6-codex-preview"]?.name).toBe("GPT-6 Codex Preview")
	})

	it("normalizes a selected backend-only Codex model", () => {
		const normalized = normalizeApiConfiguration(
			{
				planModeApiProvider: "openai-codex",
				planModeApiModelId: "gpt-6-codex-preview",
			} as ApiConfiguration,
			"plan",
			{
				openAiCodexModels: {
					"gpt-6-codex-preview": model("GPT-6 Codex Preview"),
				},
			},
		)

		expect(normalized.selectedProvider).toBe("openai-codex")
		expect(normalized.selectedModelId).toBe("gpt-6-codex-preview")
		expect(normalized.selectedModelInfo.name).toBe("GPT-6 Codex Preview")
	})

	it.each(["plan", "act"] as const)(
		"defaults missing %s configuration to OpenAI Codex",
		(mode) => {
			const normalized = normalizeApiConfiguration(undefined, mode)

			expect(normalized.selectedProvider).toBe(DEFAULT_API_PROVIDER)
			expect(normalized.selectedModelId).toBe(openAiCodexDefaultModelId)
		},
	)
})
