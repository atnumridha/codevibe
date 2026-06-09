import { EmptyRequest } from "@shared/proto/cline/common"
import { ArrowRightIcon, GitBranchIcon, KeyRoundIcon, MessageSquareIcon, ShieldCheckIcon } from "lucide-react"
import CodeVibeMark from "@/assets/CodeVibeMark"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { UiServiceClient } from "@/services/grpc-client"

interface HomeHeaderProps {
	shouldShowStarterWorkflows?: boolean
}

const HomeHeader = ({ shouldShowStarterWorkflows = false }: HomeHeaderProps) => {
	const { environment } = useExtensionState()

	const handleOpenNativeChat = async () => {
		try {
			await UiServiceClient.openNativeAgentSession(EmptyRequest.create())
		} catch (error) {
			console.error("Error opening native CodeVibe agent:", error)
		}
	}

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
					<div className="flex size-10 shrink-0 items-center justify-center rounded border border-codevibe/40 bg-codevibe/10">
						<CodeVibeMark className="size-7" environment={environment} />
					</div>
					<div className="min-w-0">
						<div className="truncate text-[11px] font-medium text-[var(--vscode-descriptionForeground)]">
							Codex-first coding workspace
						</div>
						<h1 className="m-0 truncate text-lg font-semibold leading-tight text-[var(--vscode-foreground)]">
							CodeVibe Agent
						</h1>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<button
						aria-label="Open CodeVibe in VS Code Chat"
						className="flex size-8 shrink-0 items-center justify-center rounded border border-codevibe/40 bg-codevibe/10 text-codevibe transition-colors hover:bg-codevibe/20"
						data-testid="open-native-agent-session"
						onClick={handleOpenNativeChat}
						type="button">
						<MessageSquareIcon className="size-4" />
					</button>
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
			</div>
			<div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-[var(--vscode-descriptionForeground)]">
				<div className="flex min-w-0 items-center gap-2 rounded border border-codevibe/30 bg-codevibe/5 px-2 py-1.5">
					<MessageSquareIcon className="size-3.5 shrink-0 text-codevibe" />
					<span className="truncate">VS Code Chat first</span>
				</div>
				<div className="flex min-w-0 items-center gap-2 rounded border border-[var(--vscode-panel-border)] px-2 py-1.5">
					<KeyRoundIcon className="size-3.5 shrink-0" />
					<span className="truncate">Codex auth</span>
				</div>
				<div className="flex min-w-0 items-center gap-2 rounded border border-[var(--vscode-panel-border)] px-2 py-1.5">
					<ShieldCheckIcon className="size-3.5 shrink-0" />
					<span className="truncate">Approval terminal</span>
				</div>
				<div className="flex min-w-0 items-center gap-2 rounded border border-[var(--vscode-panel-border)] px-2 py-1.5">
					<GitBranchIcon className="size-3.5 shrink-0" />
					<span className="truncate">Parallel worktrees</span>
				</div>
			</div>
		</div>
	)
}

export default HomeHeader
