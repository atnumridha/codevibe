import { expect } from "chai"
import { deepPlanningToolResponse } from "../commands"

describe("deepPlanningToolResponse", () => {
	it("includes a visual plan section in the generic fallback prompt", () => {
		const prompt = deepPlanningToolResponse(
			undefined,
			{ providerId: "test", model: { id: "unknown-model", info: {} }, mode: "act" } as any,
			false,
		)

		expect(prompt).to.include("[Visual Plan]")
		expect(prompt).to.include("```mermaid")
	})

	it("uses the dynamic GPT-5.1 template instead of an empty variant template", () => {
		const prompt = deepPlanningToolResponse(
			{ enabled: true },
			{ providerId: "openai", model: { id: "gpt-5.1", info: {} }, mode: "act" } as any,
			true,
		)

		expect(prompt).to.include("This process has five distinct steps")
		expect(prompt).to.include("[Visual Plan]")
		expect(prompt).to.include("```mermaid")
	})
})
