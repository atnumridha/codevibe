import type { ClineMessage, CodeVibeCompatibilityStatus } from "@shared/ExtensionMessage"
import { COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import { appendTerminalRunModeMarker, decodeTerminalRunMode } from "@shared/terminalPolicy"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TaskServiceClient } from "@/services/grpc-client"
import { CommandOutputRow } from "./CommandOutputRow"

type SandboxRuntimeSummary = CodeVibeCompatibilityStatus["sandboxRuntime"]

const extensionState = vi.hoisted(() => ({
	compatibilityStatus: {
		sandboxRuntime: {
			status: "loaded",
			effectiveAccess: "workspace",
			readablePathCount: 2,
			writablePathCount: 1,
			networkDefault: "deny",
			networkAllowCount: 1,
			blockGitWrites: true,
			allowTerminalAutoApprove: true,
		} as SandboxRuntimeSummary,
	},
}))

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: {
		openFile: vi.fn(),
	},
	TaskServiceClient: {
		askResponse: vi.fn(),
	},
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => extensionState,
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

	beforeEach(() => {
		vi.clearAllMocks()
		extensionState.compatibilityStatus.sandboxRuntime = {
			status: "loaded",
			effectiveAccess: "workspace",
			readablePathCount: 2,
			writablePathCount: 1,
			networkDefault: "deny",
			networkAllowCount: 1,
			blockGitWrites: true,
			allowTerminalAutoApprove: true,
		}
	})

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
			screen.getByText("Sandbox active: workspace access, 1 writable path(s), network deny. Elevated commands require this explicit approval."),
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

	it("uses the default terminal approval path when no sandbox is active", async () => {
		extensionState.compatibilityStatus.sandboxRuntime = {
			status: "missing",
			effectiveAccess: "disabled",
			readablePathCount: 0,
			writablePathCount: 0,
			networkDefault: "deny",
			networkAllowCount: 0,
			blockGitWrites: false,
			allowTerminalAutoApprove: false,
		}
		vi.mocked(TaskServiceClient.askResponse).mockResolvedValue({})

		render(
			<CommandOutputRow
				isCommandPending={true}
				isOutputFullyExpanded={false}
				message={pendingCommand}
				setIsOutputFullyExpanded={() => undefined}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: "Run command with default terminal policy" }))

		await waitFor(() => expect(TaskServiceClient.askResponse).toHaveBeenCalledTimes(1))
		expect(screen.getByRole("button", { name: "Run command with default terminal policy" })).toHaveTextContent("Default")
		expect(decodeTerminalRunMode(vi.mocked(TaskServiceClient.askResponse).mock.calls[0][0].text)).toBe("default")
	})

	it("renders persisted run mode without leaking the hidden marker into the command", () => {
		const completedCommand: ClineMessage = {
			ts: 2,
			type: "say",
			say: "command",
			commandCompleted: true,
			text: appendTerminalRunModeMarker("npm test", "sandboxed"),
		}

		render(
			<CommandOutputRow
				isCommandCompleted={true}
				isOutputFullyExpanded={false}
				message={completedCommand}
				setIsOutputFullyExpanded={() => undefined}
			/>,
		)

		expect(screen.getByText("Sandboxed")).toBeInTheDocument()
		expect(screen.getByText((content) => content.includes("npm test") && content.includes("```shell"))).toBeInTheDocument()
		expect(screen.queryByText(/__codevibe_terminal_policy__/)).not.toBeInTheDocument()
	})
})
