import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import type { CodeVibeCompatibilityStatus } from "@shared/ExtensionMessage"
import type { CursorNdjsonIngestStatus } from "@shared/proto/cline/ui"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { Badge } from "@/components/ui/badge"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { FileServiceClient, UiServiceClient } from "@/services/grpc-client"
import Section from "../Section"
import {
	buildCursorUriPreview,
	CURSOR_COMPATIBILITY_SURFACES,
	CURSOR_COMPATIBLE_ROUTE_LABELS,
} from "./cursorCompatibilityPreview"

interface CursorCompatibilitySectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const EXAMPLES = [
	{
		label: "Chat",
		uri: "codevibe://createchat?prompt=Review%20the%20current%20diff",
	},
	{
		label: "MCP",
		uri: "codevibe://mcp/install?name=docs&url=https%3A%2F%2Fmcp.example.com",
	},
	{
		label: "Background",
		uri: "codevibe://background-agent?prompt=Investigate%20flaky%20tests&repo=owner%2Frepo",
	},
	{
		label: "Plugin",
		uri: "codevibe://plugin/add?id=docs-helper&replace=true",
	},
	{
		label: "Git",
		uri: "codevibe://git/checkout?branch=feature%2Fdemo",
	},
] as const

type LaunchStatus =
	| { kind: "success"; message: string }
	| { kind: "error"; message: string }

type CompatibilityBadgeVariant = "success" | "warning" | "danger" | "outline" | "info"

const DEFAULT_NDJSON_STATUS: CursorNdjsonIngestStatus = {
	running: false,
	bindAddress: "127.0.0.1",
	port: 0,
	url: "",
}

function yesNoBadge(value: boolean): { label: string; variant: CompatibilityBadgeVariant } {
	return value ? { label: "On", variant: "success" } : { label: "Off", variant: "warning" }
}

function renderStatusTile(
	label: string,
	detail: string,
	badge: { label: string; variant: CompatibilityBadgeVariant },
) {
	return (
		<div className="flex min-w-0 flex-col gap-1 rounded border border-input-foreground/20 bg-input-background/35 p-2">
			<div className="flex items-center justify-between gap-2">
				<span className="truncate text-xs font-medium text-foreground">{label}</span>
				<Badge variant={badge.variant}>{badge.label}</Badge>
			</div>
			<div className="truncate text-[11px] text-foreground/65">{detail}</div>
		</div>
	)
}

type SandboxRuntimeSummary = CodeVibeCompatibilityStatus["sandboxRuntime"]

function sandboxRuntimeBadge(runtime: SandboxRuntimeSummary): { label: string; variant: CompatibilityBadgeVariant } {
	switch (runtime.status) {
		case "loaded":
			return { label: "loaded", variant: "success" }
		case "invalid":
			return { label: "invalid", variant: "warning" }
		case "disabled":
			return { label: "disabled", variant: "danger" }
		default:
			return { label: "missing", variant: "outline" }
	}
}

function sandboxRuntimeDetail(runtime: SandboxRuntimeSummary, configuredPolicy: string): string {
	return `Configured ${configuredPolicy}; access ${runtime.effectiveAccess}; writes ${runtime.writablePathCount}; network ${runtime.networkDefault}.`
}

const CursorCompatibilitySection = ({ renderSectionHeader }: CursorCompatibilitySectionProps) => {
	const {
		browserSettings,
		compatibilityStatus,
		enableParallelToolCalling,
		openAiCodexIsAuthenticated,
		subagentsEnabled,
		vscodeTerminalExecutionMode,
		worktreesEnabled,
	} = useExtensionState()
	const [uri, setUri] = useState("")
	const [isLaunching, setIsLaunching] = useState(false)
	const [status, setStatus] = useState<LaunchStatus | null>(null)
	const [ndjsonStatus, setNdjsonStatus] = useState<CursorNdjsonIngestStatus>(DEFAULT_NDJSON_STATUS)
	const [ndjsonBusyAction, setNdjsonBusyAction] = useState<string | null>(null)
	const [ndjsonMessage, setNdjsonMessage] = useState<LaunchStatus | null>(null)
	const preview = useMemo(() => buildCursorUriPreview(uri), [uri])
	const dashboard = compatibilityStatus ?? {
		enabled: true,
		deepLinksEnabled: true,
		retrievalIndexingPrivacyGate: true,
		sandboxPolicy: "prompt" as const,
		sandboxRuntime: {
			status: "missing" as const,
			effectiveAccess: "disabled" as const,
			readablePathCount: 0,
			writablePathCount: 0,
			networkDefault: "deny" as const,
			networkAllowCount: 0,
			blockGitWrites: false,
			allowTerminalAutoApprove: false,
		},
		safeBrowserEvaluateEnabled: false,
		effectiveBrowserEvaluateEnabled: !!browserSettings.allowBrowserEvaluate,
		openAiCodexAuthSource: "codexHome" as const,
		openAiCodexAuthenticated: !!openAiCodexIsAuthenticated,
	}

	const refreshNdjsonStatus = useCallback(async () => {
		const nextStatus = await UiServiceClient.getCursorNdjsonIngestStatus(EmptyRequest.create({}))
		setNdjsonStatus(nextStatus)
		return nextStatus
	}, [])

	useEffect(() => {
		void refreshNdjsonStatus().catch((error) => {
			setNdjsonMessage({
				kind: "error",
				message: error instanceof Error ? error.message : "Unable to read NDJSON status.",
			})
		})
	}, [refreshNdjsonStatus])

	const runNdjsonAction = useCallback(
		async (
			action: "start" | "stop" | "reassign" | "copyCurl" | "refresh",
			operation: () => Promise<CursorNdjsonIngestStatus | string>,
		) => {
			setNdjsonBusyAction(action)
			setNdjsonMessage(null)
			try {
				const result = await operation()
				if (typeof result === "string") {
					await FileServiceClient.copyToClipboard(StringRequest.create({ value: result }))
					setNdjsonMessage({ kind: "success", message: "Copied NDJSON ingest curl command." })
					await refreshNdjsonStatus()
				} else {
					setNdjsonStatus(result)
					const state = result.running && result.url ? `${result.url}/ingest` : "not running"
					setNdjsonMessage({ kind: "success", message: `NDJSON ingest is ${state}.` })
				}
			} catch (error) {
				setNdjsonMessage({
					kind: "error",
					message: error instanceof Error ? error.message : "NDJSON ingest action failed.",
				})
			} finally {
				setNdjsonBusyAction(null)
			}
		},
		[refreshNdjsonStatus],
	)

	const launchUri = useCallback(async () => {
		const trimmedUri = uri.trim()
		if (!trimmedUri) {
			setStatus({ kind: "error", message: "Enter a CodeVibe or compatible URI." })
			return
		}

		setIsLaunching(true)
		setStatus(null)

		try {
			const result = await UiServiceClient.handleUri(StringRequest.create({ value: trimmedUri }))
			setStatus(
				result.value
					? { kind: "success", message: "URI accepted." }
					: { kind: "error", message: "URI was rejected or cancelled." },
			)
		} catch (error) {
			setStatus({
				kind: "error",
				message: error instanceof Error ? error.message : "URI handling failed.",
			})
		} finally {
			setIsLaunching(false)
		}
	}, [uri])

	const handleSubmit = useCallback(
		(event: FormEvent<HTMLFormElement>) => {
			event.preventDefault()
			void launchUri()
		},
		[launchUri],
	)

	return (
		<div>
			{renderSectionHeader("cursor-compat")}
			<Section>
				<div className="mb-2 flex items-center justify-between gap-2">
					<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider">Live Status</div>
					<Badge variant={dashboard.enabled ? "success" : "danger"}>
						{dashboard.enabled ? "Compatibility on" : "Compatibility off"}
					</Badge>
				</div>
				<div className="grid grid-cols-2 gap-2">
					{renderStatusTile(
						"Codex auth",
						`${dashboard.openAiCodexAuthSource} provider source`,
						{
							label: dashboard.openAiCodexAuthenticated || openAiCodexIsAuthenticated ? "Ready" : "Needs sign-in",
							variant: dashboard.openAiCodexAuthenticated || openAiCodexIsAuthenticated ? "success" : "warning",
						},
					)}
					{renderStatusTile(
						"Deep links",
						"Validated Cursor-style route families",
						yesNoBadge(dashboard.deepLinksEnabled),
					)}
					{renderStatusTile(
						"Retrieval privacy",
						".cursorignore and .cursorindexingignore gate search/indexing",
						yesNoBadge(dashboard.retrievalIndexingPrivacyGate),
					)}
					{renderStatusTile(
						"Sandbox policy",
						sandboxRuntimeDetail(dashboard.sandboxRuntime, dashboard.sandboxPolicy),
						sandboxRuntimeBadge(dashboard.sandboxRuntime),
					)}
					{renderStatusTile(
						"Browser evaluate",
						"Effective browser JavaScript evaluation gate",
						yesNoBadge(dashboard.effectiveBrowserEvaluateEnabled),
					)}
					{renderStatusTile(
						"Parallel agents",
						"Subagents, worktrees, and parallel tool calls",
						{
							label: subagentsEnabled || worktreesEnabled?.user || enableParallelToolCalling ? "Ready" : "Manual",
							variant: subagentsEnabled || worktreesEnabled?.user || enableParallelToolCalling ? "success" : "outline",
						},
					)}
					{renderStatusTile(
						"Terminal mode",
						"Inline command execution surface",
						{
							label: vscodeTerminalExecutionMode === "backgroundExec" ? "Background" : "VS Code",
							variant: "outline",
						},
					)}
					{renderStatusTile(
						"Safe evaluate setting",
						"Compatibility override for trusted browser automation",
						yesNoBadge(dashboard.safeBrowserEvaluateEnabled),
					)}
				</div>
			</Section>
			<Section>
				<div className="mb-2 flex items-center justify-between gap-2">
					<div>
						<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider">NDJSON Ingest</div>
						<div className="mt-1 text-xs text-foreground/65">
							{ndjsonStatus.running && ndjsonStatus.url
								? `${ndjsonStatus.url}/ingest`
								: `Stopped on ${ndjsonStatus.bindAddress || "127.0.0.1"}`}
						</div>
					</div>
					<Badge variant={ndjsonStatus.running ? "success" : "outline"}>
						{ndjsonStatus.running ? "Running" : "Stopped"}
					</Badge>
				</div>
				<div className="flex flex-wrap gap-2">
					<VSCodeButton
						appearance="secondary"
						disabled={!!ndjsonBusyAction}
						onClick={() =>
							void runNdjsonAction("refresh", () =>
								UiServiceClient.getCursorNdjsonIngestStatus(EmptyRequest.create({})),
							)
						}
						type="button">
						{ndjsonBusyAction === "refresh" ? "Refreshing..." : "Refresh"}
					</VSCodeButton>
					<VSCodeButton
						appearance="secondary"
						disabled={!!ndjsonBusyAction || ndjsonStatus.running}
						onClick={() =>
							void runNdjsonAction("start", () => UiServiceClient.startCursorNdjsonIngest(EmptyRequest.create({})))
						}
						type="button">
						{ndjsonBusyAction === "start" ? "Starting..." : "Start"}
					</VSCodeButton>
					<VSCodeButton
						appearance="secondary"
						disabled={!!ndjsonBusyAction || !ndjsonStatus.running}
						onClick={() =>
							void runNdjsonAction("stop", () => UiServiceClient.stopCursorNdjsonIngest(EmptyRequest.create({})))
						}
						type="button">
						{ndjsonBusyAction === "stop" ? "Stopping..." : "Stop"}
					</VSCodeButton>
					<VSCodeButton
						appearance="secondary"
						disabled={!!ndjsonBusyAction}
						onClick={() =>
							void runNdjsonAction("reassign", () =>
								UiServiceClient.reassignCursorNdjsonIngestPort(EmptyRequest.create({})),
							)
						}
						type="button">
						{ndjsonBusyAction === "reassign" ? "Reassigning..." : "Reassign Port"}
					</VSCodeButton>
					<VSCodeButton
						appearance="secondary"
						disabled={!!ndjsonBusyAction}
						onClick={() =>
							void runNdjsonAction("copyCurl", async () => {
								const command = await UiServiceClient.getCursorNdjsonIngestCurlCommand(EmptyRequest.create({}))
								return command.value
							})
						}
						type="button">
						{ndjsonBusyAction === "copyCurl" ? "Copying..." : "Copy curl"}
					</VSCodeButton>
				</div>
				{ndjsonMessage && (
					<div
						className={
							ndjsonMessage.kind === "success"
								? "mt-2 text-xs text-success"
								: "mt-2 text-xs text-(--vscode-errorForeground)"
						}
						role="status">
						{ndjsonMessage.message}
					</div>
				)}
			</Section>
			<Section>
				<form className="flex flex-col gap-3" onSubmit={handleSubmit}>
					<div className="flex flex-col gap-1">
						<label className="text-xs font-medium text-foreground/80" htmlFor="cursor-compatible-uri">
							URI
						</label>
						<textarea
							className="min-h-24 w-full resize-y rounded border border-input-border bg-input-background p-2 text-sm text-foreground outline-none focus:border-button-background"
							id="cursor-compatible-uri"
							onChange={(event) => {
								setUri((event.target as HTMLTextAreaElement).value)
								setStatus(null)
							}}
							placeholder="codevibe://createchat?prompt=..."
							rows={4}
							value={uri}
						/>
					</div>

					<div className="flex flex-wrap gap-2">
						{EXAMPLES.map((example) => (
							<VSCodeButton
								appearance="secondary"
								key={example.label}
								onClick={() => {
									setUri(example.uri)
									setStatus(null)
								}}
								type="button">
								{example.label}
							</VSCodeButton>
						))}
					</div>

					<div className="flex flex-col gap-2">
						<div className="flex items-center gap-2">
							<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider">Preview</div>
							{preview.redacted && <Badge variant="outline">redacted</Badge>}
							{preview.route && <Badge variant="info">{preview.route}</Badge>}
						</div>
						<pre
							aria-label="Redacted URI preview"
							className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-input-foreground/20 bg-input-background/40 p-2 text-xs">
							{preview.text}
						</pre>
					</div>

					<VSCodeButton disabled={isLaunching || !uri.trim()} type="submit">
						{isLaunching ? "Launching..." : "Launch URI"}
					</VSCodeButton>

					{status && (
						<div
							className={
								status.kind === "success"
									? "text-xs text-success"
									: "text-xs text-(--vscode-errorForeground)"
							}
							role="status">
							{status.message}
						</div>
					)}
				</form>
			</Section>
			<Section>
				<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider">Routes</div>
				<div className="flex flex-wrap gap-1.5">
					{CURSOR_COMPATIBLE_ROUTE_LABELS.map((route) => (
						<Badge key={route.path} variant={preview.route === route.path ? "info" : "outline"}>
							{route.label}: {route.path}
						</Badge>
					))}
				</div>
			</Section>
			<Section>
				<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider">Surfaces</div>
				<div className="flex flex-wrap gap-1.5">
					{CURSOR_COMPATIBILITY_SURFACES.map((surface) => (
						<Badge key={surface} variant="outline">
							{surface}
						</Badge>
					))}
				</div>
			</Section>
		</div>
	)
}

export default CursorCompatibilitySection
