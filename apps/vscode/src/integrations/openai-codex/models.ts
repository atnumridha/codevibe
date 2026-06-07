import { ModelInfo, openAiCodexDefaultModelId, openAiCodexModels } from "@shared/api"
import { ApiFormat } from "@/shared/proto/cline/models"
import type { OpenAiCodexBackendModel } from "./oauth"

export function toOpenAiCodexApiFormat(value: string | undefined): ApiFormat | undefined {
	if (!value) {
		return undefined
	}
	const normalized = value.trim().toLowerCase().replace(/[-_\s]/g, "")
	if (normalized === "openairesponses" || normalized === "responses") {
		return ApiFormat.OPENAI_RESPONSES
	}
	if (normalized === "openairesponseswebsocket" || normalized === "responseswebsocket") {
		return ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE
	}
	return undefined
}

export function toOpenAiCodexBackendModelInfo(model: OpenAiCodexBackendModel): ModelInfo {
	const defaultInfo = openAiCodexModels[openAiCodexDefaultModelId]
	return {
		...defaultInfo,
		name: model.name?.trim() || model.id,
		...(typeof model.maxTokens === "number" ? { maxTokens: model.maxTokens } : {}),
		...(typeof model.contextWindow === "number" ? { contextWindow: model.contextWindow } : {}),
		...(typeof model.supportsImages === "boolean" ? { supportsImages: model.supportsImages } : {}),
		...(typeof model.supportsPromptCache === "boolean" ? { supportsPromptCache: model.supportsPromptCache } : {}),
		...(typeof model.supportsReasoning === "boolean" ? { supportsReasoning: model.supportsReasoning } : {}),
		...(model.description ? { description: model.description } : {}),
		apiFormat: toOpenAiCodexApiFormat(model.apiFormat) ?? defaultInfo.apiFormat,
		inputPrice: 0,
		outputPrice: 0,
	}
}

export function mergeOpenAiCodexBackendModels(
	backendModels: OpenAiCodexBackendModel[],
): Record<string, ModelInfo> {
	return {
		...openAiCodexModels,
		...Object.fromEntries(backendModels.map((model) => [model.id, toOpenAiCodexBackendModelInfo(model)])),
	}
}
