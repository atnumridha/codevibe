import { BooleanRequest, EmptyRequest } from "@shared/proto/cline/common";
import {
	ArrowRightIcon,
	KeyRoundIcon,
	ShieldCheckIcon,
	WorkflowIcon,
} from "lucide-react";
import { memo, useEffect, useState } from "react";
import CodeVibeMark from "@/assets/CodeVibeMark";
import ApiOptions from "@/components/settings/ApiOptions";
import { useExtensionState } from "@/context/ExtensionStateContext";
import {
	AccountServiceClient,
	StateServiceClient,
} from "@/services/grpc-client";
import { validateApiConfiguration } from "@/utils/validate";

const WelcomeView = memo(() => {
	const { apiConfiguration, environment, mode } = useExtensionState();
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(
		undefined,
	);
	const [showApiOptions, setShowApiOptions] = useState(false);
	const [isLoading, setIsLoading] = useState(false);

	const disableLetsGoButton = apiErrorMessage != null;

	const handleLogin = () => {
		setIsLoading(true);
		AccountServiceClient.accountLoginClicked(EmptyRequest.create())
			.catch((err) => console.error("Failed to get login URL:", err))
			.finally(() => {
				setIsLoading(false);
			});
	};

	const handleSubmit = async () => {
		try {
			await StateServiceClient.setWelcomeViewCompleted(
				BooleanRequest.create({ value: true }),
			);
		} catch (error) {
			console.error(
				"Failed to update API configuration or complete welcome view:",
				error,
			);
		}
	};

	useEffect(() => {
		setApiErrorMessage(validateApiConfiguration(mode, apiConfiguration));
	}, [apiConfiguration, mode]);

	return (
		<div className="fixed inset-0 overflow-auto bg-[var(--vscode-sideBar-background)]">
			<div className="mx-auto flex min-h-full max-w-[560px] flex-col px-4 py-4">
				<div className="codevibe-command-surface rounded-[8px] border border-[var(--vscode-panel-border)] p-3 shadow-[0_10px_32px_color-mix(in_srgb,var(--vscode-widget-shadow)_24%,transparent)]">
					<div className="flex items-center gap-3">
						<div className="codevibe-mark-frame flex size-12 shrink-0 items-center justify-center rounded-[7px]">
							<CodeVibeMark className="size-8" environment={environment} />
						</div>
						<div className="min-w-0">
							<h2 className="m-0 truncate text-lg font-semibold leading-tight text-[var(--vscode-foreground)]">
								CodeVibe
							</h2>
							<div className="mt-1 truncate text-xs leading-tight text-[var(--vscode-descriptionForeground)]">
								Choose an account or provider to start.
							</div>
						</div>
					</div>

					<div className="mt-3 grid grid-cols-2 gap-1.5 text-[11px] text-[var(--vscode-descriptionForeground)]">
						<div className="codevibe-status-chip">
							<KeyRoundIcon className="size-3.5 shrink-0 text-codevibe" />
							<span className="truncate">Account</span>
						</div>
						<div className="codevibe-status-chip">
							<ShieldCheckIcon className="size-3.5 shrink-0 text-[var(--vscode-charts-green)]" />
							<span className="truncate">Approvals</span>
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
								<span className="truncate">Continue with account</span>
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

						{!showApiOptions && (
							<button
								aria-expanded={showApiOptions}
								className="codevibe-focusable flex h-9 w-full items-center justify-between gap-2 rounded-[5px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-3 text-left text-sm font-medium text-[var(--vscode-foreground)] transition-colors hover:bg-[var(--vscode-toolbar-hoverBackground)]"
								onClick={() => setShowApiOptions(!showApiOptions)}
								type="button"
							>
								<span className="flex min-w-0 items-center gap-2">
									<WorkflowIcon className="size-4 shrink-0 text-[var(--color-codevibe-warm)]" />
									<span className="truncate">Configure provider manually</span>
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
								Start CodeVibe
							</button>
						</div>
					)}
				</div>
			</div>
		</div>
	);
});

export default WelcomeView;
