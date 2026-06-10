import { expect } from "chai"
import { getActVsPlanModeSection } from "../components/act_vs_plan_mode"

describe("visual planning prompt guidance", () => {
	it("instructs Plan mode to render Mermaid visual plans for non-trivial work", async () => {
		const text = await getActVsPlanModeSection({} as any, { yoloModeToggled: false } as any)

		expect(text).to.include("make visual planning a first-class output")
		expect(text).to.include("```mermaid")
	})
})
