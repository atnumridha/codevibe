import { EmptyRequest } from "@shared/proto/cline/common";
import {
	ArrowRightIcon,
	GitBranchIcon,
	KeyRoundIcon,
	MessageSquareIcon,
	NetworkIcon,
	RouteIcon,
	SearchIcon,
	ShieldCheckIcon,
	WorkflowIcon,
} from "lucide-react";
import CodeVibeMark from "@/assets/CodeVibeMark";
import { useExtensionState } from "@/context/ExtensionStateContext";
import { UiServiceClient } from "@/services/grpc-client";

interface HomeHeaderProps {
	shouldShowStarterWorkflows?: boolean;
}

const HomeHeader = ({
	shouldShowStarterWorkflows = false,
}: HomeHeaderProps) => {
	const { environment } = useExtensionState();

	const handleOpenNativeChat = async () => {
		try {
			await UiServiceClient.openNativeAgentSession(EmptyRequest.create());
		} catch (error) {
			console.error("Error opening native CodeVibe agent:", error);
		}
	};

	const handleTakeATour = async () => {
		try {
			await UiServiceClient.openWalkthrough(EmptyRequest.create());
		} catch (error) {
			console.error("Error opening walkthrough:", error);
		}
	};

	return (
		<div className="codevibe-command-surface border-b border-[var(--vscode-panel-border)] px-3 pb-3 pt-3">
			<div className="flex items-center justify-between gap-2.5">
				<div className="flex min-w-0 items-center gap-2.5">
					<div className="codevibe-mark-frame flex size-10 shrink-0 items-center justify-center rounded-[6px]">
						<CodeVibeMark className="size-7" environment={environment} />
					</div>
					<div className="min-w-0">
						<div className="flex min-w-0 items-center gap-1.5">
							<h1 className="m-0 truncate text-[15px] font-semibold leading-tight text-[var(--vscode-foreground)]">
								CodeVibe
							</h1>
							<span className="inline-flex shrink-0 items-center gap-1 rounded-[3px] border border-[color-mix(in_srgb,var(--vscode-charts-green)_48%,transparent)] bg-[color-mix(in_srgb,var(--vscode-charts-green)_14%,transparent)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--vscode-charts-green)]">
								<span className="size-1.5 rounded-full bg-[var(--vscode-charts-green)]" />
								Ready
							</span>
						</div>
						<div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-tight text-[var(--vscode-descriptionForeground)]">
							<span className="codicon codicon-terminal text-[12px]!" />
							<span className="truncate">Workspace command center</span>
						</div>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<button
						aria-label="Open CodeVibe Chat"
						className="codevibe-focusable flex h-8 shrink-0 items-center gap-1.5 rounded-[5px] border border-codevibe/50 bg-codevibe/10 px-2.5 text-xs font-medium text-codevibe transition-colors hover:border-codevibe/80 hover:bg-codevibe/20"
						data-testid="open-native-agent-session"
						onClick={handleOpenNativeChat}
						type="button"
					>
						<MessageSquareIcon className="size-4" />
						<span>Chat</span>
					</button>
					{shouldShowStarterWorkflows && (
						<button
							aria-label="Open walkthrough"
							className="codevibe-focusable flex size-8 shrink-0 items-center justify-center rounded-[5px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] text-[var(--vscode-icon-foreground)] transition-colors hover:bg-[var(--vscode-toolbar-hoverBackground)]"
							onClick={handleTakeATour}
							type="button"
						>
							<ArrowRightIcon className="size-4" />
						</button>
					)}
				</div>
			</div>
			<div className="mt-3 grid grid-cols-4 gap-1 text-[11px] text-[var(--vscode-descriptionForeground)]">
				<div className="flex min-w-0 items-center justify-center gap-1.5 rounded-[4px] border border-codevibe/30 bg-codevibe/10 px-1.5 py-1.5 text-codevibe">
					<RouteIcon className="size-3.5 shrink-0" />
					<span className="truncate">Plan</span>
				</div>
				<div className="flex min-w-0 items-center justify-center gap-1.5 rounded-[4px] border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_72%,transparent)] px-1.5 py-1.5">
					<MessageSquareIcon className="size-3.5 shrink-0" />
					<span className="truncate">Act</span>
				</div>
				<div className="flex min-w-0 items-center justify-center gap-1.5 rounded-[4px] border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_72%,transparent)] px-1.5 py-1.5">
					<ShieldCheckIcon className="size-3.5 shrink-0" />
					<span className="truncate">Review</span>
				</div>
				<div className="flex min-w-0 items-center justify-center gap-1.5 rounded-[4px] border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_72%,transparent)] px-1.5 py-1.5">
					<GitBranchIcon className="size-3.5 shrink-0" />
					<span className="truncate">Ship</span>
				</div>
			</div>
			<div className="mt-2 grid grid-cols-2 gap-1.5 text-[10.5px] text-[var(--vscode-descriptionForeground)]">
				<div className="codevibe-status-chip">
					<KeyRoundIcon className="size-3.5 shrink-0 text-codevibe" />
					<span className="truncate">Codex auth</span>
				</div>
				<div className="codevibe-status-chip">
					<WorkflowIcon className="size-3.5 shrink-0 text-[var(--color-codevibe-warm)]" />
					<span className="truncate">Plan graph</span>
				</div>
				<div className="codevibe-status-chip">
					<ShieldCheckIcon className="size-3.5 shrink-0 text-[var(--vscode-charts-green)]" />
					<span className="truncate">Sandbox</span>
				</div>
				<div className="codevibe-status-chip">
					<NetworkIcon className="size-3.5 shrink-0 text-[var(--vscode-charts-purple,var(--color-codevibe-alt))]" />
					<span className="truncate">Agents</span>
				</div>
			</div>
			<div className="mt-2 flex min-w-0 items-center gap-1.5 border-t border-[color-mix(in_srgb,var(--vscode-panel-border)_70%,transparent)] pt-2 text-[10.5px] text-[var(--vscode-descriptionForeground)]">
				<SearchIcon className="size-3.5 shrink-0 text-[var(--vscode-icon-foreground)]" />
				<span className="truncate">
					Review diffs, inspect files, run checks
				</span>
			</div>
		</div>
	);
};

export default HomeHeader;
