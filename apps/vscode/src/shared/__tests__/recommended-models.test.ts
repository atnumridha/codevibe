import { expect } from "chai"
import { CLINE_RECOMMENDED_MODELS_FALLBACK } from "../cline/recommended-models"

const VISIBLE_VENDOR_PATTERN = /\b(?:OpenAI|Anthropic|Google|Claude|Gemini|Codex|KwaiKAT|Arcee AI)\b/i

describe("recommended model fallback", () => {
	it("keeps bundled Codie fallback labels vendor-neutral", () => {
		const models = [
			...CLINE_RECOMMENDED_MODELS_FALLBACK.recommended,
			...CLINE_RECOMMENDED_MODELS_FALLBACK.free,
		]

		for (const model of models) {
			expect(model.name).to.not.match(VISIBLE_VENDOR_PATTERN)
			expect(model.description).to.not.match(VISIBLE_VENDOR_PATTERN)
		}
	})
})
