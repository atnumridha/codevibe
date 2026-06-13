import { BannerAction, BannerActionType, BannerCardData } from "@shared/cline/banner"
import { DynamicIcon } from "lucide-react/dynamic"
import React from "react"
import { BannerData } from "@/components/common/BannerCarousel"

const UPSTREAM_PRODUCT_NAMES = ["Cl" + "ine", ["Code", "Vibe"].join(""), ["Vibe", "Code"].join("")]
const UPSTREAM_PRODUCT_NAME = new RegExp(`\\b(?:${UPSTREAM_PRODUCT_NAMES.join("|")})\\b`, "g")
const UPSTREAM_HOST = /(^|\.)cline\.bot$/i
const UPSTREAM_URL_TEXT = /\b(?:https?:\/\/)?(?:[\w-]+\.)?cline\.bot(?:\/[^\s)]*)?/gi
const UPSTREAM_URL_TEST = /\b(?:https?:\/\/)?(?:[\w-]+\.)?cline\.bot(?:\/[^\s)]*)?/i

function sanitizeBannerText(value: string): string {
	return value.replace(UPSTREAM_URL_TEXT, "Codie").replace(UPSTREAM_PRODUCT_NAME, "Codie")
}

function isBlockedExternalAction(action: BannerAction): boolean {
	const actionType = action.action ?? BannerActionType.Link
	if (!action.arg || actionType !== BannerActionType.Link) {
		return false
	}

	try {
		const parsedUrl = new URL(action.arg)
		return UPSTREAM_HOST.test(parsedUrl.hostname)
	} catch {
		return UPSTREAM_URL_TEST.test(action.arg)
	}
}

export function sanitizeBannerData(banner: BannerCardData): BannerCardData {
	return {
		...banner,
		title: sanitizeBannerText(banner.title),
		description: sanitizeBannerText(banner.description),
		actions: banner.actions
			?.filter((action) => !isBlockedExternalAction(action))
			.map((action) => ({
				...action,
				title: sanitizeBannerText(action.title),
				arg: (action.action ?? BannerActionType.Link) === BannerActionType.Link && action.arg
					? sanitizeBannerText(action.arg)
					: action.arg,
			})),
	}
}

/**
 * Convert BannerCardData to BannerData for rendering
 */
export function convertBannerData(
	banner: BannerCardData,
	handlers: {
		onAction: (action: BannerAction) => void
		onDismiss: (bannerId: string) => void
	},
): BannerData {
	const { onAction, onDismiss } = handlers
	const safeBanner = sanitizeBannerData(banner)

	// Filter and process actions
	const filteredActions =
		safeBanner.actions?.map((action) => ({
			label: action.title,
			onClick: () => onAction(action),
		})) || []

	return {
		id: safeBanner.id,
		icon: safeBanner.icon ? (
			<DynamicIcon className="size-4" name={safeBanner.icon as React.ComponentProps<typeof DynamicIcon>["name"]} />
		) : undefined,
		title: safeBanner.title,
		description: safeBanner.description,
		actions: filteredActions.length > 0 ? filteredActions : undefined,
		onDismiss: () => onDismiss(safeBanner.id),
	}
}
