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
		<div className="px-5 pt-1 pb-3 select-none">
			<h2 className="text-[11px] font-semibold mb-2 uppercase tracking-[0.14em] text-[var(--vscode-descriptionForeground)]">
				Starter workflows
			</h2>
			<div className="grid gap-2">
				{quickWinTasks.map((task: QuickWinTask) => (
					<QuickWinCard key={task.id} onExecute={() => handleExecuteQuickWin(task.prompt)} task={task} />
				))}
			</div>
		</div>
	)
}
