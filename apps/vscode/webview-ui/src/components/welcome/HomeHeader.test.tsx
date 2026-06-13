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

	it("presents Codie as the primary native chat agent surface", () => {
		render(<HomeHeader shouldShowStarterWorkflows={true} />);

		expect(
			screen.getByRole("heading", { name: "Codie" }),
		).toBeInTheDocument();
		expect(screen.getByText("Ready")).toBeInTheDocument();
		expect(screen.getByText("Agent command center")).toBeInTheDocument();
		expect(screen.getByText("Ask, inspect, approve, continue")).toBeInTheDocument();
		expect(screen.getByText("Workbench")).toBeInTheDocument();
		expect(screen.getByText("Plan")).toBeInTheDocument();
		expect(screen.getByText("Edit")).toBeInTheDocument();
		expect(screen.getByText("Review")).toBeInTheDocument();
		expect(screen.getByText("Ship")).toBeInTheDocument();
		expect(screen.getByText("Context")).toBeInTheDocument();
		expect(screen.getByText("Plans")).toBeInTheDocument();
		expect(screen.getByText("Checks")).toBeInTheDocument();
		expect(screen.queryByText("Native agent first")).not.toBeInTheDocument();
	});

	it("opens the native Codie agent session from the header action", async () => {
		const user = userEvent.setup();
		render(<HomeHeader />);

		await user.click(screen.getByTestId("open-native-agent-session"));

		expect(grpcMocks.openNativeAgentSession).toHaveBeenCalledTimes(1);
		expect(grpcMocks.openWalkthrough).not.toHaveBeenCalled();
	});

	it("focuses the existing composer from the chat welcome header when available", async () => {
		const user = userEvent.setup();
		const onFocusComposer = vi.fn();
		render(<HomeHeader onFocusComposer={onFocusComposer} />);

		await user.click(screen.getByRole("button", { name: "Focus Codie composer" }));

		expect(onFocusComposer).toHaveBeenCalledTimes(1);
		expect(grpcMocks.openNativeAgentSession).not.toHaveBeenCalled();
		expect(grpcMocks.openWalkthrough).not.toHaveBeenCalled();
	});
});
