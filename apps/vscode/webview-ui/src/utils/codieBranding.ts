const CODIE_HOSTED_PROVIDER_IDS = new Set(["cline", "openai-codex"])

const RAW_MODEL_ID_PATTERN = /[/:]|\b(?:anthropic|openai|google|gemini|claude|codex|chatgpt|openrouter)\b/i
const HOSTED_MODEL_BRAND_PATTERN =
	/\b(?:Anthropic|Claude|OpenAI|ChatGPT|Codex|Google|Gemini|DeepSeek|Mistral|Groq|OpenRouter|KwaiKAT|Arcee AI|MiniMax|Pro)\b/i

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").replace(/\s+([.,:;])/g, "$1").trim()
}

function fallbackModelName(fallbackLabel: string, sourceText: string): string {
	const lower = sourceText.toLowerCase()
	const normalizedFallback = fallbackLabel.toLowerCase()

	if (normalizedFallback.includes("free") || normalizedFallback.includes("starter")) {
		return lower.includes("fast") || lower.includes("mini") || lower.includes("spark")
			? "Fast starter model"
			: "Starter model"
	}
	if (lower.includes("context") || lower.includes("1m") || lower.includes("long")) {
		return "Long-context coding model"
	}
	if (lower.includes("fast") || lower.includes("mini") || lower.includes("spark") || lower.includes("speed")) {
		return "Fast coding model"
	}
	if (
		lower.includes("highest") ||
		lower.includes("advanced") ||
		lower.includes("intelligent") ||
		lower.includes("reasoning") ||
		lower.includes("opus") ||
		lower.includes("pro")
	) {
		return "Advanced coding model"
	}
	if (lower.includes("preview") || lower.includes("new")) {
		return "Preview coding model"
	}

	return normalizedFallback.includes("recommended") ? "Recommended model" : "Codie model"
}

export function isCodieHostedProviderId(providerId?: string): boolean {
	return !!providerId && CODIE_HOSTED_PROVIDER_IDS.has(providerId)
}

export function getCodieHostedProviderLabel(providerId?: string): string | undefined {
	return isCodieHostedProviderId(providerId) ? "Codie" : providerId
}

export function sanitizeCodieHostedErrorText(value: string): string {
	return normalizeWhitespace(
		value
			.replace(/\bopenai-codex\b/gi, "Codie")
			.replace(/\bOpenAI Codex\b/g, "Codie")
			.replace(/\bChatGPT(?:\s+(?:Plus|Pro|Plus\/Pro|Plus or Pro))?\b/gi, "Codie")
			.replace(/\bCline\b/g, "Codie")
			.replace(/\bCodeVibe\b/g, "Codie")
			.replace(/\bAPI key\b/gi, "sign-in")
			.replace(/\bsubscriptions?\b/gi, "access")
			.replace(/\bbilling\b/gi, "access")
			.replace(/\bcredits?\b/gi, "capacity")
			.replace(/\bPro\b/g, "advanced"),
	)
}

export function sanitizeCodieHostedModelDescription(value: string | undefined, fallbackLabel = "Recommended"): string {
	const fallback = fallbackLabel.toLowerCase().includes("free") || fallbackLabel.toLowerCase().includes("starter")
		? "Starter model"
		: "Recommended model"
	if (!value?.trim()) {
		return fallback
	}

	const sanitized = normalizeWhitespace(
		value
			.replace(/\b(?:OpenAI|Anthropic|Google|KwaiKAT|Arcee AI|MiniMax)'s\b/gi, "This model's")
			.replace(/\b(?:OpenAI|Anthropic|Google|KwaiKAT|Arcee AI|MiniMax)\s*:?/gi, "")
			.replace(/\b(?:Claude|Gemini|ChatGPT|Codex)\b/gi, "Codie")
			.replace(/\bPro\b/g, "advanced")
			.replace(/\bsubscriptions?\b/gi, "access")
			.replace(/\bbilling\b/gi, "access")
			.replace(/\bcredits?\b/gi, "capacity"),
	)

	return sanitized || fallback
}

export function getCodieHostedModelDisplayName(
	model: { id: string; name?: string; description?: string; tags?: readonly string[] },
	fallbackLabel = "Recommended",
): string {
	const rawName = model.name?.trim()
	if (
		rawName &&
		rawName.toLowerCase() !== model.id.trim().toLowerCase() &&
		!RAW_MODEL_ID_PATTERN.test(rawName) &&
		!HOSTED_MODEL_BRAND_PATTERN.test(rawName)
	) {
		return rawName
	}

	return fallbackModelName(fallbackLabel, `${rawName ?? ""} ${model.description ?? ""} ${model.id} ${(model.tags ?? []).join(" ")}`)
}
