import type { ClineMessage, CodeVibeCompatibilityStatus } from "@shared/ExtensionMessage"
import { COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import {
	appendTerminalRequestMarker,
	appendTerminalRunModeMarker,
	decodeTerminalApprovalPayload,
	type CodeVibeTerminalRunMode,
} from "@shared/terminalPolicy"
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
			configSource: "codie",
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
			configSource: "codie",
			readablePathCount: 2,
			writablePathCount: 1,
			networkDefault: "deny",
			networkAllowCount: 1,
			blockGitWrites: true,
			allowTerminalAutoApprove: true,
		}
	})

	it("renders explicit sandboxed, unelevated, and elevated approval actions", () => {
		render(
			<CommandOutputRow
				isCommandPending={true}
				isOutputFullyExpanded={false}
				message={pendingCommand}
				setIsOutputFullyExpanded={() => undefined}
			/>,
		)

		expect(screen.getByRole("button", { name: "Run command in sandbox" })).toHaveTextContent("Sandboxed")
		expect(screen.getByRole("button", { name: "Run command unelevated" })).toHaveTextContent("Unelevated")
		expect(screen.getByRole("button", { name: "Run command elevated" })).toHaveTextContent("Elevated")
		expect(
			screen.getByText(
				"Codie sandbox active: workspace access, 1 writable path, network deny, allow 1, deny 0. Unelevated uses normal terminal mode while configured command permissions and Codie sandbox preflight still apply. Elevated bypasses Codie sandbox preflight after explicit approval here; configured command permissions may still apply, and does not request OS administrator privileges.",
			),
		).toBeInTheDocument()
		expect(screen.getByText("Codie needs your approval before running this command.")).toBeInTheDocument()
	})

	it("sends explicit run-mode payloads for sandboxed, unelevated, and elevated approvals", async () => {
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
		expectApprovalPayload(0, "sandboxed")

		fireEvent.click(screen.getByRole("button", { name: "Run command unelevated" }))
		await waitFor(() => expect(TaskServiceClient.askResponse).toHaveBeenCalledTimes(2))
		expectApprovalPayload(1, "default")

		fireEvent.click(screen.getByRole("button", { name: "Run command elevated" }))
		await waitFor(() => expect(TaskServiceClient.askResponse).toHaveBeenCalledTimes(3))
		expectApprovalPayload(2, "elevated")
	})

	it("rejects command approvals without sending a run-mode payload", async () => {
		vi.mocked(TaskServiceClient.askResponse).mockResolvedValue({})
		render(
			<CommandOutputRow
				isCommandPending={true}
				isOutputFullyExpanded={false}
				message={pendingCommand}
				setIsOutputFullyExpanded={() => undefined}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: "Reject command" }))

		await waitFor(() => expect(TaskServiceClient.askResponse).toHaveBeenCalledTimes(1))
		const request = vi.mocked(TaskServiceClient.askResponse).mock.calls[0][0]
		expect(request.responseType).toBe("noButtonClicked")
		expect(request.text).toBe("")
		expect(decodeTerminalApprovalPayload(request.text)).toBeUndefined()
	})

	it("uses the default terminal approval path when no sandbox is active", async () => {
		extensionState.compatibilityStatus.sandboxRuntime = {
			status: "missing",
			effectiveAccess: "disabled",
			configSource: "none",
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
		expect(screen.getByRole("button", { name: "Run command with default terminal policy" })).toHaveTextContent(
			"Unelevated",
		)
		expect(
			screen.getByText(
				"No Codie sandbox config is active; default runs use current terminal permissions. Unelevated uses current terminal permissions and configured command permissions. No Codie sandbox preflight is active. Elevated records explicit trust for this command; configured command permissions may still apply, and does not request OS administrator privileges.",
			),
		).toBeInTheDocument()
		expectApprovalPayload(0, "default")
	})

	it("disables sandboxed execution when sandbox configs are invalid", async () => {
		extensionState.compatibilityStatus.sandboxRuntime = {
			status: "invalid",
			effectiveAccess: "readOnly",
			configSource: "codie",
			readablePathCount: 1,
			writablePathCount: 0,
			networkDefault: "deny",
			networkAllowCount: 0,
			blockGitWrites: true,
			allowTerminalAutoApprove: false,
			error: "sandbox.json is invalid",
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

		expect(screen.queryByRole("button", { name: "Run command in sandbox" })).not.toBeInTheDocument()
		const failClosedButton = screen.getByRole("button", {
			name: "Sandbox config is invalid; sandboxed execution is disabled",
		})
		expect(failClosedButton).toHaveTextContent(
			"Fail-closed",
		)
		expect(failClosedButton).toBeDisabled()
		expect(
			screen.getByText(
				"Codie sandbox config is invalid; sandboxed execution is disabled until it is fixed. Unelevated uses current terminal permissions and configured command permissions because no enforceable sandbox policy is active. Elevated records explicit trust for this command; configured command permissions may still apply, and does not request OS administrator privileges.",
			),
		).toBeInTheDocument()

		fireEvent.click(failClosedButton)
		expect(TaskServiceClient.askResponse).not.toHaveBeenCalled()

		fireEvent.click(screen.getByRole("button", { name: "Run command unelevated" }))
		await waitFor(() => expect(TaskServiceClient.askResponse).toHaveBeenCalledTimes(1))
		expectApprovalPayload(0, "default")
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

	it("renders requested terminal mode and prefix rule badges without leaking the hidden request marker", () => {
		const pendingCommandWithRequest: ClineMessage = {
			ts: 3,
			type: "ask",
			ask: "command",
			text: appendTerminalRequestMarker("npm run dev", {
				requestedTerminalRunMode: "elevated",
				prefixRule: ["npm", "run", "dev"],
			}),
		}

		render(
			<CommandOutputRow
				isCommandPending={true}
				isOutputFullyExpanded={false}
				message={pendingCommandWithRequest}
				setIsOutputFullyExpanded={() => undefined}
			/>,
		)

		expect(screen.getByText("Requested: Elevated")).toBeInTheDocument()
		expect(screen.getByText("Prefix: npm run dev")).toBeInTheDocument()
		expect(screen.getByText((content) => content.includes("npm run dev") && content.includes("```shell"))).toBeInTheDocument()
		expect(screen.queryByText(/__codevibe_terminal_request__/)).not.toBeInTheDocument()
	})
})

function expectApprovalPayload(callIndex: number, terminalRunMode: CodeVibeTerminalRunMode) {
	const request = vi.mocked(TaskServiceClient.askResponse).mock.calls[callIndex][0]

	expect(request.responseType).toBe("yesButtonClicked")
	expect(JSON.parse(request.text ?? "")).toMatchObject({
		kind: "codevibe.terminalApproval",
		version: 1,
		terminalRunMode,
	})
	expect(decodeTerminalApprovalPayload(request.text)).toBe(terminalRunMode)
}
