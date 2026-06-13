import { BotIcon, HistoryIcon, PlusIcon, SettingsIcon, UserCircleIcon } from "lucide-react"
import { useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { TaskServiceClient } from "@/services/grpc-client"
import { useExtensionState } from "../../context/ExtensionStateContext"

// Custom MCP Server Icon component using VSCode codicon
const McpServerIcon = ({ className, size }: { className?: string; size?: number }) => (
	<span
		className={`codicon codicon-server flex items-center ${className || ""}`}
		style={{ fontSize: size ? `${size}px` : "12.5px", marginBottom: "1px" }}
	/>
)

export const Navbar = () => {
	const { navigateToHistory, navigateToSettings, navigateToAccount, navigateToMcp, navigateToChat } = useExtensionState()

	const SETTINGS_TABS = useMemo(
		() => [
			{
				id: "chat",
				name: "Chat",
				tooltip: "New Task",
				icon: PlusIcon,
				navigate: () => {
					// Close the current task, then navigate to the chat view
					TaskServiceClient.clearTask({})
						.catch((error) => {
							console.error("Failed to clear task:", error)
						})
						.finally(() => navigateToChat())
				},
			},
			{
				id: "mcp",
				name: "MCP",
				tooltip: "MCP Servers",
				icon: McpServerIcon,
				navigate: navigateToMcp,
			},
			{
				id: "history",
				name: "History",
				tooltip: "History",
				icon: HistoryIcon,
				navigate: navigateToHistory,
			},
			{
				id: "account",
				name: "Account",
				tooltip: "Account",
				icon: UserCircleIcon,
				navigate: navigateToAccount,
			},
			{
				id: "settings",
				name: "Settings",
				tooltip: "Settings",
				icon: SettingsIcon,
				navigate: navigateToSettings,
			},
		],
		[navigateToAccount, navigateToChat, navigateToHistory, navigateToMcp, navigateToSettings],
	)

	return (
		<nav
			className="flex-none flex items-center justify-between gap-3 border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)] px-3 py-2 z-10"
			id="codevibe-agent-navbar">
			<div className="flex min-w-0 items-center gap-2">
				<div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)]">
					<BotIcon className="size-4.5" />
				</div>
				<div className="min-w-0 leading-tight">
					<div className="truncate text-[12px] font-semibold text-[var(--vscode-foreground)]">Codie</div>
					<div className="truncate text-[10px] uppercase text-[var(--vscode-descriptionForeground)]">Agent</div>
				</div>
			</div>
			<div className="inline-flex items-center gap-1 rounded-md border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-1 py-0.5">
				{SETTINGS_TABS.map((tab) => (
					<Tooltip key={`navbar-tooltip-${tab.id}`}>
						<TooltipContent side="bottom">{tab.tooltip}</TooltipContent>
						<TooltipTrigger asChild>
							<Button
								aria-label={tab.tooltip}
								className="p-0 h-7"
								data-testid={`tab-${tab.id}`}
								key={`navbar-button-${tab.id}`}
								onClick={() => tab.navigate()}
								size="icon"
								variant="icon">
								<tab.icon className="stroke-1 [svg]:size-4" size={18} />
							</Button>
						</TooltipTrigger>
					</Tooltip>
				))}
			</div>
		</nav>
	)
}
