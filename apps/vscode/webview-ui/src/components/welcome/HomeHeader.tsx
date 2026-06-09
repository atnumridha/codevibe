import { EmptyRequest } from "@shared/proto/cline/common"
import { ArrowRightIcon, BotIcon, CheckCircle2Icon, GitBranchIcon, TerminalIcon } from "lucide-react"
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
		<div className="border-b border-[var(--vscode-panel-border)] px-4 pb-3 pt-4">
			<div className="flex items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-3">
					<div className="flex size-10 shrink-0 items-center justify-center rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)]">
						<CodeVibeMark className="size-7" environment={environment} />
					</div>
					<div className="min-w-0">
						<div className="truncate text-[11px] font-medium text-[var(--vscode-descriptionForeground)]">
							CodeVibe
						</div>
						<h1 className="m-0 truncate text-lg font-semibold leading-tight text-[var(--vscode-foreground)]">
							Agent console
						</h1>
					</div>
				</div>
				{shouldShowStarterWorkflows && (
					<button
						aria-label="Open walkthrough"
						className="flex size-8 shrink-0 items-center justify-center rounded border border-[var(--vscode-panel-border)] bg-transparent text-[var(--vscode-icon-foreground)] transition-colors hover:bg-[var(--vscode-toolbar-hoverBackground)]"
						onClick={handleTakeATour}
						type="button">
						<ArrowRightIcon className="size-4" />
					</button>
				)}
			</div>
			<div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-[var(--vscode-descriptionForeground)]">
				<div className="flex items-center gap-2 rounded border border-[var(--vscode-panel-border)] px-2 py-1.5">
					<BotIcon className="size-3.5 shrink-0" />
					<span className="truncate">Native agent first</span>
				</div>
				<div className="flex items-center gap-2 rounded border border-[var(--vscode-panel-border)] px-2 py-1.5">
					<CheckCircle2Icon className="size-3.5 shrink-0" />
					<span className="truncate">Codex default</span>
				</div>
				<div className="flex items-center gap-2 rounded border border-[var(--vscode-panel-border)] px-2 py-1.5">
					<TerminalIcon className="size-3.5 shrink-0" />
					<span className="truncate">Terminal approval</span>
				</div>
				<div className="flex items-center gap-2 rounded border border-[var(--vscode-panel-border)] px-2 py-1.5">
					<GitBranchIcon className="size-3.5 shrink-0" />
					<span className="truncate">Worktree ready</span>
				</div>
			</div>
		</div>
	)
}

export default HomeHeader
