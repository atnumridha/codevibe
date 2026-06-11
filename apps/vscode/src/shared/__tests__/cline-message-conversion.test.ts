import { strict as assert } from "node:assert"
import { ClineMessage, ClineMessageType, ClineSay } from "../proto/cline/ui"
import { convertClineMessageToProto, convertProtoToClineMessage } from "../proto-conversions/cline-message"

describe("Cline message proto conversion", () => {
	it("uses CodeVibe workspace ignore messages over the legacy app-level name", () => {
		const protoMessage = convertClineMessageToProto({
			ts: 1,
			type: "say",
			say: "workspace_ignore_error",
			text: "secret.txt",
		})

		assert.equal(protoMessage.say, ClineSay.CLINEIGNORE_ERROR)

		const appMessage = convertProtoToClineMessage(
			ClineMessage.create({
				ts: 1,
				type: ClineMessageType.SAY,
				say: ClineSay.CLINEIGNORE_ERROR,
				text: "secret.txt",
			}),
		)

		assert.equal(appMessage.say, "workspace_ignore_error")
		assert.equal(appMessage.text, "secret.txt")
	})
})
