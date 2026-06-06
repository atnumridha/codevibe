import { describe, it } from "mocha"
import "should"
import { getEffectiveBrowserSettings, type BrowserSettings } from "../BrowserSettings"

const baseSettings: BrowserSettings = {
	viewport: { width: 900, height: 600 },
	allowBrowserEvaluate: false,
}

describe("BrowserSettings", () => {
	describe("getEffectiveBrowserSettings", () => {
		it("keeps browser evaluate disabled by default", () => {
			const result = getEffectiveBrowserSettings(baseSettings)

			result.allowBrowserEvaluate.should.equal(false)
		})

		it("preserves the Browser Settings evaluate toggle", () => {
			const result = getEffectiveBrowserSettings({
				...baseSettings,
				allowBrowserEvaluate: true,
			})

			result.allowBrowserEvaluate.should.equal(true)
		})

		it("allows Cursor-compatible safe browser evaluate to enable the same gate", () => {
			const result = getEffectiveBrowserSettings(baseSettings, {
				cursorCompatibilitySafeBrowserEvaluateEnabled: true,
			})

			result.allowBrowserEvaluate.should.equal(true)
		})
	})
})
