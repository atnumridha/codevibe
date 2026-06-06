import { expect } from "chai"
import { DEFAULT_API_PROVIDER, openAiCodexDefaultModelId } from "../api"

describe("API defaults", () => {
	it("defaults new installs to OpenAI Codex with the latest bundled Codex model", () => {
		expect(DEFAULT_API_PROVIDER).to.equal("openai-codex")
		expect(openAiCodexDefaultModelId).to.equal("gpt-5.5")
	})
})
