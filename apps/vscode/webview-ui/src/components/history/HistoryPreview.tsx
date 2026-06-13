import { StringRequest } from "@shared/proto/cline/common"
import { memo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"

type HistoryPreviewProps = {
	showHistoryView: () => void
}

const HistoryPreview = ({ showHistoryView }: HistoryPreviewProps) => {
	const { taskHistory } = useExtensionState()
	const validHistory = taskHistory.filter((item) => item.ts && item.task)
	const handleHistorySelect = (id: string) => {
		TaskServiceClient.showTaskWithId(StringRequest.create({ value: id })).catch((error) =>
			console.error("Error showing task:", error),
		)
	}

	const formatDate = (timestamp: number) => {
		const date = new Date(timestamp)
		return date?.toLocaleString("en-US", {
			month: "short",
			day: "numeric",
		})
	}

	return (
		<div className="shrink-0">
			<div className="mb-2 mt-3 flex items-center justify-between px-4 text-[var(--vscode-descriptionForeground)]">
				<div className="flex min-w-0 items-center gap-1.5">
					<span className="codicon codicon-comment-discussion text-[13px]!" />
					<span className="truncate text-[11px] font-semibold uppercase">Latest runs</span>
				</div>
				{validHistory.length > 0 && (
					<button
						aria-label="View all history"
						className="flex items-center gap-1 border-0 bg-transparent p-0 text-[11px] font-medium text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]"
						onClick={() => showHistoryView()}
						type="button">
						<span>View all</span>
						<span className="codicon codicon-chevron-right text-[13px]!" />
					</button>
				)}
			</div>

			<div className="px-4">
				{validHistory.length > 0 ? (
					<div className="overflow-hidden rounded border border-[var(--vscode-panel-border)]">
						{validHistory.slice(0, 4).map((item, index) => (
							<button
								className={`grid w-full grid-cols-[18px_1fr_auto] items-center gap-2 border-0 bg-[var(--vscode-editor-background)] px-2.5 py-2 text-left hover:bg-[var(--vscode-list-hoverBackground)] ${
									index > 0 ? "border-t border-[var(--vscode-panel-border)]" : ""
								}`}
								key={item.id}
								onClick={() => handleHistorySelect(item.id)}
								type="button">
								<span
									aria-label={item.isFavorited ? "Favorited run" : "Codie run"}
									className={`codicon ${
										item.isFavorited ? "codicon-star-full" : "codicon-chevron-right"
									} text-[13px]! text-[var(--vscode-descriptionForeground)]`}
								/>
								<span className="min-w-0">
									<span className="ph-no-capture block truncate text-sm font-medium text-[var(--vscode-foreground)]">
										{item.task}
									</span>
								</span>
								<span className="whitespace-nowrap text-[11px] text-[var(--vscode-descriptionForeground)]">
									{formatDate(item.ts)}
									{item.totalCost != null ? ` / $${item.totalCost.toFixed(2)}` : ""}
								</span>
							</button>
						))}
					</div>
				) : (
					<div className="rounded border border-[var(--vscode-panel-border)] px-3 py-4 text-center text-sm text-[var(--vscode-descriptionForeground)]">
						No recent runs
					</div>
				)}
			</div>
		</div>
	)
}

export default memo(HistoryPreview)
