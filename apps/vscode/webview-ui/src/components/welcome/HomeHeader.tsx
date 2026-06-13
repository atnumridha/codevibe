import { EmptyRequest } from "@shared/proto/cline/common";
import {
	ArrowRightIcon,
	BotIcon,
	CommandIcon,
	GitBranchIcon,
	MessageSquareIcon,
	RouteIcon,
	SearchIcon,
	ShieldCheckIcon,
	TerminalSquareIcon,
	WorkflowIcon,
} from "lucide-react";
import { UiServiceClient } from "@/services/grpc-client";

interface HomeHeaderProps {
	shouldShowStarterWorkflows?: boolean;
	onFocusComposer?: () => void;
}

const HomeHeader = ({
	shouldShowStarterWorkflows = false,
	onFocusComposer,
}: HomeHeaderProps) => {
	const handleOpenNativeChat = async () => {
		if (onFocusComposer) {
			onFocusComposer();
			return;
		}

		try {
			await UiServiceClient.openNativeAgentSession(EmptyRequest.create());
		} catch (error) {
			console.error("Error opening native agent:", error);
		}
	};

	const handleTakeATour = async () => {
		try {
			await UiServiceClient.openWalkthrough(EmptyRequest.create());
		} catch (error) {
			console.error("Error opening walkthrough:", error);
		}
	};

	const commandStages = [
		{
			label: "Plan",
			Icon: RouteIcon,
			className: "border-codevibe/35 bg-codevibe/10 text-codevibe",
		},
		{
			label: "Edit",
			Icon: WorkflowIcon,
			className:
				"border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_76%,transparent)] text-[var(--vscode-descriptionForeground)]",
		},
		{
			label: "Review",
			Icon: ShieldCheckIcon,
			className:
				"border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_76%,transparent)] text-[var(--vscode-descriptionForeground)]",
		},
		{
			label: "Ship",
			Icon: GitBranchIcon,
			className:
				"border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_76%,transparent)] text-[var(--vscode-descriptionForeground)]",
		},
	];

	return (
		<div className="codevibe-command-surface border-b border-[var(--vscode-panel-border)] px-3 pb-2.5 pt-3 shadow-[inset_0_-1px_0_color-mix(in_srgb,var(--vscode-editor-background)_62%,transparent)]">
			<div className="flex items-center justify-between gap-2.5">
				<div className="flex min-w-0 items-center gap-2.5">
					<div className="codevibe-mark-frame flex size-10 shrink-0 items-center justify-center rounded-[6px]">
						<BotIcon className="size-7 text-codevibe" />
					</div>
					<div className="min-w-0">
						<div className="flex min-w-0 items-center gap-1.5">
							<h1 className="m-0 truncate text-[15px] font-semibold leading-tight text-[var(--vscode-foreground)]">
								Codie
							</h1>
							<span className="inline-flex shrink-0 items-center gap-1 rounded-[3px] border border-[color-mix(in_srgb,var(--vscode-charts-green)_48%,transparent)] bg-[color-mix(in_srgb,var(--vscode-charts-green)_14%,transparent)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--vscode-charts-green)]">
								<span className="size-1.5 rounded-full bg-[var(--vscode-charts-green)]" />
								Ready
							</span>
						</div>
						<div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-tight text-[var(--vscode-descriptionForeground)]">
							<CommandIcon className="size-3.5 shrink-0 text-codevibe" />
							<span className="truncate">Agent command center</span>
						</div>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<button
						aria-label={onFocusComposer ? "Focus Codie composer" : "Open Codie chat"}
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
			<div className="mt-3 rounded-[6px] border border-[color-mix(in_srgb,var(--vscode-panel-border)_86%,transparent)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_60%,transparent)] p-2">
				<div className="flex min-w-0 items-center justify-between gap-2 text-[11px] leading-tight">
					<div className="flex min-w-0 items-center gap-1.5 font-medium text-[var(--vscode-foreground)]">
						<SearchIcon className="size-3.5 shrink-0 text-codevibe" />
						<span className="truncate">Ask, inspect, approve, continue</span>
					</div>
					<div className="flex shrink-0 items-center gap-1 rounded-[4px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)] px-1.5 py-0.5 text-[10px] font-medium uppercase leading-none text-[var(--vscode-descriptionForeground)]">
						<TerminalSquareIcon className="size-3 text-[var(--color-codevibe-warm)]" />
						<span>Workbench</span>
					</div>
				</div>
				<div className="mt-2 grid grid-cols-4 gap-1 text-[11px]">
					{commandStages.map(({ Icon, className, label }) => (
						<div
							className={`flex min-w-0 items-center justify-center gap-1.5 rounded-[4px] border px-1.5 py-1.5 ${className}`}
							key={label}
						>
							<Icon className="size-3.5 shrink-0" />
							<span className="truncate">{label}</span>
						</div>
					))}
				</div>
			</div>
			<div className="mt-2 grid grid-cols-3 gap-1.5 text-[10.5px] text-[var(--vscode-descriptionForeground)]">
				<div className="codevibe-status-chip">
					<SearchIcon className="size-3.5 shrink-0 text-codevibe" />
					<span className="truncate">Context</span>
				</div>
				<div className="codevibe-status-chip">
					<WorkflowIcon className="size-3.5 shrink-0 text-[var(--color-codevibe-warm)]" />
					<span className="truncate">Plans</span>
				</div>
				<div className="codevibe-status-chip">
					<ShieldCheckIcon className="size-3.5 shrink-0 text-[var(--vscode-charts-green)]" />
					<span className="truncate">Checks</span>
				</div>
			</div>
		</div>
	);
};

export default HomeHeader;
