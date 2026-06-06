import { expect } from "chai"
import { DEFAULT_API_PROVIDER, openAiCodexDefaultModelId } from "../api"
import {
	convertApiConfigurationToProto,
	convertProtoToApiConfiguration,
	convertProtoToApiProvider,
} from "../proto-conversions/models/api-configuration-conversion"
import { ApiProvider as ProtoApiProvider } from "../proto/cline/models"

describe("API defaults", () => {
	it("defaults new installs to OpenAI Codex with the latest bundled Codex model", () => {
		expect(DEFAULT_API_PROVIDER).to.equal("openai-codex")
		expect(openAiCodexDefaultModelId).to.equal("gpt-5.5")
	})

	it("defaults proto settings to OpenAI Codex when provider fields are absent", () => {
		const proto = convertApiConfigurationToProto({})

		expect(proto.planModeApiProvider).to.equal(ProtoApiProvider.OPENAI_CODEX)
		expect(proto.actModeApiProvider).to.equal(ProtoApiProvider.OPENAI_CODEX)

		const config = convertProtoToApiConfiguration({})

		expect(config.planModeApiProvider).to.equal(DEFAULT_API_PROVIDER)
		expect(config.actModeApiProvider).to.equal(DEFAULT_API_PROVIDER)
		expect(convertProtoToApiProvider(-1 as ProtoApiProvider)).to.equal(
			DEFAULT_API_PROVIDER,
		)
	})
})
