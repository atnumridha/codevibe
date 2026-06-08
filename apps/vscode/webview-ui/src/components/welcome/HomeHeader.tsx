import { EmptyRequest } from "@shared/proto/cline/common"
import CodeVibeMark from "@/assets/CodeVibeMark"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { UiServiceClient } from "@/services/grpc-client"

interface HomeHeaderProps {
	shouldShowQuickWins?: boolean
}

const HomeHeader = ({ shouldShowQuickWins = false }: HomeHeaderProps) => {
	const { environment } = useExtensionState()

	const handleTakeATour = async () => {
		try {
			await UiServiceClient.openWalkthrough(EmptyRequest.create())
		} catch (error) {
			console.error("Error opening walkthrough:", error)
		}
	}

	return (
		<div className="px-5 pt-5 pb-4 mb-4 border-b border-[var(--vscode-panel-border)]">
			<div className="flex items-center gap-4">
				<div className="shrink-0 rounded-md border border-[var(--vscode-panel-border)] p-2 bg-[var(--vscode-editor-background)]">
					<CodeVibeMark className="size-14" environment={environment} />
				</div>
				<div className="min-w-0">
					<div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--vscode-descriptionForeground)]">
						CodeVibe Agent
					</div>
					<h1 className="m-0 mt-1 text-2xl font-semibold leading-tight text-[var(--vscode-foreground)]">
						What are we shipping?
					</h1>
					<p className="m-0 mt-2 text-sm leading-relaxed text-[var(--vscode-descriptionForeground)]">
						Plan the change, patch the workspace, and verify it without leaving VS Code.
					</p>
				</div>
			</div>
			<div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--vscode-descriptionForeground)]">
				<span className="rounded-md border border-[var(--vscode-panel-border)] px-2 py-1">Plan first</span>
				<span className="rounded-md border border-[var(--vscode-panel-border)] px-2 py-1">Apply diffs</span>
				<span className="rounded-md border border-[var(--vscode-panel-border)] px-2 py-1">Run checks</span>
			</div>
			{shouldShowQuickWins && (
				<div className="mt-4">
					<button
						className="flex items-center gap-2 px-3 py-2 rounded-md border border-border-panel bg-white/2 hover:bg-list-background-hover transition-colors duration-150 ease-in-out text-code-foreground text-sm font-medium cursor-pointer"
						onClick={handleTakeATour}
						type="button">
						Take a Tour
						<span className="codicon codicon-play scale-90" />
					</button>
				</div>
			)}
		</div>
	)
}

export default HomeHeader
