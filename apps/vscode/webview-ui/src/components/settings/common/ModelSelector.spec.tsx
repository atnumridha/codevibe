import type { ModelInfo } from "@shared/api"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ModelSelector } from "./ModelSelector"

describe("ModelSelector", () => {
	it("shows model display names while preserving raw ids as option values", () => {
		render(
			<ModelSelector
				models={
					{
						"gpt-5.5-pro": { name: "GPT-5.5 Pro" },
						"backend-only-model": {},
					} as Record<string, ModelInfo>
				}
				onChange={vi.fn()}
				selectedModelId="gpt-5.5-pro"
			/>,
		)

		expect(screen.getByText("GPT-5.5 Pro")).toBeInTheDocument()
		expect(screen.getByText("backend-only-model")).toBeInTheDocument()
	})
})
