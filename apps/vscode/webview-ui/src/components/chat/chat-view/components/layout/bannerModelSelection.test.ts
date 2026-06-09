import { openAiCodexDefaultModelId, openAiCodexModels } from "@shared/api"
import { describe, expect, it } from "vitest"
import { getCodeVibeBannerModelSelection } from "./bannerModelSelection"

describe("getCodeVibeBannerModelSelection", () => {
	it("keeps welcome banner model actions on OpenAI Codex", () => {
		const selection = getCodeVibeBannerModelSelection("gpt-5.5-pro")

		expect(selection.planModeApiProvider).toBe("openai-codex")
		expect(selection.actModeApiProvider).toBe("openai-codex")
		expect(selection.planModeApiModelId).toBe("gpt-5.5-pro")
		expect(selection.actModeApiModelId).toBe("gpt-5.5-pro")
		expect(selection.planModeApiModelInfo).toBe(openAiCodexModels["gpt-5.5-pro"])
	})

	it("falls back to the bundled Codex default for legacy banner model ids", () => {
		const selection = getCodeVibeBannerModelSelection("anthropic/claude-sonnet-4.5")

		expect(selection.planModeApiProvider).toBe("openai-codex")
		expect(selection.actModeApiProvider).toBe("openai-codex")
		expect(selection.planModeApiModelId).toBe(openAiCodexDefaultModelId)
		expect(selection.actModeApiModelId).toBe(openAiCodexDefaultModelId)
		expect(selection.planModeApiModelInfo).toBe(openAiCodexModels[openAiCodexDefaultModelId])
	})
})
