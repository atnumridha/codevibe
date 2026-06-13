import type { ModelInfo } from "../catalog/types";

export const OPENAI_CODEX_DEFAULT_MODEL_ID = "gpt-5.5-pro";

const OPENAI_CODEX_ALLOWED_MODELS = new Set([
	OPENAI_CODEX_DEFAULT_MODEL_ID,
	"gpt-5.5",
	"gpt-5.2",
	"gpt-5.3-codex",
	"gpt-5.3-codex-spark",
	"gpt-5.4",
	"gpt-5.4-mini",
]);

const STALE_OPENAI_CODEX_MODEL_IDS = new Set([
	"gpt-5",
	"gpt-5-codex",
	"gpt-5-mini",
	"gpt-5-nano",
	"gpt-5-chat-latest",
	"gpt-5.1",
	"gpt-5.1-codex",
	"gpt-5.1-codex-max",
	"gpt-5.1-codex-mini",
	"gpt-5.1-chat-latest",
	"gpt-5.2-codex",
	"gpt-5.2-chat-latest",
]);

function isOpenAICodexAllowedModel(id: string): boolean {
	if (OPENAI_CODEX_ALLOWED_MODELS.has(id)) return true;
	const match = id.match(/^gpt-(\d+\.\d+)/);
	return match ? Number.parseFloat(match[1]) > 5.4 : false;
}

function toOpenAICodexModel(id: string, model: ModelInfo): ModelInfo {
	if (id !== "gpt-5.5") {
		return model;
	}
	return {
		...model,
		contextWindow: 400_000,
		maxInputTokens: 272_000,
		maxTokens: 128_000,
	};
}

export function filterOpenAICodexModels(
	models: Record<string, ModelInfo>,
): Record<string, ModelInfo> {
	return Object.fromEntries(
		Object.entries(models)
			.filter(([id]) => isOpenAICodexAllowedModel(id))
			.map(([id, model]) => [id, toOpenAICodexModel(id, model)]),
	);
}

export function normalizeOpenAICodexRuntimeModelId(
	modelId: string | undefined,
	knownModels?: Record<string, ModelInfo>,
): string {
	const trimmed = modelId?.trim();
	if (!trimmed) {
		return OPENAI_CODEX_DEFAULT_MODEL_ID;
	}

	const unprefixed = trimmed.startsWith("openai/")
		? trimmed.slice("openai/".length)
		: trimmed;
	if (
		OPENAI_CODEX_ALLOWED_MODELS.has(unprefixed) ||
		knownModels?.[unprefixed]
	) {
		return unprefixed;
	}
	if (STALE_OPENAI_CODEX_MODEL_IDS.has(unprefixed)) {
		return OPENAI_CODEX_DEFAULT_MODEL_ID;
	}
	return unprefixed;
}
