import { NewTaskRequest } from "@shared/proto/cline/task";
import React from "react";
import { TaskServiceClient } from "@/services/grpc-client";
import QuickWinCard from "./QuickWinCard";
import { QuickWinTask, quickWinTasks } from "./quickWinTasks";

export const SuggestedTasks: React.FC<{
	shouldShowStarterWorkflows: boolean;
}> = ({ shouldShowStarterWorkflows }) => {
	const handleExecuteQuickWin = async (prompt: string) => {
		await TaskServiceClient.newTask(
			NewTaskRequest.create({ text: prompt, images: [] }),
		);
	};

	if (!shouldShowStarterWorkflows) {
		return null;
	}

	return (
		<section className="select-none border-t border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-sideBar-background)_88%,var(--vscode-editor-background)_12%)] px-3 pb-3 pt-2.5">
			<div className="mb-2 flex items-center justify-between gap-2">
				<h2 className="m-0 flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase leading-none text-[var(--vscode-descriptionForeground)]">
					<span className="codicon codicon-sparkle text-[13px]!" />
					<span className="truncate">Suggested commands</span>
				</h2>
				<span className="rounded-[3px] border border-[var(--vscode-panel-border)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--vscode-descriptionForeground)]">
					{quickWinTasks.length}
				</span>
			</div>
			<div className="grid gap-1.5">
				{quickWinTasks.map((task: QuickWinTask) => (
					<QuickWinCard
						key={task.id}
						onExecute={() => handleExecuteQuickWin(task.prompt)}
						task={task}
					/>
				))}
			</div>
		</section>
	);
};
