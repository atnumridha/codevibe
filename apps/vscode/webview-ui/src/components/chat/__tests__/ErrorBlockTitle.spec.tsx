import { describe, expect, it } from "vitest"
import { ErrorBlockTitle } from "../ErrorBlockTitle"

describe("ErrorBlockTitle", () => {
	it("should return icon and title for API request cancelled", () => {
		const [icon, title] = ErrorBlockTitle({
			apiReqCancelReason: "user_cancelled",
		})

		expect(icon).toBeDefined()
		expect(title).toBeDefined()
	})

	it("should return icon and title for completed API request", () => {
		const [icon, title] = ErrorBlockTitle({
			cost: 0.001,
		})

		expect(icon).toBeDefined()
		expect(title).toBeDefined()
	})

	it("should return icon and title for failed API request", () => {
		const [icon, title] = ErrorBlockTitle({
			apiRequestFailedMessage: "Request failed",
		})

		expect(icon).toBeDefined()
		expect(title).toBeDefined()
	})

	it("uses product-neutral usage copy for balance and spend limits", () => {
		const [, balanceTitle] = ErrorBlockTitle({
			apiRequestFailedMessage: JSON.stringify({
				code: "insufficient_credits",
				details: { current_balance: 0 },
			}),
		})
		const [, spendTitle] = ErrorBlockTitle({
			apiRequestFailedMessage: JSON.stringify({
				code: "SPEND_LIMIT_EXCEEDED",
			}),
		})

		expect(balanceTitle.props.children).toBe("Usage limit reached")
		expect(spendTitle.props.children).toBe("Usage limit reached")
	})

	it("should return icon and title for retry status", () => {
		const [icon, title] = ErrorBlockTitle({
			retryStatus: {
				attempt: 2,
				maxAttempts: 3,
				delaySec: 5,
			},
		})

		expect(icon).toBeDefined()
		expect(title).toBeDefined()
	})

	it("should return icon and title for default API request", () => {
		const [icon, title] = ErrorBlockTitle({})

		expect(icon).toBeDefined()
		expect(title).toBeDefined()
	})
})
