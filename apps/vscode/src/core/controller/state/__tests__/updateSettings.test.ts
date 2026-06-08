import { expect } from "chai"
import sinon from "sinon"
import { ApiProvider as ProtoApiProvider, ModelsApiConfiguration } from "@shared/proto/cline/models"
import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import { updateSettings } from "../updateSettings"

describe("updateSettings", () => {
	afterEach(() => {
		sinon.restore()
	})

	it("preserves ApiProvider enum value 0 when converting Plan and Act providers", async () => {
		const setApiConfiguration = sinon.stub()
		const controller = {
			stateManager: {
				setApiConfiguration,
			},
			postStateToWebview: sinon.stub().resolves(),
		}

		await updateSettings(
			controller as any,
			UpdateSettingsRequest.create({
				apiConfiguration: ModelsApiConfiguration.create({
					planModeApiProvider: ProtoApiProvider.ANTHROPIC,
					actModeApiProvider: ProtoApiProvider.ANTHROPIC,
				}),
			}),
		)

		sinon.assert.calledOnce(setApiConfiguration)
		expect(setApiConfiguration.firstCall.args[0]).to.deep.include({
			planModeApiProvider: "anthropic",
			actModeApiProvider: "anthropic",
		})
	})
})
