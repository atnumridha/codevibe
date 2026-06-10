import type { ClineMessage } from "@shared/ExtensionMessage"
import { COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import { decodeTerminalRunMode } from "@shared/terminalPolicy"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TaskServiceClient } from "@/services/grpc-client"
import { CommandOutputRow } from "./CommandOutputRow"

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: {
		openFile: vi.fn(),
	},
	TaskServiceClient: {
		askResponse: vi.fn(),
	},
}))

vi.mock("../common/CodeBlock", () => ({
	default: ({ source }: { source: string }) => <pre>{source}</pre>,
}))

describe("CommandOutputRow", () => {
	const pendingCommand: ClineMessage = {
		ts: 1,
		type: "ask",
		ask: "command",
		text: `npm test${COMMAND_REQ_APP_STRING}`,
	}

	it("renders explicit sandboxed and elevated approval actions", () => {
		render(
			<CommandOutputRow
				isCommandPending={true}
				isOutputFullyExpanded={false}
				message={pendingCommand}
				setIsOutputFullyExpanded={() => undefined}
			/>,
		)

		expect(screen.getByRole("button", { name: "Run command in sandbox" })).toHaveTextContent("Sandboxed")
		expect(screen.getByRole("button", { name: "Run command elevated" })).toHaveTextContent("Elevated")
		expect(
			screen.getByText("Sandboxed commands use the workspace policy; elevated commands require this explicit approval."),
		).toBeInTheDocument()
	})

	it("sends hidden run-mode markers for sandboxed and elevated approvals", async () => {
		vi.mocked(TaskServiceClient.askResponse).mockResolvedValue({})
		render(
			<CommandOutputRow
				isCommandPending={true}
				isOutputFullyExpanded={false}
				message={pendingCommand}
				setIsOutputFullyExpanded={() => undefined}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: "Run command in sandbox" }))
		await waitFor(() => expect(TaskServiceClient.askResponse).toHaveBeenCalledTimes(1))
		expect(decodeTerminalRunMode(vi.mocked(TaskServiceClient.askResponse).mock.calls[0][0].text)).toBe("sandboxed")

		fireEvent.click(screen.getByRole("button", { name: "Run command elevated" }))
		await waitFor(() => expect(TaskServiceClient.askResponse).toHaveBeenCalledTimes(2))
		expect(decodeTerminalRunMode(vi.mocked(TaskServiceClient.askResponse).mock.calls[1][0].text)).toBe("elevated")
	})
})
