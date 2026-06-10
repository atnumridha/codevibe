import { expect } from "chai"
import { describe, it } from "mocha"
import { getRawExtensionUriString } from "./ExtensionUriString"

describe("getRawExtensionUriString", () => {
	it("preserves encoded Cursor query separators for downstream parsing", () => {
		const raw = "vscode://atnumridha.codevibe/createchat?prompt=Review%20A%20%26%20B%20%3D%20ok%23section"

		expect(getRawExtensionUriString({ toString: () => raw })).to.equal(raw)
		expect(getRawExtensionUriString({ toString: () => raw })).not.to.equal(decodeURIComponent(raw))
	})
})
