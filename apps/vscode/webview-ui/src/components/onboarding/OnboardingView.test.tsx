import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OnboardingView from "./OnboardingView";

const mocks = vi.hoisted(() => ({
	accountLoginClicked: vi.fn(),
	captureOnboardingProgress: vi.fn(),
	getLatestState: vi.fn(),
	handleFieldsChange: vi.fn(),
	hideAccount: vi.fn(),
	hideSettings: vi.fn(),
	openAiCodexSignIn: vi.fn(),
	refreshLatestState: vi.fn(),
	setShowWelcome: vi.fn(),
	setWelcomeViewCompleted: vi.fn(),
	useExtensionState: vi.fn(),
	useOnboardingModels: vi.fn(),
}));

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: mocks.useExtensionState,
}));

vi.mock("@/services/grpc-client", () => ({
	AccountServiceClient: {
		accountLoginClicked: mocks.accountLoginClicked,
		openAiCodexSignIn: mocks.openAiCodexSignIn,
	},
	StateServiceClient: {
		captureOnboardingProgress: mocks.captureOnboardingProgress,
		getLatestState: mocks.getLatestState,
		setWelcomeViewCompleted: mocks.setWelcomeViewCompleted,
	},
}));

vi.mock("../settings/utils/useApiConfigurationHandlers", () => ({
	useApiConfigurationHandlers: () => ({
		handleFieldsChange: mocks.handleFieldsChange,
	}),
}));

vi.mock("./useOnboardingModels", () => ({
	useOnboardingModels: mocks.useOnboardingModels,
}));

const onboardingModels = {
	models: [
		{
			badge: "Free",
			group: "free",
			id: "gpt-free",
			info: undefined,
			latency: 0,
			name: "GPT Free",
			score: 0,
		},
		{
			badge: "",
			group: "frontier",
			id: "gpt-frontier",
			info: undefined,
			latency: 0,
			name: "GPT Frontier",
			score: 0,
		},
	],
};

describe("OnboardingView auth completion", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.useOnboardingModels.mockReturnValue({
			status: "success",
			models: onboardingModels,
		});
		mocks.useExtensionState.mockReturnValue({
			compatibilityStatus: {
				openAiCodexAuthenticated: true,
			},
			environment: "production",
			hideAccount: mocks.hideAccount,
			hideSettings: mocks.hideSettings,
			openAiCodexIsAuthenticated: false,
			openRouterModels: {},
			refreshLatestState: mocks.refreshLatestState,
			setShowWelcome: mocks.setShowWelcome,
			welcomeViewCompleted: false,
		});
		mocks.getLatestState.mockResolvedValue({
			stateJson: JSON.stringify({
				compatibilityStatus: {
					openAiCodexAuthenticated: false,
				},
				openAiCodexIsAuthenticated: false,
				welcomeViewCompleted: false,
			}),
		});
		mocks.openAiCodexSignIn.mockResolvedValue({});
		mocks.refreshLatestState.mockResolvedValue(false);
		mocks.setWelcomeViewCompleted.mockResolvedValue({});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("dismisses onboarding when Codie sign-in has completed via compatibility state", async () => {
		render(<OnboardingView />);

		await waitFor(() => {
			expect(mocks.setShowWelcome).toHaveBeenCalledWith(false);
		});
		expect(mocks.hideAccount).toHaveBeenCalledTimes(1);
		expect(mocks.hideSettings).toHaveBeenCalledTimes(1);
		expect(mocks.setWelcomeViewCompleted).toHaveBeenCalledWith({ value: true });
		expect(mocks.captureOnboardingProgress).toHaveBeenCalledWith({
			action: "onboarding_completed",
			completed: true,
			modelSelected: undefined,
			step: 0,
		});
	});

	it("dismisses onboarding when the latest state reports Codie sign-in before the sign-in RPC resolves", async () => {
		mocks.useExtensionState.mockReturnValue({
			compatibilityStatus: {
				openAiCodexAuthenticated: false,
			},
			environment: "production",
			hideAccount: mocks.hideAccount,
			hideSettings: mocks.hideSettings,
			openAiCodexIsAuthenticated: false,
			openRouterModels: {},
			refreshLatestState: mocks.refreshLatestState,
			setShowWelcome: mocks.setShowWelcome,
			welcomeViewCompleted: false,
		});
		mocks.openAiCodexSignIn.mockReturnValue(new Promise(() => {}));
		mocks.getLatestState.mockResolvedValue({
			stateJson: JSON.stringify({
				compatibilityStatus: {
					openAiCodexAuthenticated: false,
				},
				openAiCodexIsAuthenticated: true,
				welcomeViewCompleted: false,
			}),
		});

		render(<OnboardingView />);
		fireEvent.click(
			screen.getByRole("button", { name: "Sign in to Codie" }),
		);

		await waitFor(() => {
			expect(mocks.setShowWelcome).toHaveBeenCalledWith(false);
		});
		expect(mocks.getLatestState).toHaveBeenCalled();
		expect(mocks.refreshLatestState).not.toHaveBeenCalled();
		expect(mocks.openAiCodexSignIn).toHaveBeenCalledWith({});
	});

	it("checks latest state after the sign-in RPC resolves before completing onboarding", async () => {
		mocks.useExtensionState.mockReturnValue({
			compatibilityStatus: {
				openAiCodexAuthenticated: false,
			},
			environment: "production",
			hideAccount: mocks.hideAccount,
			hideSettings: mocks.hideSettings,
			openAiCodexIsAuthenticated: false,
			openRouterModels: {},
			refreshLatestState: mocks.refreshLatestState,
			setShowWelcome: mocks.setShowWelcome,
			welcomeViewCompleted: false,
		});
		let resolveSignIn: (() => void) | undefined;
		mocks.openAiCodexSignIn.mockReturnValue(
			new Promise<void>((resolve) => {
				resolveSignIn = resolve;
			}),
		);
		mocks.getLatestState.mockResolvedValue({
			stateJson: JSON.stringify({
				compatibilityStatus: {
					openAiCodexAuthenticated: false,
				},
				openAiCodexIsAuthenticated: false,
				welcomeViewCompleted: false,
			}),
		});

		render(<OnboardingView />);
		fireEvent.click(
			screen.getByRole("button", { name: "Sign in to Codie" }),
		);

		await waitFor(() => {
			expect(mocks.openAiCodexSignIn).toHaveBeenCalledWith({});
		});
		expect(mocks.setShowWelcome).not.toHaveBeenCalled();

		mocks.getLatestState.mockResolvedValue({
			stateJson: JSON.stringify({
				compatibilityStatus: {
					openAiCodexAuthenticated: false,
				},
				openAiCodexIsAuthenticated: true,
				welcomeViewCompleted: false,
			}),
		});
		resolveSignIn?.();

		await waitFor(() => {
			expect(mocks.setShowWelcome).toHaveBeenCalledWith(false);
		});
		expect(mocks.getLatestState).toHaveBeenCalled();
		expect(mocks.setWelcomeViewCompleted).toHaveBeenCalledWith({ value: true });
	});

	it("keeps a footer recovery action available immediately when the sign-in RPC is still pending", async () => {
		mocks.useExtensionState.mockReturnValue({
			compatibilityStatus: {
				openAiCodexAuthenticated: false,
			},
			environment: "production",
			hideAccount: mocks.hideAccount,
			hideSettings: mocks.hideSettings,
			openAiCodexIsAuthenticated: false,
			openRouterModels: {},
			refreshLatestState: mocks.refreshLatestState,
			setShowWelcome: mocks.setShowWelcome,
			welcomeViewCompleted: false,
		});
		mocks.openAiCodexSignIn.mockReturnValue(new Promise(() => {}));
		mocks.getLatestState.mockResolvedValue({
			stateJson: JSON.stringify({
				compatibilityStatus: {
					openAiCodexAuthenticated: false,
				},
				openAiCodexIsAuthenticated: false,
				welcomeViewCompleted: false,
			}),
		});

		render(<OnboardingView />);
		await act(async () => {
			fireEvent.click(
				screen.getByRole("button", { name: "Sign in to Codie" }),
			);
		});
		expect(screen.getByText("Almost there!")).toBeInTheDocument();

		const continueButton = screen.getByRole("button", {
			name: "Continue to Codie",
		});
		expect(continueButton).toBeEnabled();

		mocks.getLatestState.mockResolvedValue({
			stateJson: JSON.stringify({
				compatibilityStatus: {
					openAiCodexAuthenticated: true,
				},
				openAiCodexIsAuthenticated: true,
				welcomeViewCompleted: true,
			}),
		});
		await act(async () => {
			fireEvent.click(continueButton);
			await Promise.resolve();
		});

		expect(mocks.setShowWelcome).toHaveBeenCalledWith(false);
		expect(mocks.setWelcomeViewCompleted).toHaveBeenCalledWith({ value: true });
	});
});
