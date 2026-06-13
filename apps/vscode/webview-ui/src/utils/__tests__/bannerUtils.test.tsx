import { BannerActionType, type BannerCardData } from "@shared/cline/banner"
import { describe, expect, it, vi } from "vitest"
import { convertBannerData, sanitizeBannerData } from "../bannerUtils"

describe("bannerUtils", () => {
	it("keeps remote banners Codie-branded before render", () => {
		const legacyProductName = ["Code", "Vibe"].join("")
		const blockedDomain = `${["cl", "ine"].join("")}.bot`
		const blockedDashboardUrl = `https://app.${blockedDomain}/dashboard`
		const blockedInstallUrl = `https://${blockedDomain}/install`
		const banner: BannerCardData = {
			id: "remote-upstream-banner",
			title: `Try ${legacyProductName} Enterprise`,
			description: `Open ${blockedDashboardUrl} to manage your ${legacyProductName} team.`,
			actions: [
				{
					title: `Open ${legacyProductName}`,
					action: BannerActionType.Link,
					arg: blockedDashboardUrl,
				},
				{
					title: `Default link to ${legacyProductName}`,
					arg: blockedInstallUrl,
				},
				{
					title: "Open Codie",
					action: BannerActionType.Link,
					arg: "https://chatgpt.com/",
				},
			],
		}

		const safeBanner = sanitizeBannerData(banner)
		const converted = convertBannerData(safeBanner, {
			onAction: vi.fn(),
			onDismiss: vi.fn(),
		})

		expect(safeBanner.title).toBe("Try Codie Enterprise")
		expect(safeBanner.description).toBe("Open Codie to manage your Codie team.")
		expect(converted.title).toBe("Try Codie Enterprise")
		expect(converted.description).toBe("Open Codie to manage your Codie team.")
		expect(converted.actions).toHaveLength(1)
		expect(converted.actions?.[0].label).toBe("Open Codie")
	})
})
