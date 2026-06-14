import { describe, expect, it } from "vitest"
import { sanitizeCompletionText } from "./CompletionOutputRow"

describe("sanitizeCompletionText", () => {
	it("hides closed thinking blocks from completion output", () => {
		expect(sanitizeCompletionText("<thinking>internal note</thinking>\n\nDone.")).toBe("Done.")
	})

	it("hides dangling leading thinking content from completion output", () => {
		expect(sanitizeCompletionText("<thinking>I confirmed internal state only")).toBe("Task completed.")
	})

	it("keeps visible content after a dangling leading thinking paragraph", () => {
		expect(sanitizeCompletionText("<thinking>internal note\n\nActual result.")).toBe("Actual result.")
	})
})
