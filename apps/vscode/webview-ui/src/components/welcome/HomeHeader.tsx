import { EmptyRequest } from "@shared/proto/cline/common"
import { ArrowRightIcon } from "lucide-react"
import CodeVibeMark from "@/assets/CodeVibeMark"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { UiServiceClient } from "@/services/grpc-client"

interface HomeHeaderProps {
	shouldShowStarterWorkflows?: boolean
}

const HomeHeader = ({ shouldShowStarterWorkflows = false }: HomeHeaderProps) => {
	const { environment } = useExtensionState()

	const handleTakeATour = async () => {
		try {
			await UiServiceClient.openWalkthrough(EmptyRequest.create())
		} catch (error) {
			console.error("Error opening walkthrough:", error)
		}
	}

	return (
		<div className="px-4 pt-4 pb-3 border-b border-[var(--vscode-panel-border)]">
			<div className="rounded-md border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-3 py-3">
				<div className="flex items-start gap-3">
					<div className="shrink-0 rounded-md border border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)] p-2">
						<CodeVibeMark className="size-9" environment={environment} />
					</div>
					<div className="min-w-0 flex-1">
						<div className="text-[10px] font-semibold uppercase text-[var(--vscode-descriptionForeground)]">
							CodeVibe Agent
						</div>
						<h1 className="m-0 mt-1 text-xl font-semibold leading-tight text-[var(--vscode-foreground)]">
							Workspace console
						</h1>
						<div className="mt-3 grid grid-cols-3 gap-1.5 text-center text-[11px] font-medium text-[var(--vscode-foreground)]">
							<span className="rounded-sm border border-[var(--vscode-panel-border)] bg-[var(--vscode-toolbar-hoverBackground)] px-2 py-1">
								Explore
							</span>
							<span className="rounded-sm border border-[var(--vscode-panel-border)] bg-[var(--vscode-toolbar-hoverBackground)] px-2 py-1">
								Patch
							</span>
							<span className="rounded-sm border border-[var(--vscode-panel-border)] bg-[var(--vscode-toolbar-hoverBackground)] px-2 py-1">
								Verify
							</span>
						</div>
					</div>
				</div>
				<div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--vscode-panel-border)] pt-3 text-[11px] text-[var(--vscode-descriptionForeground)]">
					<span>Codex-first</span>
					<span>Plan/Act</span>
					<span>Cursor inputs</span>
				</div>
				{shouldShowStarterWorkflows && (
					<button
						className="mt-3 flex w-full items-center justify-between gap-2 rounded-md border border-[var(--vscode-panel-border)] bg-transparent px-3 py-2 text-left text-sm font-medium text-[var(--vscode-foreground)] transition-colors hover:bg-[var(--vscode-list-hoverBackground)]"
						onClick={handleTakeATour}
						type="button">
						Take a Tour
						<ArrowRightIcon className="size-4 shrink-0" />
					</button>
				)}
			</div>
		</div>
	)
}

export default HomeHeader
