import { expect } from "chai"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import { StringRequest } from "@shared/proto/cline/common"
import { SharedUriHandler } from "@/services/uri/SharedUriHandler"
import { handleUri } from "../handleUri"

describe("ui handleUri", () => {
	afterEach(() => {
		sinon.restore()
	})

	it("returns false for empty URI input", async () => {
		const response = await handleUri({} as any, StringRequest.create({ value: "  " }))

		expect(response.value).to.equal(false)
	})

	it("delegates non-empty URI input to the shared URI handler", async () => {
		const controller = {} as any
		const handleUriStub = sinon.stub(SharedUriHandler, "handleUriWithController").resolves(true)
		const response = await handleUri(
			controller,
			StringRequest.create({ value: "vscode://cline.cline/createchat?prompt=hello" }),
		)

		expect(response.value).to.equal(true)
		sinon.assert.calledOnceWithExactly(handleUriStub, controller, "vscode://cline.cline/createchat?prompt=hello")
	})

	it("returns false when the shared URI handler rejects", async () => {
		sinon.stub(SharedUriHandler, "handleUriWithController").rejects(new Error("bad URI"))
		const response = await handleUri(
			{} as any,
			StringRequest.create({ value: "vscode://cline.cline/createchat?prompt=hello" }),
		)

		expect(response.value).to.equal(false)
	})
})
