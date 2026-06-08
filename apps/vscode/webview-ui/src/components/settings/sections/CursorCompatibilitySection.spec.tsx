import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { UiServiceClient } from "@/services/grpc-client"
import CursorCompatibilitySection from "./CursorCompatibilitySection"
import { CURSOR_COMPATIBLE_ROUTE_LABELS } from "./cursorCompatibilityPreview"

vi.mock("@/services/grpc-client", () => ({
	UiServiceClient: {
		handleUri: vi.fn(),
	},
}))

describe("CursorCompatibilitySection", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders all supported route families and parity surfaces", () => {
		render(<CursorCompatibilitySection renderSectionHeader={() => null} />)

		for (const route of CURSOR_COMPATIBLE_ROUTE_LABELS) {
			expect(screen.getByText(`${route.label}: ${route.path}`)).toBeInTheDocument()
		}

		expect(screen.getByText("Codex auth")).toBeInTheDocument()
		expect(screen.getByText("Background workstreams")).toBeInTheDocument()
		expect(screen.getByText("NDJSON ingest")).toBeInTheDocument()
	})

	it("shows a redacted preview but launches the original URI", async () => {
		vi.mocked(UiServiceClient.handleUri).mockResolvedValue({ value: true })
		const rawUri =
			"vscode://cline.cline/mcp/install?name=docs&token=secret-token&url=https%3A%2F%2Fmcp.example.com%2Fcallback%3Fapi_key%3Dsecret-query"
		const { container } = render(<CursorCompatibilitySection renderSectionHeader={() => null} />)

		const textarea = container.querySelector("#cursor-compatible-uri")
		expect(textarea).toBeTruthy()

		fireEvent.change(textarea as Element, { target: { value: rawUri } })

		const preview = screen.getByLabelText("Redacted URI preview")
		expect(preview.textContent).toContain("[REDACTED]")
		expect(preview.textContent).not.toContain("secret-token")
		expect(preview.textContent).not.toContain("secret-query")

		fireEvent.click(screen.getByText("Launch URI"))

		await waitFor(() => expect(UiServiceClient.handleUri).toHaveBeenCalledTimes(1))
		expect(vi.mocked(UiServiceClient.handleUri).mock.calls[0][0].value).to.equal(rawUri)
		expect(screen.getByText("URI accepted.")).toBeInTheDocument()
	})
})
