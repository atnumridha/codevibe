import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PlatformType } from "@/config/platform.config"
import TerminalSettingsSection from "./TerminalSettingsSection"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		availableTerminalProfiles: [{ id: "default", name: "Default", description: "VS Code default terminal" }],
		compatibilityStatus: {
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
		},
		defaultTerminalProfile: "default",
		shellIntegrationTimeout: 5000,
		terminalOutputLineLimit: 500,
		terminalReuseEnabled: true,
		vscodeTerminalExecutionMode: "backgroundExec",
	}),
}))

vi.mock("@/context/PlatformContext", () => ({
	usePlatform: () => ({ type: PlatformType.VSCODE }),
}))

vi.mock("../../../services/grpc-client", () => ({
	StateServiceClient: {
		updateTerminalConnectionTimeout: vi.fn(),
	},
}))

vi.mock("../utils/settingsHandlers", () => ({
	updateSetting: vi.fn(),
}))

describe("TerminalSettingsSection", () => {
	it("surfaces sandboxed versus elevated command approval policy", () => {
		render(<TerminalSettingsSection renderSectionHeader={() => null} />)

		expect(screen.getByText("Terminal Approval Policy")).toBeInTheDocument()
		expect(screen.getByText("Sandboxed")).toBeInTheDocument()
		expect(screen.getByText("Elevated")).toBeInTheDocument()
		expect(screen.getByText("Active")).toBeInTheDocument()
		expect(screen.getByText("Background execution constrained by .cursor/sandbox.json.")).toBeInTheDocument()
		expect(screen.getByText("Trusted terminal command after manual approval.")).toBeInTheDocument()
		expect(
			screen.getByText(
				"Current sandbox source: prompt. Sandbox runtime: loaded; access: workspace; writable paths: 1; network: deny.",
			),
		).toBeInTheDocument()
	})
})
