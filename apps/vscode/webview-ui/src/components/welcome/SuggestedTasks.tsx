import { NewTaskRequest } from "@shared/proto/cline/task"
import React from "react"
import { TaskServiceClient } from "@/services/grpc-client"
import QuickWinCard from "./QuickWinCard"
import { QuickWinTask, quickWinTasks } from "./quickWinTasks"

export const SuggestedTasks: React.FC<{ shouldShowStarterWorkflows: boolean }> = ({ shouldShowStarterWorkflows }) => {
	const handleExecuteQuickWin = async (prompt: string) => {
		await TaskServiceClient.newTask(NewTaskRequest.create({ text: prompt, images: [] }))
	}

	if (!shouldShowStarterWorkflows) {
		return null
	}

	return (
		<div className="select-none px-4 pb-3 pt-2">
			<h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase text-[var(--vscode-descriptionForeground)]">
				<span className="codicon codicon-sparkle text-[13px]!" />
				<span>Start with CodeVibe</span>
			</h2>
			<div className="grid gap-2">
				{quickWinTasks.map((task: QuickWinTask) => (
					<QuickWinCard key={task.id} onExecute={() => handleExecuteQuickWin(task.prompt)} task={task} />
				))}
			</div>
		</div>
	)
}
