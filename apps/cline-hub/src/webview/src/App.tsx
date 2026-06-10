import {
	ActivityIcon,
	BotIcon,
	BoxIcon,
	ClockIcon,
	CopyIcon,
	FunnelIcon,
	GitBranchIcon,
	FolderOpenIcon,
	HomeIcon,
	LinkIcon,
	MessageSquareIcon,
	PencilIcon,
	RotateCcwIcon,
	RssIcon,
	SettingsIcon,
	Trash2Icon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type {
	WebviewActiveConnector,
	WebviewConnectedClient,
	WebviewHubEvent,
	WebviewHubState,
	WebviewOutboundMessage,
	WebviewSessionSummary,
} from "../../webview-protocol";
import Chat from "./Chat";
import {
	type SettingsSection,
	SettingsView,
} from "./components/views/settings/settings-view";
import { desktopClient } from "./lib/desktop-client";
import {
	cursorSettingsSectionFromSearch,
	isCursorLinkPreviewIntentPath,
	isCursorSettingsIntentPath,
	normalizeCursorLinkPath,
} from "./lib/cursor-settings-intent";
import { getVsCodeApi, postToHost } from "./vscode";

type View = "home" | "chat" | "settings";
type Theme = "dark" | "light";
type CursorLinkIntent = {
	key: string;
	uri: string;
};

const VIEW_PATHS: Record<View, string> = {
	home: "/",
	chat: "/chat",
	settings: "/settings",
};

const CHAT_SESSION_QUERY_PARAM = "id";
const CURSOR_LINK_APP_ONLY_PARAMS = new Set(["roomSecret"]);

const SETTINGS_SECTION_PATHS: Record<SettingsSection, string> = {
	General: "/settings",
	Providers: "/settings/providers",
	Customizations: "/settings/customizations",
	MCP: "/settings/mcp",
	Compatibility: "/settings/cursor-links",
	Channels: "/settings/channels",
	Schedules: "/settings/schedules",
	Account: "/settings/account",
};

function cursorLinkSearchFromLocation(search: string): string {
	const params = new URLSearchParams(search);
	for (const key of CURSOR_LINK_APP_ONLY_PARAMS) {
		params.delete(key);
	}
	const serialized = params.toString();
	return serialized ? `?${serialized}` : "";
}

function buildCursorLinkIntentFromLocation(): CursorLinkIntent | undefined {
	if (typeof window === "undefined") return undefined;
	const path = normalizeCursorLinkPath(window.location.pathname);
	if (!isCursorLinkPreviewIntentPath(path, window.location.search)) {
		return undefined;
	}
	const route = path.replace(/^\/+/, "");
	const search = cursorLinkSearchFromLocation(window.location.search);
	return {
		key: `${path}${search}${window.location.hash}`,
		uri: `codevibe://${route}${search}${window.location.hash}`,
	};
}

const EMPTY_HUB_STATE: WebviewHubState = {
	type: "hub_state",
	connected: false,
	clients: [],
	connectors: [],
	sessions: [],
	clientSummaries: [],
	sessionSummaries: [],
	events: [],
};

function readTheme(): Theme {
	try {
		const state = getVsCodeApi()?.getState() as { theme?: Theme } | undefined;
		return state?.theme === "light" ? "light" : "dark";
	} catch {
		return "dark";
	}
}

function writeTheme(theme: Theme): void {
	try {
		const api = getVsCodeApi();
		const state = (api?.getState() as Record<string, unknown>) ?? {};
		api?.setState({ ...state, theme });
	} catch {
		// Theme persistence is best-effort.
	}
}

function viewFromPath(pathname: string): View {
	if (
		typeof window !== "undefined" &&
		isCursorLinkPreviewIntentPath(pathname, window.location.search)
	) {
		return "settings";
	}
	if (pathname === VIEW_PATHS.chat) return "chat";
	if (
		pathname === VIEW_PATHS.settings ||
		pathname.startsWith(`${VIEW_PATHS.settings}/`)
	) {
		return "settings";
	}
	return "home";
}

function settingsSectionFromPath(pathname: string): SettingsSection {
	for (const [section, path] of Object.entries(SETTINGS_SECTION_PATHS)) {
		if (pathname === path) {
			return section as SettingsSection;
		}
	}
	return "General";
}

function readCurrentView(): View {
	if (typeof window === "undefined") return "home";
	return viewFromPath(window.location.pathname);
}

function readCurrentChatSessionId(): string | undefined {
	if (typeof window === "undefined") return undefined;
	if (window.location.pathname !== VIEW_PATHS.chat) return undefined;
	const sessionId = new URLSearchParams(window.location.search)
		.get(CHAT_SESSION_QUERY_PARAM)
		?.trim();
	return sessionId || undefined;
}

function chatPath(sessionId?: string): string {
	if (!sessionId) return VIEW_PATHS.chat;
	const params = new URLSearchParams({ [CHAT_SESSION_QUERY_PARAM]: sessionId });
	return `${VIEW_PATHS.chat}?${params.toString()}`;
}

function readCurrentSettingsSection(): SettingsSection {
	if (typeof window === "undefined") return "General";
	if (
		isCursorSettingsIntentPath(window.location.pathname, window.location.search)
	) {
		return cursorSettingsSectionFromSearch(
			window.location.search,
		) as SettingsSection;
	}
	if (
		isCursorLinkPreviewIntentPath(
			window.location.pathname,
			window.location.search,
		)
	) {
		return "Compatibility";
	}
	return settingsSectionFromPath(window.location.pathname);
}

function formatRelativeTime(timestamp?: number): string {
	if (!timestamp) return "unknown";
	const elapsed = Math.max(0, Date.now() - timestamp);
	const minutes = Math.floor(elapsed / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

function shortId(id: string): string {
	return id.length > 12 ? id.slice(0, 12) : id;
}

function workspaceName(path?: string): string | undefined {
	const trimmed = path?.trim();
	if (!trimmed) return undefined;
	const parts = trimmed.split(/[\\/]+/).filter(Boolean);
	return parts.at(-1) ?? trimmed;
}

function formatCompactNumber(value?: number): string | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	return new Intl.NumberFormat(undefined, {
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(value);
}

function formatCost(value?: number): string | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	return new Intl.NumberFormat(undefined, {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
		maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
	}).format(value);
}

function statusTone(status?: string): string {
	const normalized = status?.toLowerCase();
	if (
		normalized === "running" ||
		normalized === "completed" ||
		normalized === "idle"
	)
		return "bg-emerald-300";
	if (normalized === "failed") return "bg-destructive";
	return "bg-muted-foreground";
}

function sessionMetadataRecord(
	value?: Record<string, unknown>,
): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? value
		: {};
}

function recordString(
	record: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function recordStringArray(
	record: Record<string, unknown>,
	key: string,
): string[] {
	const value = record[key];
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => (typeof entry === "string" ? entry.trim() : ""))
		.filter(Boolean);
}

function clientLabel(client: WebviewConnectedClient): string {
	return (
		client.displayName?.trim() || client.clientType || shortId(client.clientId)
	);
}

function connectorLabel(connector: WebviewActiveConnector): string {
	if (connector.botUsername) {
		return `@${connector.botUsername}`;
	}
	if (connector.userName) {
		return connector.userName;
	}
	if (connector.applicationId) {
		return connector.applicationId;
	}
	return shortId(connector.id);
}

function sessionRunDetails(session: WebviewSessionSummary): string[] {
	const inputTokens = formatCompactNumber(session.inputTokens);
	const outputTokens = formatCompactNumber(session.outputTokens);
	const cost = formatCost(session.totalCost);
	const backgroundDetails = sessionBackgroundDetails(session);
	return [
		workspaceName(session.workspaceRoot),
		`${session.providerId}:${session.model}`,
		...backgroundDetails,
		inputTokens ? `${inputTokens}/${outputTokens}` : undefined,
		cost,
		session.source,
	].filter((detail): detail is string => Boolean(detail));
}

function sessionBackgroundDetails(session: WebviewSessionSummary): string[] {
	if (!session.backgroundAgent) return [];
	const details = sessionMetadataRecord(session.backgroundAgentDetails);
	const repository = recordString(details, "repository");
	const branch = recordString(details, "requestedBranch");
	const baseBranch = recordString(details, "requestedBaseBranch");
	const configKeys = recordStringArray(details, "configKeys");
	return [
		"background",
		repository ? `repo:${repository}` : undefined,
		branch ? `branch:${branch}` : undefined,
		baseBranch ? `base:${baseBranch}` : undefined,
		configKeys.length > 0 ? `config:${configKeys.join(",")}` : undefined,
	].filter((detail): detail is string => Boolean(detail));
}

function sessionFilterDetails(session: WebviewSessionSummary): string[] {
	const name = workspaceName(session.workspaceRoot);
	return [
		name ? `workspace:${name}` : undefined,
		session.status ? `status:${session.status}` : undefined,
		session.providerId ? `provider:${session.providerId}` : undefined,
		session.model ? `model:${session.model}` : undefined,
		session.source ? `source:${session.source}` : undefined,
		...sessionBackgroundDetails(session).map((detail) =>
			detail === "background" ? "agent:background" : detail,
		),
	].filter((detail): detail is string => Boolean(detail));
}

function Shell({
	children,
	onNavigate,
	view,
}: {
	children: ReactNode;
	onNavigate: (view: View) => void;
	theme: Theme;
	view: View;
}) {
	return (
		<div className="grid h-screen min-h-screen grid-rows-[auto_minmax(0,1fr)] bg-background text-foreground">
			<header className="flex items-center justify-between gap-4 border-b bg-[color-mix(in_oklch,var(--background)_94%,var(--card))] px-4 py-2.5 max-[720px]:flex-col max-[720px]:items-stretch">
				<div className="min-w-0">
					<h1 className="min-w-0">
						<button
							className="block truncate rounded-sm text-base font-semibold outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background pointer-cursor"
							onClick={() => onNavigate("home")}
							type="button"
						>
							CodeVibe Hub
						</button>
					</h1>
				</div>
				<nav
					className="flex items-center gap-1.5 max-[720px]:justify-start"
					aria-label="Hub views"
				>
					<Button
						onClick={() => onNavigate("home")}
						size="sm"
						type="button"
						variant={view === "home" ? "default" : "ghost"}
					>
						<HomeIcon className="size-4" />
					</Button>
					<Button
						onClick={() => onNavigate("chat")}
						size="sm"
						type="button"
						variant={view === "chat" ? "default" : "ghost"}
					>
						<MessageSquareIcon className="size-4" />
					</Button>
					<Button
						onClick={() => onNavigate("settings")}
						size="icon-sm"
						title="Settings"
						type="button"
						variant={view === "settings" ? "default" : "ghost"}
					>
						<SettingsIcon className="size-4" />
						<span className="sr-only">Settings</span>
					</Button>
				</nav>
			</header>
			<main className="min-h-0 overflow-hidden [&>.h-screen]:h-full">
				{children}
			</main>
		</div>
	);
}

function HomeView({
	backgroundAgentBusyId,
	backgroundAgentError,
	backgroundAgentSessions,
	hubState,
	onDismissBackgroundAgent,
	onOpenBackgroundAgentWorktree,
	onOpenSession,
	onDeleteSession,
	onRenameSession,
	onRestartHub,
	restartPending,
	recentSessions,
}: {
	backgroundAgentBusyId?: string;
	backgroundAgentError?: string;
	backgroundAgentSessions: WebviewSessionSummary[];
	hubState: WebviewHubState;
	onDismissBackgroundAgent: (sessionId: string) => Promise<void> | void;
	onOpenBackgroundAgentWorktree: (sessionId: string) => Promise<void> | void;
	onOpenSession: (sessionId: string) => void;
	onDeleteSession: (sessionId: string) => Promise<void> | void;
	onRenameSession: (sessionId: string, title: string) => Promise<void> | void;
	onRestartHub: () => void;
	restartPending: boolean;
	recentSessions: WebviewSessionSummary[];
}) {
	const activeSessions = hubState.sessionSummaries ?? [];
	const connectedClients = hubState.clients ?? [];
	const connectedConnectors = hubState.connectors ?? [];
	const latestEvents = hubState.events.slice(0, 6);
	const activeBackgroundSessions = backgroundAgentSessions.length;
	const [restartDialogOpen, setRestartDialogOpen] = useState(false);
	const [sessionFilters, setSessionFilters] = useState<string[]>([]);
	const runDetailFilterOptions = useMemo(
		() =>
			Array.from(
				new Set(
					recentSessions.flatMap((session) => sessionFilterDetails(session)),
				),
			).sort((a, b) => a.localeCompare(b)),
		[recentSessions],
	);
	const filteredRecentSessions = useMemo(() => {
		if (sessionFilters.length === 0) {
			return recentSessions;
		}
		const selected = new Set(sessionFilters);
		return recentSessions.filter((session) =>
			sessionFilterDetails(session).some((detail) => selected.has(detail)),
		);
	}, [recentSessions, sessionFilters]);

	const toggleSessionFilter = (detail: string, checked: boolean) => {
		setSessionFilters((prev) => {
			if (checked) {
				return prev.includes(detail) ? prev : [...prev, detail];
			}
			return prev.filter((item) => item !== detail);
		});
	};

	const copyText = useCallback((value?: string) => {
		if (!value || typeof navigator === "undefined") return;
		void navigator.clipboard?.writeText(value);
	}, []);

	const confirmRestartHub = () => {
		setRestartDialogOpen(false);
		onRestartHub();
	};

	return (
		<div className="h-full overflow-auto p-4.5 max-[720px]:p-3">
			<section className="flex items-center justify-between gap-4 border-b pb-4.5 max-[720px]:flex-col max-[720px]:items-stretch">
				<div>
					<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
						Dashboard
					</p>
					{/* <p className="overview-subtitle">
						{hubState.lastWorkspaceRoot || "No workspace context yet"}
					</p> */}
				</div>
				<div className="flex flex-wrap items-center justify-end gap-2.5 max-[720px]:justify-start">
					<div
						className="inline-flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs text-muted-foreground"
						title="Hub uptime"
					>
						<ClockIcon className="size-4" />
						{hubState.hubUptime ?? "no uptime"}
					</div>
					<button
						aria-label="Copy hub URL"
						className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
						disabled={!hubState.hubUrl}
						onClick={() => copyText(hubState.hubUrl)}
						title="Copy hub URL"
						type="button"
					>
						<LinkIcon className="size-4 shrink-0" />
						<span
							className="min-w-0 truncate"
							title={hubState.hubUrl ?? "No hub URL"}
						>
							{hubState.hubUrl ?? "no hub url"}
						</span>
					</button>
					<button
						aria-label="Copy core SDK version"
						className="inline-flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
						disabled={!hubState.coreVersion}
						onClick={() => copyText(hubState.coreVersion)}
						title="Copy core SDK version"
						type="button"
					>
						<BoxIcon className="size-4 shrink-0" />
						<span title={hubState.coreVersion ?? "Unknown"}>
							v{hubState.coreVersion ?? "Unknown"}
						</span>
					</button>
					<Button
						disabled={!hubState.connected || restartPending}
						onClick={() => setRestartDialogOpen(true)}
						size="sm"
						title="Restart CodeVibe Hub"
						type="button"
						variant="outline"
					>
						<RotateCcwIcon
							className={`size-4 ${restartPending ? "animate-spin" : ""}`}
						/>
						<span>{restartPending ? "Restarting" : "Restart"}</span>
					</Button>
				</div>
			</section>
			<AlertDialog
				open={restartDialogOpen}
				onOpenChange={(open) => {
					if (!restartPending) {
						setRestartDialogOpen(open);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Restart CodeVibe Hub</AlertDialogTitle>
						<AlertDialogDescription>
							This will shut down the current hub process and start it again.
							Connected clients and active sessions may disconnect while the hub
							restarts.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={restartPending}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={!hubState.connected || restartPending}
							onClick={confirmRestartHub}
							variant="destructive"
						>
							<RotateCcwIcon
								className={`size-4 ${restartPending ? "animate-spin" : ""}`}
							/>
							<span>{restartPending ? "Restarting" : "Restart Hub"}</span>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<section className="my-4 grid grid-cols-3 gap-2.5 max-[880px]:grid-cols-1">
				<div className="grid grid-cols-[auto_1fr] grid-rows-[auto_auto] items-center gap-x-2.5 gap-y-0.5 rounded-lg border bg-[color-mix(in_oklch,var(--card)_88%,transparent)] p-3.5">
					<BotIcon className="size-4 text-muted-foreground" />
					<span className="text-[26px] font-bold leading-none">
						{connectedClients.length + connectedConnectors.length}
					</span>
					<span className="col-start-2 text-xs text-muted-foreground">
						Connected Clients
					</span>
				</div>
				<div className="grid grid-cols-[auto_1fr] grid-rows-[auto_auto] items-center gap-x-2.5 gap-y-0.5 rounded-lg border bg-[color-mix(in_oklch,var(--card)_88%,transparent)] p-3.5">
					<ActivityIcon className="size-4 text-muted-foreground" />
					<span className="text-[26px] font-bold leading-none">
						{activeSessions.length}
					</span>
					<span className="col-start-2 text-xs text-muted-foreground">
						Active Sessions
					</span>
				</div>
				<div className="grid grid-cols-[auto_1fr] grid-rows-[auto_auto] items-center gap-x-2.5 gap-y-0.5 rounded-lg border bg-[color-mix(in_oklch,var(--card)_88%,transparent)] p-3.5">
					<GitBranchIcon className="size-4 text-muted-foreground" />
					<span className="text-[26px] font-bold leading-none">
						{activeBackgroundSessions}
					</span>
					<span className="col-start-2 text-xs text-muted-foreground">
						Background Agents
					</span>
				</div>
			</section>

			<BackgroundAgentLifecycleSection
				busyId={backgroundAgentBusyId}
				error={backgroundAgentError}
				onDismiss={onDismissBackgroundAgent}
				onOpenWorktree={onOpenBackgroundAgentWorktree}
				onOpen={onOpenSession}
				sessions={backgroundAgentSessions}
			/>

			<section
				id="connected-clients-section"
				className="min-h-60 overflow-hidden rounded-lg border bg-card"
			>
				<div className="flex items-center justify-between gap-3 border-b px-3.5 py-3">
					<h3 className="text-[13px] font-[650]">Connected Clients</h3>
					<span className="text-xs text-muted-foreground">
						{connectedClients.length + connectedConnectors.length}
					</span>
				</div>
				<div className="grid max-h-43.5 gap-2 overflow-y-auto p-2.5">
					{connectedClients.length === 0 && connectedConnectors.length === 0 ? (
						<p className="px-1 py-4 text-[13px] text-muted-foreground">
							No connected clients or channels found.
						</p>
					) : (
						connectedClients.map((client) => (
							<div
								className="flex items-center justify-between gap-3 border bg-[color-mix(in_oklch,var(--background)_70%,var(--card))] p-2.5"
								key={client.clientId}
							>
								<div className="min-w-0">
									<p className="truncate text-[13px] font-semibold leading-tight">
										{clientLabel(client)}
									</p>
									<span className="block truncate text-[11px] text-muted-foreground">
										{client.clientType}
									</span>
								</div>
								<span className="whitespace-nowrap text-[11px] text-muted-foreground">
									{formatRelativeTime(client.connectedAt)}
								</span>
							</div>
						))
					)}
					{connectedConnectors.map((connector) => (
						<div
							className="flex items-center justify-between gap-3 border bg-[color-mix(in_oklch,var(--background)_70%,var(--card))] p-2.5"
							key={connector.id}
						>
							<div className="min-w-0">
								<p className="truncate text-[13px] font-semibold leading-tight">
									{connector.type.toUpperCase()}
								</p>
								<span
									className="block truncate text-[11px] text-muted-foreground"
									title={connector.hubUrl}
								>
									{connectorLabel(connector)} | pid={connector.pid}
								</span>
							</div>
							<span
								className="block truncate text-[11px] text-muted-foreground"
								title={connector.hubUrl}
							>
								Channel
							</span>
						</div>
					))}
				</div>
			</section>

			<div className="mt-4 grid grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)] gap-3.5 max-[980px]:grid-cols-1">
				<section
					id="recent-sessions-section"
					className="min-h-60 overflow-hidden rounded-lg border bg-card"
				>
					<div className="flex items-center justify-between gap-3 border-b px-3.5 py-3">
						<h3 className="text-[13px] font-[650]">
							Last {filteredRecentSessions.length} Sessions
						</h3>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										title="Session Filters"
										aria-label="Filter sessions"
										size="icon-sm"
										type="button"
										variant={sessionFilters.length > 0 ? "default" : "ghost"}
									/>
								}
							>
								<FunnelIcon className="size-4" />
							</DropdownMenuTrigger>
							<DropdownMenuContent
								align="end"
								className="max-h-72 w-72"
								sideOffset={6}
							>
								<DropdownMenuGroup>
									<DropdownMenuLabel>Filter sessions</DropdownMenuLabel>
									{sessionFilters.length > 0 ? (
										<>
											<DropdownMenuItem onClick={() => setSessionFilters([])}>
												Clear filters
											</DropdownMenuItem>
											<DropdownMenuSeparator />
										</>
									) : null}
									{runDetailFilterOptions.length === 0 ? (
										<DropdownMenuItem disabled>No run details</DropdownMenuItem>
									) : (
										runDetailFilterOptions.map((detail) => (
											<DropdownMenuCheckboxItem
												checked={sessionFilters.includes(detail)}
												key={detail}
												onCheckedChange={(checked: boolean) =>
													toggleSessionFilter(detail, checked)
												}
											>
												<span className="truncate" title={detail}>
													{detail}
												</span>
											</DropdownMenuCheckboxItem>
										))
									)}
								</DropdownMenuGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
					<div className="grid gap-2 p-2.5">
						{recentSessions.length === 0 ? (
							<p className="px-1 py-4 text-[13px] text-muted-foreground">
								No recent sessions.
							</p>
						) : filteredRecentSessions.length === 0 ? (
							<p className="px-1 py-4 text-[13px] text-muted-foreground">
								No sessions match the selected filters.
							</p>
						) : (
							filteredRecentSessions.map((session) => (
								<RecentSessionRow
									key={session.sessionId}
									onDelete={() => onDeleteSession(session.sessionId)}
									onOpen={() => onOpenSession(session.sessionId)}
									onRename={(title) =>
										onRenameSession(session.sessionId, title)
									}
									session={session}
								/>
							))
						)}
					</div>
				</section>

				<section className="min-h-60 overflow-hidden rounded-lg border bg-card">
					<div className="flex items-center justify-between gap-3 border-b px-3.5 py-3">
						<h3 className="text-[13px] font-[650]">Recent Events</h3>
						<span className="text-xs text-muted-foreground">
							<RssIcon className="size-4" />
						</span>
					</div>
					<div className="w-full p-2.5">
						{latestEvents.length === 0 ? (
							<p className="px-1 py-4 text-[13px] text-muted-foreground">
								No hub events yet.
							</p>
						) : (
							latestEvents.map((event) => (
								<EventRow event={event} key={event.id} />
							))
						)}
					</div>
				</section>
			</div>
		</div>
	);
}

function backgroundAgentLifecycleDetails(
	session: WebviewSessionSummary,
): string[] {
	const details = sessionMetadataRecord(session.backgroundAgentDetails);
	const repository = recordString(details, "repository");
	const requestedBranch = recordString(details, "requestedBranch");
	const requestedBaseBranch = recordString(details, "requestedBaseBranch");
	const worktreePath = recordString(details, "worktreePath");
	const worktreeBranch = recordString(details, "worktreeBranch");
	const fallbackReason = recordString(details, "fallbackReason");
	const warning = recordString(details, "warning");
	const errorMessage = recordString(details, "errorMessage");
	return [
		repository ? `repo:${repository}` : undefined,
		requestedBranch ? `branch:${requestedBranch}` : undefined,
		requestedBaseBranch ? `base:${requestedBaseBranch}` : undefined,
		worktreeBranch ? `worktree branch:${worktreeBranch}` : undefined,
		worktreePath ? `worktree:${worktreePath}` : undefined,
		fallbackReason ? `fallback:${fallbackReason}` : undefined,
		warning ? `warning:${warning}` : undefined,
		errorMessage ? `error:${errorMessage}` : undefined,
	].filter((detail): detail is string => Boolean(detail));
}

function backgroundAgentRecordId(session: WebviewSessionSummary): string {
	const details = sessionMetadataRecord(session.backgroundAgentDetails);
	return (
		recordString(details, "id") ||
		recordString(details, "taskId") ||
		session.sessionId
	);
}

function BackgroundAgentLifecycleSection({
	busyId,
	error,
	onDismiss,
	onOpen,
	onOpenWorktree,
	sessions,
}: {
	busyId?: string;
	error?: string;
	onDismiss: (sessionId: string) => Promise<void> | void;
	onOpen: (sessionId: string) => void;
	onOpenWorktree: (sessionId: string) => Promise<void> | void;
	sessions: WebviewSessionSummary[];
}) {
	const [dismissTarget, setDismissTarget] =
		useState<WebviewSessionSummary | null>(null);
	const targetId = dismissTarget ? backgroundAgentRecordId(dismissTarget) : "";
	const confirmDismiss = async () => {
		if (!dismissTarget) return;
		await onDismiss(backgroundAgentRecordId(dismissTarget));
		setDismissTarget(null);
	};
	const copyWorktreePath = useCallback((worktreePath?: string) => {
		if (!worktreePath || typeof navigator === "undefined") return;
		void navigator.clipboard?.writeText(worktreePath);
	}, []);

	return (
		<section className="mb-4 overflow-hidden rounded-lg border bg-card">
			<div className="flex items-center justify-between gap-3 border-b px-3.5 py-3">
				<div>
					<h3 className="text-[13px] font-[650]">Background Agent Lifecycle</h3>
					<p className="text-[11px] text-muted-foreground">
						{sessions.length} persisted launch record
						{sessions.length === 1 ? "" : "s"}
					</p>
				</div>
				<GitBranchIcon className="size-4 text-muted-foreground" />
			</div>
			{error ? (
				<div className="border-b border-destructive/40 bg-destructive/10 px-3.5 py-2 text-xs text-destructive">
					{error}
				</div>
			) : null}
			<div className="grid gap-2 p-2.5">
				{sessions.length === 0 ? (
					<p className="px-1 py-4 text-[13px] text-muted-foreground">
						No background-agent lifecycle records.
					</p>
				) : (
					sessions.map((session) => {
						const detailsRecord = sessionMetadataRecord(
							session.backgroundAgentDetails,
						);
						const details = backgroundAgentLifecycleDetails(session);
						const recordId = backgroundAgentRecordId(session);
						const linkedTaskId = recordString(detailsRecord, "taskId");
						const worktreePath = recordString(detailsRecord, "worktreePath");
						const isBusy = busyId === recordId || busyId === session.sessionId;
						return (
							<div
								className="grid gap-2 border bg-[color-mix(in_oklch,var(--background)_70%,var(--card))] p-2.5"
								key={`${recordId}:${session.sessionId}`}
							>
								<div className="flex items-center gap-2">
									<span
										className={`size-2 shrink-0 rounded-full ${statusTone(session.status)}`}
									/>
									<div className="min-w-0 flex-1">
										<p className="truncate text-[13px] font-semibold leading-tight">
											{session.title || shortId(session.sessionId)}
										</p>
										<span className="block truncate text-[11px] text-muted-foreground">
											{session.status || "unknown"} | {recordId}
										</span>
									</div>
									<Button
										aria-label={`Open ${session.title || session.sessionId}`}
										disabled={!linkedTaskId}
										onClick={() => onOpen(linkedTaskId ?? session.sessionId)}
										size="sm"
										type="button"
										variant="outline"
									>
										Open
									</Button>
									<Button
										aria-label={`Open worktree for ${session.title || session.sessionId}`}
										disabled={!worktreePath || isBusy}
										onClick={() => void onOpenWorktree(recordId)}
										size="icon-sm"
										title="Open worktree"
										type="button"
										variant="outline"
									>
										<FolderOpenIcon className="size-3.5" />
									</Button>
									<Button
										aria-label={`Copy worktree path for ${session.title || session.sessionId}`}
										disabled={!worktreePath}
										onClick={() => copyWorktreePath(worktreePath)}
										size="icon-sm"
										title="Copy worktree path"
										type="button"
										variant="ghost"
									>
										<CopyIcon className="size-3.5" />
									</Button>
									<Button
										aria-label={`Dismiss ${session.title || session.sessionId}`}
										disabled={isBusy}
										onClick={() => setDismissTarget(session)}
										size="sm"
										type="button"
										variant="ghost"
									>
										<Trash2Icon className="size-3.5" />
									</Button>
								</div>
								<div className="flex flex-wrap items-center gap-1.5 pl-4 text-[11px] text-muted-foreground">
									<span>{formatRelativeTime(session.updatedAt)}</span>
									{session.workspaceRoot ? (
										<span
											className="max-w-full break-all rounded-md border bg-background px-1.5 py-0.5"
											title={session.workspaceRoot}
										>
											{session.workspaceRoot}
										</span>
									) : null}
									{details.map((detail) => (
										<span
											className="max-w-full break-all rounded-md border bg-background px-1.5 py-0.5"
											key={detail}
											title={detail}
										>
											{detail}
										</span>
									))}
								</div>
							</div>
						);
					})
				)}
			</div>
			<AlertDialog
				open={Boolean(dismissTarget)}
				onOpenChange={(open) => {
					if (!open) setDismissTarget(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Dismiss Background Agent</AlertDialogTitle>
						<AlertDialogDescription>
							This removes the persisted lifecycle record from the hub list. It
							does not remove files, branches, worktrees, or active chat
							history.
							<br />
							{targetId}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={Boolean(busyId)}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={Boolean(busyId)}
							onClick={() => void confirmDismiss()}
							variant="destructive"
						>
							{busyId ? "Dismissing..." : "Dismiss"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</section>
	);
}

function RecentSessionRow({
	onDelete,
	onOpen,
	onRename,
	session,
}: {
	onDelete: () => Promise<void> | void;
	onOpen: () => void;
	onRename: (title: string) => Promise<void> | void;
	session: WebviewSessionSummary;
}) {
	const runDetails = sessionRunDetails(session);
	const currentSessionId = session.sessionId;
	const currentTitle = session.title || shortId(session.sessionId);
	const backgroundDetails = sessionBackgroundDetails(session);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [editingTitle, setEditingTitle] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const [titleDraft, setTitleDraft] = useState(currentTitle);

	const saveTitle = async () => {
		if (renaming) return;
		const nextTitle = titleDraft.replace(/\s+/g, " ").trim();
		setRenaming(true);
		try {
			await onRename(nextTitle);
			setEditingTitle(false);
		} finally {
			setRenaming(false);
		}
	};

	const confirmDelete = async () => {
		setDeleting(true);
		try {
			await onDelete();
			setDeleteDialogOpen(false);
		} finally {
			setDeleting(false);
		}
	};

	return (
		<div className="grid w-full gap-2 border bg-[color-mix(in_oklch,var(--background)_70%,var(--card))] p-2.5 text-left transition-colors hover:bg-accent">
			<div className="flex items-center justify-start gap-3">
				<span
					className={`size-2 shrink-0 rounded-full ${statusTone(session.status)}`}
				/>
				{editingTitle ? (
					<form
						className="flex min-w-0 flex-1 items-center gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							void saveTitle();
						}}
					>
						<Input
							autoFocus
							className="h-7 min-w-0 flex-1 text-[13px]"
							disabled={renaming}
							onChange={(event) => setTitleDraft(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									setTitleDraft(currentTitle);
									setEditingTitle(false);
								}
							}}
							value={titleDraft}
						/>
						<Button disabled={renaming} size="sm" type="submit">
							Save
						</Button>
						<Button
							disabled={renaming}
							onClick={() => {
								setTitleDraft(currentTitle);
								setEditingTitle(false);
							}}
							size="sm"
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
					</form>
				) : (
					<div className="flex min-w-0 flex-1 items-center gap-1.5">
						<button
							className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							onClick={onOpen}
							type="button"
						>
							<span className="flex min-w-0 items-center gap-1.5">
								<span className="block min-w-0 truncate text-[13px] font-semibold leading-tight">
									{currentTitle}
								</span>
								{session.backgroundAgent ? (
									<span
										className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary"
										title="Background agent session"
									>
										<GitBranchIcon className="size-3" />
										Bg
									</span>
								) : null}
							</span>
						</button>
						<Button
							title="Edit session title"
							aria-label="Edit session title"
							onClick={() => {
								setTitleDraft(currentTitle);
								setEditingTitle(true);
							}}
							size="icon-sm"
							type="button"
							variant="ghost"
						>
							<PencilIcon className="size-3.5" />
						</Button>
						<Button
							title="Delete session"
							aria-label="Delete session"
							onClick={() => setDeleteDialogOpen(true)}
							size="icon-sm"
							type="button"
							variant="ghost"
						>
							<Trash2Icon className="size-3.5" />
						</Button>
					</div>
				)}
			</div>
			{runDetails.length > 0 ? (
				<div className="flex flex-wrap items-center gap-1.5 pl-4.5 text-[11px] text-muted-foreground">
					<span>{formatRelativeTime(session.updatedAt)}</span>
					<span
						className="max-w-full break-all rounded-md border bg-background px-1.5 py-0.5"
						key={session.workspaceRoot}
						title={session.workspaceRoot}
					>
						{session.workspaceRoot}
					</span>
					{runDetails.map((detail) => (
						<span
							className="max-w-full break-all rounded-md border bg-background px-1.5 py-0.5"
							key={detail}
							title={detail}
						>
							{detail}
						</span>
					))}
					{backgroundDetails.length > 0 ? (
						<span
							className="max-w-full break-all rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-primary"
							title={backgroundDetails.join(" | ")}
						>
							confirm before worktree
						</span>
					) : null}
				</div>
			) : null}
			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Delete Session {currentSessionId}
						</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete this CodeVibe session across clients:
							<br />
							{currentTitle}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							disabled={deleting}
							onClick={() => void confirmDelete()}
							variant="destructive"
						>
							{deleting ? "Deleting..." : "Delete"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function EventRow({ event }: { event: WebviewHubEvent }) {
	const severityBorder = {
		error: "border-l-destructive",
		info: "border-l-blue-300",
		success: "border-l-muted-foreground",
		warn: "border-l-amber-300",
	}[event.severity];

	return (
		<div
			className={`flex items-start justify-between gap-3 border border-l-[3px] bg-[color-mix(in_oklch,var(--background)_70%,var(--card))] p-2.5 ${severityBorder}`}
		>
			<div>
				<p className="text-[13px] font-semibold leading-tight">{event.title}</p>
				<span className="text-[11px] text-muted-foreground">{event.body}</span>
			</div>
			<time className="whitespace-nowrap text-[11px] text-muted-foreground">
				{formatRelativeTime(event.timestamp)}
			</time>
		</div>
	);
}

function App() {
	const [view, setView] = useState<View>(() => readCurrentView());
	const [settingsSection, setSettingsSection] = useState<SettingsSection>(() =>
		readCurrentSettingsSection(),
	);
	const [cursorLinkIntent, setCursorLinkIntent] = useState<
		CursorLinkIntent | undefined
	>(() => buildCursorLinkIntentFromLocation());
	const [theme, setTheme] = useState<Theme>(() => readTheme());
	const [hubState, setHubState] = useState<WebviewHubState>(EMPTY_HUB_STATE);
	const [restartPending, setRestartPending] = useState(false);
	const [selectedSessionId, setSelectedSessionId] = useState<
		string | undefined
	>(() => readCurrentChatSessionId());
	const [recentSessions, setRecentSessions] = useState<WebviewSessionSummary[]>(
		[],
	);
	const [backgroundAgentSessions, setBackgroundAgentSessions] = useState<
		WebviewSessionSummary[]
	>([]);
	const [backgroundAgentError, setBackgroundAgentError] = useState<
		string | undefined
	>();
	const [backgroundAgentBusyId, setBackgroundAgentBusyId] = useState<
		string | undefined
	>();

	useEffect(() => {
		document.documentElement.classList.toggle("dark", theme === "dark");
		writeTheme(theme);
	}, [theme]);

	useEffect(() => {
		const handlePopState = () => {
			const nextView = readCurrentView();
			setView(nextView);
			setSelectedSessionId(
				nextView === "chat" ? readCurrentChatSessionId() : undefined,
			);
			setSettingsSection(readCurrentSettingsSection());
			setCursorLinkIntent(buildCursorLinkIntentFromLocation());
		};
		window.addEventListener("popstate", handlePopState);
		return () => window.removeEventListener("popstate", handlePopState);
	}, []);

	useEffect(() => {
		const handleMessage = (event: MessageEvent<WebviewOutboundMessage>) => {
			const message = event.data;
			if (!message || typeof message !== "object") {
				return;
			}
			if (message.type === "hub_state") {
				setHubState(message);
				if (message.connected) {
					setRestartPending(false);
				}
				return;
			}
			if (message.type === "sessions") {
				setRecentSessions(message.sessions);
			}
		};
		window.addEventListener("message", handleMessage);
		postToHost({ type: "ready" });
		return () => window.removeEventListener("message", handleMessage);
	}, []);

	const refreshBackgroundAgentSessions = useCallback(async () => {
		try {
			const sessions = await desktopClient.listBackgroundAgentSessions();
			setBackgroundAgentSessions(sessions);
			setBackgroundAgentError(undefined);
		} catch (error) {
			setBackgroundAgentError(
				error instanceof Error ? error.message : String(error),
			);
		}
	}, []);

	useEffect(() => {
		void refreshBackgroundAgentSessions();
		const intervalId = window.setInterval(() => {
			void refreshBackgroundAgentSessions();
		}, 15_000);
		return () => window.clearInterval(intervalId);
	}, [refreshBackgroundAgentSessions]);

	useEffect(() => {
		if (!hubState.connected) {
			return;
		}
		void refreshBackgroundAgentSessions();
	}, [hubState.connected, refreshBackgroundAgentSessions]);

	const restartHub = useCallback(() => {
		setRestartPending(true);
		postToHost({ type: "restart_hub" });
	}, []);

	const navigate = useCallback((nextView: View) => {
		if (nextView === "chat") {
			setSelectedSessionId(undefined);
		}
		if (nextView === "settings") {
			setSettingsSection("General");
		}
		setCursorLinkIntent(undefined);
		const nextPath = VIEW_PATHS[nextView];
		if (window.location.pathname !== nextPath) {
			window.history.pushState(null, "", nextPath);
		}
		setView(nextView);
	}, []);

	const navigateSettingsSection = useCallback((section: SettingsSection) => {
		setSettingsSection(section);
		setCursorLinkIntent(undefined);
		const nextPath = SETTINGS_SECTION_PATHS[section];
		if (window.location.pathname !== nextPath) {
			window.history.pushState(null, "", nextPath);
		}
	}, []);

	const openSession = useCallback((sessionId: string) => {
		setSelectedSessionId(sessionId);
		setCursorLinkIntent(undefined);
		const nextPath = chatPath(sessionId);
		if (`${window.location.pathname}${window.location.search}` !== nextPath) {
			window.history.pushState(null, "", nextPath);
		}
		setView("chat");
	}, []);

	const updateChatSessionRoute = useCallback((sessionId?: string) => {
		setSelectedSessionId(sessionId);
		const nextPath = chatPath(sessionId);
		if (`${window.location.pathname}${window.location.search}` !== nextPath) {
			window.history.replaceState(null, "", nextPath);
		}
	}, []);

	const deleteSession = useCallback((sessionId: string) => {
		setRecentSessions((current) =>
			current.filter((session) => session.sessionId !== sessionId),
		);
		postToHost({ type: "deleteSession", sessionId });
	}, []);

	const renameSession = useCallback((sessionId: string, title: string) => {
		setRecentSessions((current) =>
			current.map((session) =>
				session.sessionId === sessionId ? { ...session, title } : session,
			),
		);
		postToHost({
			type: "updateSessionMetadata",
			sessionId,
			metadata: { title },
		});
	}, []);

	const dismissBackgroundAgent = useCallback(async (recordId: string) => {
		setBackgroundAgentBusyId(recordId);
		setBackgroundAgentError(undefined);
		try {
			const sessions =
				await desktopClient.deleteBackgroundAgentRecord(recordId);
			setBackgroundAgentSessions(sessions);
		} catch (error) {
			setBackgroundAgentError(
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			setBackgroundAgentBusyId(undefined);
		}
	}, []);

	const openBackgroundAgentWorktree = useCallback(async (recordId: string) => {
		setBackgroundAgentBusyId(recordId);
		setBackgroundAgentError(undefined);
		try {
			await desktopClient.openBackgroundAgentWorktree(recordId);
		} catch (error) {
			setBackgroundAgentError(
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			setBackgroundAgentBusyId(undefined);
		}
	}, []);

	const content = useMemo(() => {
		if (view === "chat") {
			return (
				<Chat
					initialSessionId={selectedSessionId}
					onSessionSelected={updateChatSessionRoute}
				/>
			);
		}
		if (view === "settings") {
			return (
				<SettingsView
					initialCursorUri={cursorLinkIntent?.uri}
					initialSection={settingsSection}
					key={`${settingsSection}:${cursorLinkIntent?.key ?? ""}`}
					onClose={() => navigate("home")}
					onNavigateSection={navigateSettingsSection}
					onThemeChange={setTheme}
					theme={theme}
				/>
			);
		}
		return (
			<HomeView
				backgroundAgentBusyId={backgroundAgentBusyId}
				backgroundAgentError={backgroundAgentError}
				backgroundAgentSessions={backgroundAgentSessions}
				hubState={hubState}
				onDismissBackgroundAgent={dismissBackgroundAgent}
				onDeleteSession={deleteSession}
				onOpenBackgroundAgentWorktree={openBackgroundAgentWorktree}
				onOpenSession={openSession}
				onRenameSession={renameSession}
				onRestartHub={restartHub}
				recentSessions={recentSessions}
				restartPending={restartPending}
			/>
		);
	}, [
		hubState,
		backgroundAgentBusyId,
		backgroundAgentError,
		backgroundAgentSessions,
		cursorLinkIntent,
		deleteSession,
		dismissBackgroundAgent,
		navigate,
		navigateSettingsSection,
		openSession,
		openBackgroundAgentWorktree,
		recentSessions,
		renameSession,
		restartHub,
		restartPending,
		selectedSessionId,
		settingsSection,
		theme,
		updateChatSessionRoute,
		view,
	]);

	return (
		<Shell onNavigate={navigate} theme={theme} view={view}>
			{content}
		</Shell>
	);
}

export default App;
