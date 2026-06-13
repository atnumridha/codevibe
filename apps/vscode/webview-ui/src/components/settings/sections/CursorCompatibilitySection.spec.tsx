import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { FileServiceClient, UiServiceClient } from "@/services/grpc-client"
import CursorCompatibilitySection from "./CursorCompatibilitySection"
import { CURSOR_COMPATIBLE_ROUTE_LABELS } from "./cursorCompatibilityPreview"

const extensionState = vi.hoisted(() => ({
	browserSettings: { allowBrowserEvaluate: false },
	compatibilityStatus: {
		enabled: true,
		deepLinksEnabled: true,
		retrievalIndexingPrivacyGate: true,
		sandboxPolicy: "prompt",
		sandboxRuntime: {
			status: "loaded",
			effectiveAccess: "workspace",
			readablePathCount: 2,
			writablePathCount: 1,
			networkDefault: "deny",
			networkAllowCount: 1,
			blockGitWrites: true,
			allowTerminalAutoApprove: true,
		},
		safeBrowserEvaluateEnabled: false,
		effectiveBrowserEvaluateEnabled: false,
		openAiCodexAuthSource: "auto",
		openAiCodexAuthenticated: true,
	},
	enableParallelToolCalling: true,
	openAiCodexIsAuthenticated: true,
	subagentsEnabled: true,
	vscodeTerminalExecutionMode: "backgroundExec",
	worktreesEnabled: { user: true, featureFlag: true },
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => extensionState,
}))

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: {
		copyToClipboard: vi.fn(),
	},
	UiServiceClient: {
		handleUri: vi.fn(),
		getCursorNdjsonIngestStatus: vi.fn(),
		startCursorNdjsonIngest: vi.fn(),
		stopCursorNdjsonIngest: vi.fn(),
		reassignCursorNdjsonIngestPort: vi.fn(),
		getCursorNdjsonIngestCurlCommand: vi.fn(),
	},
}))

describe("CursorCompatibilitySection", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(UiServiceClient.getCursorNdjsonIngestStatus).mockResolvedValue({
			running: false,
			bindAddress: "127.0.0.1",
			port: 0,
			url: "",
		})
	})

	it("renders all supported route families and parity surfaces", async () => {
		render(<CursorCompatibilitySection renderSectionHeader={() => null} />)

		for (const route of CURSOR_COMPATIBLE_ROUTE_LABELS) {
			expect(screen.getByText(`${route.label}: ${route.path}`)).toBeInTheDocument()
		}

			expect(screen.getAllByText("Local sign-in import").length).toBeGreaterThan(0)
		expect(screen.getByText("Background workstreams")).toBeInTheDocument()
		expect(screen.getByText("NDJSON ingest")).toBeInTheDocument()
		expect(screen.getByText("Compatibility on")).toBeInTheDocument()
		expect(screen.getByText("Retrieval privacy")).toBeInTheDocument()
		expect(screen.getByText("Import ignore rules gate search/indexing")).toBeInTheDocument()
		expect(screen.getByText("Validated import-compatible route families")).toBeInTheDocument()
		expect(screen.getByText("Sandbox policy")).toBeInTheDocument()
		expect(screen.getByText("Configured prompt; access workspace; writes 1; network deny.")).toBeInTheDocument()
		expect(screen.getByText("loaded")).toBeInTheDocument()
		expect(screen.getByText("Terminal mode")).toBeInTheDocument()
		await waitFor(() => expect(UiServiceClient.getCursorNdjsonIngestStatus).toHaveBeenCalled())
	})

	it("shows a redacted preview but launches the original URI", async () => {
		vi.mocked(UiServiceClient.handleUri).mockResolvedValue({ value: true })
		const rawUri =
			"vscode://atnumridha.codevibe/mcp/install?name=docs&token=secret-token&url=https%3A%2F%2Fmcp.example.com%2Fcallback%3Fapi_key%3Dsecret-query"
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

	it("starts NDJSON ingest and copies the explicit curl command", async () => {
		vi.mocked(UiServiceClient.startCursorNdjsonIngest).mockResolvedValue({
			running: true,
			bindAddress: "127.0.0.1",
			port: 7242,
			url: "http://127.0.0.1:7242",
		})
		vi.mocked(UiServiceClient.getCursorNdjsonIngestCurlCommand).mockResolvedValue({
			value: "curl -X POST 'http://127.0.0.1:7242/ingest' --data-binary @events.ndjson",
		})
		vi.mocked(FileServiceClient.copyToClipboard).mockResolvedValue({})
		render(<CursorCompatibilitySection renderSectionHeader={() => null} />)

		fireEvent.click(screen.getByText("Start"))

		await waitFor(() => expect(UiServiceClient.startCursorNdjsonIngest).toHaveBeenCalledTimes(1))
		expect(screen.getByText("NDJSON ingest is http://127.0.0.1:7242/ingest.")).toBeInTheDocument()

		fireEvent.click(screen.getByText("Copy curl"))

		await waitFor(() => expect(UiServiceClient.getCursorNdjsonIngestCurlCommand).toHaveBeenCalledTimes(1))
		expect(FileServiceClient.copyToClipboard).toHaveBeenCalledWith(
			expect.objectContaining({
				value: expect.stringContaining("curl -X POST"),
			}),
		)
		expect(screen.getByText("Copied NDJSON ingest curl command.")).toBeInTheDocument()
	})
})
