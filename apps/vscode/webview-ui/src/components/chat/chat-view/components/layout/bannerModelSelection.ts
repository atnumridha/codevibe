import { type OpenAiCodexModelId, openAiCodexDefaultModelId, openAiCodexModels } from "@shared/api"

export function getCodeVibeBannerModelSelection(requestedModelId?: string) {
	const modelId: OpenAiCodexModelId =
		requestedModelId && requestedModelId in openAiCodexModels
			? (requestedModelId as OpenAiCodexModelId)
			: openAiCodexDefaultModelId

	return {
		planModeApiModelId: modelId,
		actModeApiModelId: modelId,
		planModeApiModelInfo: openAiCodexModels[modelId],
		actModeApiModelInfo: openAiCodexModels[modelId],
		planModeApiProvider: "openai-codex" as const,
		actModeApiProvider: "openai-codex" as const,
	}
}
