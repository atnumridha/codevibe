import React from "react"
import { QuickWinTask } from "./quickWinTasks"

interface QuickWinCardProps {
	task: QuickWinTask
	onExecute: () => void
}

const renderIcon = (iconName?: string) => {
	if (!iconName) {
		return <span className="codicon codicon-sparkle text-[16px]! leading-none!"></span>
	}

	let iconClass = "codicon-sparkle"
	switch (iconName) {
		case "ReviewIcon":
			iconClass = "codicon-search"
			break
		case "PlanIcon":
			iconClass = "codicon-list-tree"
			break
		case "VerifyIcon":
			iconClass = "codicon-beaker"
			break
		default:
			break
	}
	return <span className={`codicon ${iconClass} text-[16px]! leading-none!`}></span>
}

const QuickWinCard: React.FC<QuickWinCardProps> = ({ task, onExecute }) => {
	return (
		<button
			className="group grid grid-cols-[28px_1fr_18px] items-center gap-3 rounded-md border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-3 py-2 text-left transition-colors duration-150 ease-in-out hover:bg-[var(--vscode-list-hoverBackground)]"
			onClick={onExecute}
			type="button">
			<div className="shrink-0 flex size-7 items-center justify-center rounded-sm bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-icon-foreground)]">
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
			<span className="codicon codicon-arrow-right text-[var(--vscode-descriptionForeground)] transition-transform group-hover:translate-x-0.5" />
		</button>
	)
}

export default QuickWinCard
