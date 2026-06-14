import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PlatformType } from "@/config/platform.config"
import TerminalSettingsSection from "./TerminalSettingsSection"

const extensionState = vi.hoisted(() => ({
	availableTerminalProfiles: [{ id: "default", name: "Default", description: "VS Code default terminal" }],
	compatibilityStatus: {
		sandboxPolicy: "prompt",
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
		},
	},
	defaultTerminalProfile: "default",
	shellIntegrationTimeout: 5000,
	terminalOutputLineLimit: 500,
	terminalReuseEnabled: true,
	vscodeTerminalExecutionMode: "backgroundExec",
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => extensionState,
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
	beforeEach(() => {
		extensionState.compatibilityStatus = {
			sandboxPolicy: "prompt",
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
			},
		}
	})

	it("surfaces sandboxed versus elevated command approval policy", () => {
		render(<TerminalSettingsSection renderSectionHeader={() => null} />)

		expect(screen.getByText("Terminal approval modes")).toBeInTheDocument()
		expect(screen.getByText("Sandboxed")).toBeInTheDocument()
		expect(screen.getByText("Unelevated")).toBeInTheDocument()
		expect(screen.getByText("Elevated")).toBeInTheDocument()
		expect(screen.getByText("Active")).toBeInTheDocument()
		expect(screen.getAllByText("Default").length).toBeGreaterThanOrEqual(1)
		expect(
			screen.getByText(
				"Codie checks commands against the active Codie sandbox configuration before sandboxed execution.",
			),
		).toBeInTheDocument()
		expect(
			screen.getByText(
				"Normal terminal mode with configured command permissions. Sandbox preflight still applies when active.",
			),
		).toBeInTheDocument()
		expect(
			screen.getByText(
				"Trusted terminal mode after manual approval. Bypasses Codie sandbox preflight; configured command permissions may still apply. Does not request OS administrator access.",
			),
		).toBeInTheDocument()
		expect(
			screen.getByText(
				"Configured sandbox setting: prompt. Sandbox runtime: loaded; access: workspace; writable paths: 1; network: deny; allow: 1; deny: 0.",
			),
		).toBeInTheDocument()
	})

	it("surfaces invalid sandbox configs as read-only fail-closed", () => {
		extensionState.compatibilityStatus = {
			sandboxPolicy: "workspace",
			sandboxRuntime: {
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
			},
		}

		render(<TerminalSettingsSection renderSectionHeader={() => null} />)

		expect(screen.getByText("Fail closed")).toBeInTheDocument()
		expect(
			screen.getByText(
				"The sandbox configuration is invalid, so Codie uses a read-only fail-closed policy until it is fixed.",
			),
		).toBeInTheDocument()
		expect(
			screen.getByText(
				"Configured sandbox setting: workspace. Sandbox runtime: invalid; access: readOnly; writable paths: 0; network: deny; allow: 0; deny: 0.",
			),
		).toBeInTheDocument()
		expect(screen.getByText("sandbox.json is invalid")).toBeInTheDocument()
	})
})
