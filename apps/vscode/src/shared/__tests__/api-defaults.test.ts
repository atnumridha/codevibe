import { expect } from "chai"
import { DEFAULT_API_PROVIDER, openAiCodexDefaultModelId, openAiCodexModels, openAiNativeModels } from "../api"
import {
	convertApiConfigurationToProto,
	convertProtoToApiConfiguration,
	convertProtoToApiProvider,
} from "../proto-conversions/models/api-configuration-conversion"
import { ApiProvider as ProtoApiProvider, ModelsApiConfiguration } from "../proto/cline/models"

describe("API defaults", () => {
	it("defaults new installs to ChatGPT for Codie with the latest bundled model", () => {
		expect(DEFAULT_API_PROVIDER).to.equal("openai-codex")
		expect(openAiCodexDefaultModelId).to.equal("gpt-5.5-pro")
	})

	it("keeps bundled Codex fallback models aligned with the SDK Codex catalog filter", () => {
		const modelIds = Object.keys(openAiCodexModels)

		expect(modelIds).to.include.members([
			"gpt-5.5",
			"gpt-5.5-pro",
			"gpt-5.2",
			"gpt-5.3-codex",
			"gpt-5.3-codex-spark",
			"gpt-5.4",
			"gpt-5.4-mini",
		])
		for (const staleModelId of [
			"gpt-5.1-codex-max",
			"gpt-5.1-codex-mini",
			"gpt-5.2-codex",
		]) {
			expect(modelIds).to.not.include(staleModelId)
		}
		expect(openAiCodexModels["gpt-5.5"].contextWindow).to.equal(400_000)
		expect(openAiCodexModels["gpt-5.5-pro"].name).to.equal("GPT-5.5 Pro")
		expect(openAiCodexModels["gpt-5.5-pro"].contextWindow).to.equal(1_050_000)
		expect(openAiCodexModels["gpt-5.5-pro"].supportsPromptCache).to.equal(false)
		expect(openAiCodexModels["gpt-5.3-codex-spark"].maxTokens).to.equal(32_000)
	})

	it("keeps OpenAI Native model choices aligned with the generated GPT catalog", () => {
		expect(openAiNativeModels["gpt-5.5"].name).to.equal("GPT-5.5")
		expect(openAiNativeModels["gpt-5.5-pro"].name).to.equal("GPT-5.5 Pro")
		expect(openAiNativeModels["gpt-5.5-pro"].contextWindow).to.equal(1_050_000)
		expect(openAiNativeModels["gpt-5.5-pro"].supportsPromptCache).to.equal(false)
	})

	it("defaults proto settings to ChatGPT for Codie when provider fields are absent", () => {
		const proto = convertApiConfigurationToProto({})

		expect(proto.planModeApiProvider).to.equal(ProtoApiProvider.OPENAI_CODEX)
		expect(proto.actModeApiProvider).to.equal(ProtoApiProvider.OPENAI_CODEX)

		const config = convertProtoToApiConfiguration(ModelsApiConfiguration.create({}))

		expect(config.planModeApiProvider).to.equal(DEFAULT_API_PROVIDER)
		expect(config.actModeApiProvider).to.equal(DEFAULT_API_PROVIDER)
		expect(convertProtoToApiProvider(-1 as ProtoApiProvider)).to.equal(
			DEFAULT_API_PROVIDER,
		)
	})
})
