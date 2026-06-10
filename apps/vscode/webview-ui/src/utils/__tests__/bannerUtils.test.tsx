import { BannerActionType, type BannerCardData } from "@shared/cline/banner"
import { describe, expect, it, vi } from "vitest"
import { convertBannerData, sanitizeBannerData } from "../bannerUtils"

describe("bannerUtils", () => {
	it("keeps remote banners CodeVibe-branded before render", () => {
		const banner: BannerCardData = {
			id: "remote-upstream-banner",
			title: "Try Cline Enterprise",
			description: "Open https://app.cline.bot to manage your Cline team.",
			actions: [
				{
					title: "Open Cline",
					action: BannerActionType.Link,
					arg: "https://app.cline.bot/dashboard",
				},
				{
					title: "Default link to Cline",
					arg: "https://cline.bot/install",
				},
				{
					title: "Open CodeVibe",
					action: BannerActionType.Link,
					arg: "https://codevibe.dev/dashboard",
				},
			],
		}

		const safeBanner = sanitizeBannerData(banner)
		const converted = convertBannerData(safeBanner, {
			onAction: vi.fn(),
			onDismiss: vi.fn(),
		})

		expect(safeBanner.title).toBe("Try CodeVibe Enterprise")
		expect(safeBanner.description).toBe("Open codevibe.dev to manage your CodeVibe team.")
		expect(converted.title).toBe("Try CodeVibe Enterprise")
		expect(converted.description).toBe("Open codevibe.dev to manage your CodeVibe team.")
		expect(converted.actions).toHaveLength(1)
		expect(converted.actions?.[0].label).toBe("Open CodeVibe")
	})
})
