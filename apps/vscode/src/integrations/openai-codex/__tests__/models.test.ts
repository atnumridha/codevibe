import { expect } from "chai"
import { openAiCodexModels } from "@shared/api"
import { ApiFormat } from "@/shared/proto/cline/models"
import {
	mergeOpenAiCodexBackendModels,
	toOpenAiCodexApiFormat,
	toOpenAiCodexBackendModelInfo,
} from "../models"

describe("OpenAI Codex backend model merge", () => {
	it("preserves bundled fallback models while adding authenticated backend models", () => {
		const merged = mergeOpenAiCodexBackendModels([
			{
				id: "gpt-6-codex-preview",
				name: "GPT-6 Codex Preview",
				contextWindow: 512_000,
				maxTokens: 64_000,
				supportsImages: false,
				supportsPromptCache: false,
				supportsReasoning: true,
				apiFormat: "openai_responses_websocket",
			},
		])

		expect(merged["gpt-5.5-pro"]).to.deep.equal(openAiCodexModels["gpt-5.5-pro"])
		expect(merged["gpt-6-codex-preview"]).to.deep.include({
			name: "GPT-6 Codex Preview",
			contextWindow: 512_000,
			maxTokens: 64_000,
			supportsImages: false,
			supportsPromptCache: false,
			supportsReasoning: true,
			apiFormat: ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE,
			inputPrice: 0,
			outputPrice: 0,
		})
	})

	it("lets authenticated backend metadata override bundled model metadata without introducing token pricing", () => {
		const merged = mergeOpenAiCodexBackendModels([
			{
				id: "gpt-5.5",
				name: "GPT-5.5 Backend",
				contextWindow: 456_000,
				maxTokens: 96_000,
				supportsPromptCache: false,
			},
		])

		expect(merged["gpt-5.5"]).to.deep.include({
			name: "GPT-5.5 Backend",
			contextWindow: 456_000,
			maxTokens: 96_000,
			supportsPromptCache: false,
			inputPrice: 0,
			outputPrice: 0,
		})
	})

	it("normalizes Codex backend API format aliases", () => {
		expect(toOpenAiCodexApiFormat("responses")).to.equal(ApiFormat.OPENAI_RESPONSES)
		expect(toOpenAiCodexApiFormat("openai-responses-websocket")).to.equal(
			ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE,
		)
		expect(toOpenAiCodexApiFormat("unknown")).to.equal(undefined)

		expect(
			toOpenAiCodexBackendModelInfo({
				id: "codex-auto-review",
				apiFormat: "unknown",
			}).apiFormat,
		).to.equal(openAiCodexModels["gpt-5.5"].apiFormat)
	})
})
