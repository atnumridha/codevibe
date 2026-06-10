import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PlatformType } from "@/config/platform.config"
import TerminalSettingsSection from "./TerminalSettingsSection"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		availableTerminalProfiles: [{ id: "default", name: "Default", description: "VS Code default terminal" }],
		compatibilityStatus: {
			sandboxPolicy: "prompt",
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
		expect(screen.getByText("Background execution with workspace sandbox policy.")).toBeInTheDocument()
		expect(screen.getByText("Trusted terminal command after manual approval.")).toBeInTheDocument()
		expect(screen.getByText("Current sandbox source: prompt.")).toBeInTheDocument()
	})
})
