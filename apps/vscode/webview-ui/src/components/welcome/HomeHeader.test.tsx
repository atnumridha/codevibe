import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomeHeader from "./HomeHeader";

const grpcMocks = vi.hoisted(() => ({
	openNativeAgentSession: vi.fn(),
	openWalkthrough: vi.fn(),
}));

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		environment: "production",
	}),
}));

vi.mock("@/services/grpc-client", () => ({
	UiServiceClient: {
		openNativeAgentSession: grpcMocks.openNativeAgentSession,
		openWalkthrough: grpcMocks.openWalkthrough,
	},
}));

describe("HomeHeader", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("presents CodeVibe as the primary native chat agent surface", () => {
		render(<HomeHeader shouldShowStarterWorkflows={true} />);

		expect(
			screen.getByRole("heading", { name: "CodeVibe" }),
		).toBeInTheDocument();
		expect(screen.getByText("Ready")).toBeInTheDocument();
		expect(screen.getByText("Workspace command center")).toBeInTheDocument();
		expect(screen.getByText("Plan")).toBeInTheDocument();
		expect(screen.getByText("Act")).toBeInTheDocument();
		expect(screen.getByText("Review")).toBeInTheDocument();
		expect(screen.getByText("Ship")).toBeInTheDocument();
		expect(screen.getByText("Codex auth")).toBeInTheDocument();
		expect(screen.getByText("Plan graph")).toBeInTheDocument();
		expect(screen.getByText("Sandbox")).toBeInTheDocument();
		expect(screen.getByText("Agents")).toBeInTheDocument();
		expect(
			screen.getByText("Review diffs, inspect files, run checks"),
		).toBeInTheDocument();
		expect(screen.queryByText("Native agent first")).not.toBeInTheDocument();
	});

	it("opens the native CodeVibe agent session from the header action", async () => {
		const user = userEvent.setup();
		render(<HomeHeader />);

		await user.click(screen.getByTestId("open-native-agent-session"));

		expect(grpcMocks.openNativeAgentSession).toHaveBeenCalledTimes(1);
		expect(grpcMocks.openWalkthrough).not.toHaveBeenCalled();
	});
});
