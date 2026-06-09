import React from "react"
import { ArrowRightIcon, ListChecksIcon, SearchIcon, ShieldCheckIcon, SparklesIcon } from "lucide-react"
import { QuickWinTask } from "./quickWinTasks"

interface QuickWinCardProps {
	task: QuickWinTask
	onExecute: () => void
}

const renderIcon = (iconName?: string) => {
	if (!iconName) {
		return <SparklesIcon className="size-4" />
	}

	switch (iconName) {
		case "ReviewIcon":
			return <SearchIcon className="size-4" />
		case "PlanIcon":
			return <ListChecksIcon className="size-4" />
		case "VerifyIcon":
			return <ShieldCheckIcon className="size-4" />
		default:
			break
	}
	return <SparklesIcon className="size-4" />
}

const QuickWinCard: React.FC<QuickWinCardProps> = ({ task, onExecute }) => {
	return (
		<button
			className="group grid grid-cols-[32px_1fr_18px] items-center gap-3 rounded-sm border border-[var(--vscode-panel-border)] border-l-codevibe/70 bg-[var(--vscode-editor-background)] px-3 py-2.5 text-left transition-colors duration-150 ease-in-out hover:border-codevibe/70 hover:bg-[var(--vscode-list-hoverBackground)]"
			onClick={onExecute}
			type="button">
			<div className="shrink-0 flex size-8 items-center justify-center rounded-sm border border-codevibe/30 bg-codevibe/10 text-codevibe">
				{renderIcon(task.icon)}
			</div>

			<div className="min-w-0">
				<h3 className="m-0 truncate text-sm font-medium leading-tight text-[var(--vscode-editor-foreground)]">
					{task.title}
				</h3>
				<p className="m-0 mt-1 truncate text-xs leading-tight text-[var(--vscode-descriptionForeground)]">
					{task.description}
				</p>
			</div>
			<ArrowRightIcon className="size-4 text-[var(--vscode-descriptionForeground)] transition-transform group-hover:translate-x-0.5" />
		</button>
	)
}

export default QuickWinCard
