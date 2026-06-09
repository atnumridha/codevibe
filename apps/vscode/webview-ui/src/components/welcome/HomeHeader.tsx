import { EmptyRequest } from "@shared/proto/cline/common"
import { ArrowRightIcon, GitBranchIcon, MessageSquareIcon, RouteIcon, ShieldCheckIcon } from "lucide-react"
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
		<div className="border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)] px-4 pb-3 pt-4">
			<div className="flex items-start justify-between gap-3">
				<div className="flex min-w-0 items-center gap-3">
					<div className="flex size-11 shrink-0 items-center justify-center rounded-sm border border-codevibe/50 bg-codevibe/10 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--vscode-sideBar-background)_65%,transparent)]">
						<CodeVibeMark className="size-7" environment={environment} />
					</div>
					<div className="min-w-0">
						<div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-codevibe">
							<span className="h-1.5 w-1.5 rounded-full bg-codevibe" />
							<span className="truncate">Agent console</span>
						</div>
						<h1 className="m-0 truncate text-lg font-semibold leading-tight text-[var(--vscode-foreground)]">
							CodeVibe
						</h1>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<button
						aria-label="Open CodeVibe Chat"
						className="flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-codevibe/50 bg-codevibe/10 px-2.5 text-xs font-medium text-codevibe transition-colors hover:bg-codevibe/20"
						data-testid="open-native-agent-session"
						onClick={handleOpenNativeChat}
						type="button">
						<MessageSquareIcon className="size-4" />
						<span>Chat</span>
					</button>
					{shouldShowStarterWorkflows && (
						<button
							aria-label="Open walkthrough"
							className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-[var(--vscode-panel-border)] bg-transparent text-[var(--vscode-icon-foreground)] transition-colors hover:bg-[var(--vscode-toolbar-hoverBackground)]"
							onClick={handleTakeATour}
							type="button">
							<ArrowRightIcon className="size-4" />
						</button>
					)}
				</div>
			</div>
			<div className="mt-3 grid grid-cols-4 gap-1.5 text-[11px] text-[var(--vscode-descriptionForeground)]">
				<div className="flex min-w-0 items-center justify-center gap-1.5 rounded-sm border border-codevibe/30 bg-codevibe/5 px-2 py-1.5">
					<RouteIcon className="size-3.5 shrink-0 text-codevibe" />
					<span className="truncate">Plan</span>
				</div>
				<div className="flex min-w-0 items-center justify-center gap-1.5 rounded-sm border border-[var(--vscode-panel-border)] px-2 py-1.5">
					<MessageSquareIcon className="size-3.5 shrink-0" />
					<span className="truncate">Act</span>
				</div>
				<div className="flex min-w-0 items-center justify-center gap-1.5 rounded-sm border border-[var(--vscode-panel-border)] px-2 py-1.5">
					<ShieldCheckIcon className="size-3.5 shrink-0" />
					<span className="truncate">Review</span>
				</div>
				<div className="flex min-w-0 items-center justify-center gap-1.5 rounded-sm border border-[var(--vscode-panel-border)] px-2 py-1.5">
					<GitBranchIcon className="size-3.5 shrink-0" />
					<span className="truncate">Ship</span>
				</div>
			</div>
		</div>
	)
}

export default HomeHeader
