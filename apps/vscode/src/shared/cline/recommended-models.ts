export interface ClineRecommendedModel {
	id: string
	name: string
	description: string
	tags: string[]
}

export interface ClineRecommendedModelsData {
	recommended: ClineRecommendedModel[]
	free: ClineRecommendedModel[]
}

/**
 * Hardcoded fallback shown when upstream recommended models are not enabled or unavailable.
 */
export const CLINE_RECOMMENDED_MODELS_FALLBACK: ClineRecommendedModelsData = {
	recommended: [
		{
			id: "google/gemini-3.1-pro-preview",
			name: "Long-context coding model",
			description: "Large-context model tuned for repository-wide coding and agent workflows",
			tags: ["NEW"],
		},
		{
			id: "anthropic/claude-sonnet-4.6",
			name: "Balanced coding model",
			description: "Strong default for coding, chat, and agent workflows",
			tags: ["NEW"],
		},
		{
			id: "anthropic/claude-opus-4.6",
			name: "Advanced coding model",
			description: "High-capability model for complex agents and code reasoning",
			tags: ["BEST"],
		},
		{
			id: "openai/gpt-5.3-codex",
			name: "Recommended coding model",
			description: "Flagship coding model for Codie sign-in",
			tags: ["NEW"],
		},
	],
	free: [
		{
			id: "kwaipilot/kat-coder-pro",
			name: "Starter coding model",
			description: "Starter model for agentic coding workflows",
			tags: ["FREE"],
		},
		{
			id: "arcee-ai/trinity-large-preview:free",
			name: "Preview starter model",
			description: "Starter preview model for coding and chat",
			tags: ["FREE"],
		},
	],
}
