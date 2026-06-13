import { BooleanRequest, EmptyRequest } from "@shared/proto/cline/common";
import {
	ArrowRightIcon,
	BotIcon,
	KeyRoundIcon,
	ShieldCheckIcon,
	TerminalSquareIcon,
	WorkflowIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import ApiOptions from "@/components/settings/ApiOptions";
import { useExtensionState } from "@/context/ExtensionStateContext";
import {
	AccountServiceClient,
	StateServiceClient,
} from "@/services/grpc-client";
import { validateApiConfiguration } from "@/utils/validate";

const AUTH_CONTINUE_FALLBACK_DELAY_MS = 8_000;
const AUTH_STATE_POLL_INTERVAL_MS = 1_500;
const AUTH_INCOMPLETE_MESSAGE =
	"Still waiting for Codie sign-in. Complete the browser flow, then try again.";

function hasCompletedCodexAuthState(stateJson?: string): boolean {
	if (!stateJson) {
		return false;
	}

	try {
		const state = JSON.parse(stateJson) as {
			welcomeViewCompleted?: boolean;
			openAiCodexIsAuthenticated?: boolean;
			compatibilityStatus?: { openAiCodexAuthenticated?: boolean };
		};
		return Boolean(
			state.welcomeViewCompleted ||
				state.openAiCodexIsAuthenticated ||
				state.compatibilityStatus?.openAiCodexAuthenticated,
		);
	} catch {
		return false;
	}
}

const WelcomeView = memo(() => {
	const {
		apiConfiguration,
		compatibilityStatus,
		mode,
		openAiCodexIsAuthenticated,
		setShowWelcome,
		welcomeViewCompleted,
	} = useExtensionState();
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(
		undefined,
	);
	const [showApiOptions, setShowApiOptions] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [showAuthContinueFallback, setShowAuthContinueFallback] =
		useState(false);

	const disableLetsGoButton = apiErrorMessage != null;
	const hasCompletedAuth = Boolean(
		welcomeViewCompleted ||
			openAiCodexIsAuthenticated ||
			compatibilityStatus?.openAiCodexAuthenticated,
	);

	const persistWelcomeCompleted = useCallback(() => {
		void StateServiceClient.setWelcomeViewCompleted(
			BooleanRequest.create({ value: true }),
		).catch((error) => {
			console.error("Failed to persist completed welcome state:", error);
		});
	}, []);

	const completeWelcome = useCallback(() => {
		setShowWelcome(false);
		persistWelcomeCompleted();
	}, [persistWelcomeCompleted, setShowWelcome]);

	const refreshAuthCompletionFromState = useCallback(async () => {
		const latestState = await StateServiceClient.getLatestState(
			EmptyRequest.create(),
		);
		return hasCompletedCodexAuthState(latestState.stateJson);
	}, []);

	const handleLogin = () => {
		setIsLoading(true);
		AccountServiceClient.openAiCodexSignIn(EmptyRequest.create())
			.then(() => completeWelcome())
			.catch((err) => {
				return refreshAuthCompletionFromState()
					.then((hasCompletedAuth) => {
						if (hasCompletedAuth) {
							completeWelcome();
							return;
						}
						console.error("Failed to start Codie sign-in:", err);
					})
					.catch(() => console.error("Failed to start Codie sign-in:", err));
			})
			.finally(() => {
				setIsLoading(false);
			});
	};

	const handleSubmit = async () => {
		setShowWelcome(false);
		persistWelcomeCompleted();
	};

	useEffect(() => {
		setApiErrorMessage(validateApiConfiguration(mode, apiConfiguration));
	}, [apiConfiguration, mode]);

	useEffect(() => {
		if (hasCompletedAuth) {
			completeWelcome();
		}
	}, [completeWelcome, hasCompletedAuth]);

	useEffect(() => {
		if (!isLoading) {
			setShowAuthContinueFallback(false);
			return;
		}

		const fallbackTimer = window.setTimeout(() => {
			setShowAuthContinueFallback(true);
		}, AUTH_CONTINUE_FALLBACK_DELAY_MS);

		return () => window.clearTimeout(fallbackTimer);
	}, [isLoading]);

	useEffect(() => {
		if (!isLoading) {
			return;
		}

		let disposed = false;
		const completeIfReady = async () => {
			try {
				if (
					!disposed &&
					(hasCompletedAuth || (await refreshAuthCompletionFromState()))
				) {
					completeWelcome();
				}
			} catch {
				// Keep the visible recovery button available if a transient state read fails.
			}
		};

		void completeIfReady();
		const interval = window.setInterval(
			() => void completeIfReady(),
			AUTH_STATE_POLL_INTERVAL_MS,
		);

		return () => {
			disposed = true;
			window.clearInterval(interval);
		};
	}, [completeWelcome, hasCompletedAuth, isLoading, refreshAuthCompletionFromState]);

	return (
		<div className="fixed inset-0 overflow-auto bg-[var(--vscode-sideBar-background)]">
			<div className="mx-auto flex min-h-full max-w-[520px] flex-col justify-center px-4 py-6">
				<div className="codevibe-command-surface rounded-[8px] border border-[var(--vscode-panel-border)] p-3 shadow-[0_10px_32px_color-mix(in_srgb,var(--vscode-widget-shadow)_24%,transparent)]">
					<div className="flex items-center gap-3">
						<div className="codevibe-mark-frame flex size-12 shrink-0 items-center justify-center rounded-[7px]">
							<BotIcon className="size-8 text-codevibe" />
						</div>
						<div className="min-w-0">
							<h2 className="m-0 truncate text-lg font-semibold leading-tight text-[var(--vscode-foreground)]">
								Codie
							</h2>
							<div className="mt-1 truncate text-xs leading-tight text-[var(--vscode-descriptionForeground)]">
								Choose a model source to run Codie in this workspace.
							</div>
						</div>
					</div>

					<div className="mt-3 grid grid-cols-2 gap-1.5 text-[11px] text-[var(--vscode-descriptionForeground)]">
						<div className="codevibe-status-chip">
							<KeyRoundIcon className="size-3.5 shrink-0 text-codevibe" />
							<span className="truncate">Account connection</span>
						</div>
						<div className="codevibe-status-chip">
							<WorkflowIcon className="size-3.5 shrink-0 text-[var(--color-codevibe-warm)]" />
							<span className="truncate">Model source</span>
						</div>
						<div className="codevibe-status-chip">
							<ShieldCheckIcon className="size-3.5 shrink-0 text-[var(--vscode-charts-green)]" />
							<span className="truncate">Approvals</span>
						</div>
						<div className="codevibe-status-chip">
							<TerminalSquareIcon className="size-3.5 shrink-0 text-[var(--vscode-icon-foreground)]" />
							<span className="truncate">Terminal</span>
						</div>
					</div>

					<div className="mt-4 grid gap-2">
						<button
							className="codevibe-focusable flex h-9 w-full items-center justify-between gap-2 rounded-[5px] border border-codevibe/70 bg-codevibe px-3 text-left text-sm font-medium text-white transition-colors hover:bg-[color-mix(in_srgb,var(--color-codevibe)_86%,white_14%)] disabled:cursor-not-allowed disabled:opacity-60"
							disabled={isLoading}
							onClick={handleLogin}
							type="button"
						>
							<span className="flex min-w-0 items-center gap-2">
								<KeyRoundIcon className="size-4 shrink-0" />
								<span className="truncate">Connect Codie</span>
							</span>
							{isLoading ? (
								<span
									aria-label="Loading"
									className="codicon codicon-refresh animate-spin text-[14px]!"
								/>
							) : (
								<ArrowRightIcon className="size-4 shrink-0" />
							)}
						</button>

						{showAuthContinueFallback && (
							<>
								<div className="text-xs leading-snug text-[var(--vscode-descriptionForeground)]">
									If your browser says sign-in succeeded, continue to Codie.
								</div>
								<button
									className="codevibe-focusable flex h-9 w-full items-center justify-center gap-2 rounded-[5px] border border-[var(--vscode-button-border,transparent)] bg-[var(--vscode-button-background)] px-3 text-sm font-medium text-[var(--vscode-button-foreground)] transition-colors hover:bg-[var(--vscode-button-hoverBackground)]"
									onClick={() => {
										refreshAuthCompletionFromState()
											.then((hasCompletedAuth) => {
												if (!hasCompletedAuth) {
													throw new Error(
														AUTH_INCOMPLETE_MESSAGE,
													);
												}
												completeWelcome();
											})
											.catch((err) =>
												console.error("Failed to complete welcome after Codie sign-in:", err),
											);
									}}
									type="button"
								>
									Continue to Codie
								</button>
							</>
						)}

						{!showApiOptions && (
							<button
								aria-expanded={showApiOptions}
								className="codevibe-focusable flex h-9 w-full items-center justify-between gap-2 rounded-[5px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-3 text-left text-sm font-medium text-[var(--vscode-foreground)] transition-colors hover:bg-[var(--vscode-toolbar-hoverBackground)]"
								onClick={() => setShowApiOptions(!showApiOptions)}
								type="button"
							>
								<span className="flex min-w-0 items-center gap-2">
									<WorkflowIcon className="size-4 shrink-0 text-[var(--color-codevibe-warm)]" />
									<span className="truncate">Use another model source</span>
								</span>
								<ArrowRightIcon className="size-4 shrink-0 text-[var(--vscode-descriptionForeground)]" />
							</button>
						)}
					</div>

					{showApiOptions && (
						<div className="mt-3 border-t border-[var(--vscode-panel-border)] pt-3">
							<ApiOptions currentMode={mode} showModelOptions={false} />
							{apiErrorMessage && (
								<div className="mt-2 rounded-[5px] border border-[var(--vscode-inputValidation-warningBorder,var(--vscode-panel-border))] bg-[var(--vscode-inputValidation-warningBackground,transparent)] px-2 py-1.5 text-xs text-[var(--vscode-inputValidation-warningForeground,var(--vscode-descriptionForeground))]">
									{apiErrorMessage}
								</div>
							)}
							<button
								className="codevibe-focusable mt-2 flex h-8 w-full items-center justify-center gap-2 rounded-[5px] border border-[var(--vscode-button-border,transparent)] bg-[var(--vscode-button-background)] px-3 text-sm font-medium text-[var(--vscode-button-foreground)] transition-colors hover:bg-[var(--vscode-button-hoverBackground)] disabled:cursor-not-allowed disabled:opacity-55"
								disabled={disableLetsGoButton}
								onClick={handleSubmit}
								type="button"
							>
								<ShieldCheckIcon className="size-4" />
								Start Codie
							</button>
						</div>
					)}
				</div>
			</div>
		</div>
	);
});

export default WelcomeView;
