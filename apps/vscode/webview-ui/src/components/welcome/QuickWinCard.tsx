import React from "react";
import {
	ArrowRightIcon,
	GitBranchIcon,
	KeyRoundIcon,
	ListChecksIcon,
	NetworkIcon,
	SearchIcon,
	ShieldCheckIcon,
	SparklesIcon,
	WorkflowIcon,
} from "lucide-react";
import { QuickWinTask } from "./quickWinTasks";

interface QuickWinCardProps {
	task: QuickWinTask;
	onExecute: () => void;
}

const renderIcon = (iconName?: string) => {
	if (!iconName) {
		return <SparklesIcon className="size-4" />;
	}

	switch (iconName) {
		case "ReviewIcon":
		case "SearchIcon":
			return <SearchIcon className="size-4" />;
		case "PlanIcon":
			return <ListChecksIcon className="size-4" />;
		case "VerifyIcon":
			return <ShieldCheckIcon className="size-4" />;
		case "DiagramIcon":
			return <WorkflowIcon className="size-4" />;
		case "AgentsIcon":
			return <NetworkIcon className="size-4" />;
		case "KeyIcon":
			return <KeyRoundIcon className="size-4" />;
		case "ShipIcon":
			return <GitBranchIcon className="size-4" />;
		default:
			break;
	}
	return <SparklesIcon className="size-4" />;
};

const QuickWinCard: React.FC<QuickWinCardProps> = ({ task, onExecute }) => {
	return (
		<button
			className="codevibe-focusable group grid min-h-[58px] grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[6px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-2.5 py-2 text-left transition-colors duration-150 ease-in-out hover:border-codevibe/70 hover:bg-[var(--vscode-list-hoverBackground)]"
			onClick={onExecute}
			type="button"
		>
			<div className="flex size-[30px] shrink-0 items-center justify-center rounded-[5px] border border-codevibe/30 bg-codevibe/10 text-codevibe transition-colors group-hover:bg-codevibe/20">
				{renderIcon(task.icon)}
			</div>

			<div className="min-w-0">
				<div className="flex min-w-0 items-center gap-1.5">
					<h3 className="m-0 truncate text-[13px] font-medium leading-tight text-[var(--vscode-editor-foreground)]">
						{task.title}
					</h3>
					{task.meta && (
						<span className="shrink-0 rounded-[3px] border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-sideBar-background)_80%,transparent)] px-1.5 py-0.5 text-[9.5px] font-medium uppercase leading-none text-[var(--vscode-descriptionForeground)]">
							{task.meta}
						</span>
					)}
				</div>
				<p className="m-0 mt-1 truncate text-[11.5px] leading-tight text-[var(--vscode-descriptionForeground)]">
					{task.description}
				</p>
			</div>
			<div className="flex h-7 min-w-7 items-center justify-center rounded-[4px] text-[var(--vscode-descriptionForeground)] transition-colors group-hover:bg-codevibe/10 group-hover:text-codevibe">
				<ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
			</div>
		</button>
	);
};

export default QuickWinCard;
