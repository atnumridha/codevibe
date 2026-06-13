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

	const heading = shouldShowStarterWorkflows
		? "Starter commands"
		: "Quick commands";
	const subtitle = shouldShowStarterWorkflows
		? "Choose a guided Codie start."
		: "Review, plan, verify, or open focus lanes.";

	return (
		<section className="select-none px-3 py-2">
			<div className="mb-2 flex items-center justify-between gap-2 border-b border-[color-mix(in_srgb,var(--vscode-panel-border)_70%,transparent)] pb-2">
				<div className="min-w-0">
					<h2 className="m-0 flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase leading-none text-[var(--vscode-descriptionForeground)]">
						<span className="codicon codicon-sparkle text-[13px]!" />
						<span className="truncate">{heading}</span>
					</h2>
					<p className="m-0 mt-1 truncate text-[11px] leading-tight text-[var(--vscode-descriptionForeground)]">
						{subtitle}
					</p>
				</div>
				<span
					aria-label={`${quickWinTasks.length} quick commands`}
					className="shrink-0 rounded-[3px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--vscode-descriptionForeground)]"
				>
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
