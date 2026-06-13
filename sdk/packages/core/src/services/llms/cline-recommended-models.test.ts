import { describe, expect, it } from "vitest";
import { FALLBACK_CLINE_RECOMMENDED_MODELS } from "./cline-recommended-models";

const VISIBLE_VENDOR_PATTERN =
	/\b(?:OpenAI|Anthropic|Google|Claude|Gemini|Codex|KwaiKAT|Arcee AI)\b/i;

describe("recommended model fallback", () => {
	it("keeps bundled Codie fallback labels vendor-neutral", () => {
		const models = [
			...FALLBACK_CLINE_RECOMMENDED_MODELS.recommended,
			...FALLBACK_CLINE_RECOMMENDED_MODELS.free,
		];

		for (const model of models) {
			expect(model.name).not.toMatch(VISIBLE_VENDOR_PATTERN);
			expect(model.description).not.toMatch(VISIBLE_VENDOR_PATTERN);
		}
	});
});
