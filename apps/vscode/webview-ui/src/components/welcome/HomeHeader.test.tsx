import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import HomeHeader from "./HomeHeader"

const grpcMocks = vi.hoisted(() => ({
	openNativeAgentSession: vi.fn(),
	openWalkthrough: vi.fn(),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		environment: "production",
	}),
}))

vi.mock("@/services/grpc-client", () => ({
	UiServiceClient: {
		openNativeAgentSession: grpcMocks.openNativeAgentSession,
		openWalkthrough: grpcMocks.openWalkthrough,
	},
}))

describe("HomeHeader", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("presents CodeVibe as the primary native chat agent surface", () => {
		render(<HomeHeader shouldShowStarterWorkflows={true} />)

		expect(screen.getByText("CodeVibe Agent")).toBeInTheDocument()
		expect(screen.getByText("Codex-first coding workspace")).toBeInTheDocument()
		expect(screen.getByText("VS Code Chat first")).toBeInTheDocument()
		expect(screen.getByText("Codex auth")).toBeInTheDocument()
		expect(screen.queryByText("Native agent first")).not.toBeInTheDocument()
	})

	it("opens the native CodeVibe agent session from the header action", async () => {
		const user = userEvent.setup()
		render(<HomeHeader />)

		await user.click(screen.getByTestId("open-native-agent-session"))

		expect(grpcMocks.openNativeAgentSession).toHaveBeenCalledTimes(1)
		expect(grpcMocks.openWalkthrough).not.toHaveBeenCalled()
	})
})
