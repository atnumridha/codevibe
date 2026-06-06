"use client";

import {
	AlertTriangle,
	CheckCircle2,
	Database,
	FileText,
	GitBranch,
	Loader2,
	Play,
	Plug,
	Puzzle,
	Search,
	Settings,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
	DEFAULT_CODEVIBE_MODEL_ID,
	DEFAULT_CODEVIBE_PROVIDER_ID,
} from "@/hooks/chat-session/constants";
import {
	desktopClient,
	type CursorAutomationIngestResponse,
	type CursorGitActionResponse,
	type CursorMcpInstallResponse,
	type CursorPluginAddResponse,
	type CursorRuleOpenResponse,
	type CursorUriLaunchResponse,
	type CursorUriPreviewResponse,
} from "@/lib/desktop-client";

const LAUNCHABLE_AGENT_PATHS = new Set([
	"/createchat",
	"/background-agent",
	"/prompt",
	"/command",
	"/pr-review",
	"/glass",
	"/git/checkout",
	"/git/branch",
	"/git/commit",
]);

export type CursorUriIntent = {
	id: number;
	uri: string;
};

export type CursorSettingsOpenRequest = {
	query?: string;
	sourceParam?: string;
};

function previewString(
	preview: CursorUriPreviewResponse | undefined,
	key: string,
): string {
	const value = preview?.[key];
	return typeof value === "string" ? value.trim() : "";
}

function previewStringList(
	preview: CursorUriPreviewResponse | undefined,
	key: string,
): string[] {
	const value = preview?.[key];
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function isLaunchablePreview(preview: CursorUriPreviewResponse | undefined) {
	const path = previewString(preview, "path");
	const route = previewString(preview, "route");
	return Boolean(
		preview?.handled &&
			previewString(preview, "taskPrompt") &&
			path &&
			(LAUNCHABLE_AGENT_PATHS.has(path) ||
				(route === "command-file" && path === "/command")),
	);
}

function isAutomationIngestPreview(
	preview: CursorUriPreviewResponse | undefined,
) {
	return (
		preview?.handled === true &&
		previewString(preview, "route") === "automation-ingest" &&
		preview.requiresConfirmation === true &&
		preview.valid !== false
	);
}

function isMcpInstallPreview(preview: CursorUriPreviewResponse | undefined) {
	return (
		preview?.handled === true &&
		previewString(preview, "route") === "mcp-install" &&
		preview.requiresConfirmation === true
	);
}

function isSettingsPreview(preview: CursorUriPreviewResponse | undefined) {
	return (
		preview?.handled === true && previewString(preview, "route") === "settings"
	);
}

function isRuleFilePreview(preview: CursorUriPreviewResponse | undefined) {
	return (
		preview?.handled === true &&
		previewString(preview, "route") === "rule" &&
		previewString(preview, "kind") === "file" &&
		preview.requiresConfirmation === true
	);
}

function isPluginAddPreview(preview: CursorUriPreviewResponse | undefined) {
	return (
		preview?.handled === true &&
		previewString(preview, "route") === "plugin-add" &&
		preview.requiresConfirmation === true &&
		preview.requiresReview !== true
	);
}

function isGitActionPreview(preview: CursorUriPreviewResponse | undefined) {
	const route = previewString(preview, "route");
	return (
		preview?.handled === true &&
		(route === "git-checkout" ||
			route === "git-branch" ||
			route === "git-commit") &&
		preview.requiresConfirmation === true
	);
}

function JsonBlock({ value }: { value: unknown }) {
	if (!value) {
		return null;
	}
	return (
		<pre className="max-h-44 overflow-auto rounded-md border border-border/70 bg-background/70 p-2 text-xs leading-relaxed text-muted-foreground">
			{JSON.stringify(value, null, 2)}
		</pre>
	);
}

export function CursorUriView({
	incomingUri,
	onOpenSettings,
}: {
	incomingUri?: CursorUriIntent | null;
	onOpenSettings?: (request: CursorSettingsOpenRequest) => void;
}) {
	const [uri, setUri] = useState("");
	const [preview, setPreview] = useState<CursorUriPreviewResponse | undefined>();
	const [launch, setLaunch] = useState<CursorUriLaunchResponse | undefined>();
	const [ingest, setIngest] = useState<
		CursorAutomationIngestResponse | undefined
	>();
	const [mcpInstall, setMcpInstall] = useState<
		CursorMcpInstallResponse | undefined
	>();
	const [ruleOpen, setRuleOpen] = useState<CursorRuleOpenResponse | undefined>();
	const [pluginAdd, setPluginAdd] = useState<
		CursorPluginAddResponse | undefined
	>();
	const [gitAction, setGitAction] = useState<
		CursorGitActionResponse | undefined
	>();
	const [error, setError] = useState<string | null>(null);
	const [previewing, setPreviewing] = useState(false);
	const [launching, setLaunching] = useState(false);
	const [ingesting, setIngesting] = useState(false);
	const [mcpInstalling, setMcpInstalling] = useState(false);
	const [ruleOpening, setRuleOpening] = useState(false);
	const [pluginAdding, setPluginAdding] = useState(false);
	const [gitRunning, setGitRunning] = useState(false);

	const taskPrompt = previewString(preview, "taskPrompt");
	const route = previewString(preview, "route");
	const path = previewString(preview, "path");
	const relativePath = previewString(preview, "relativePath");
	const filename = previewString(preview, "filename");
	const previewReason = previewString(preview, "reason");
	const paramKeys = useMemo(
		() => previewStringList(preview, "paramKeys"),
		[preview],
	);
	const configKeys = useMemo(
		() => previewStringList(preview, "configKeys"),
		[preview],
	);
	const canLaunch = isLaunchablePreview(preview);
	const canIngest = isAutomationIngestPreview(preview);
	const canInstallMcp = isMcpInstallPreview(preview);
	const canOpenSettings = isSettingsPreview(preview) && Boolean(onOpenSettings);
	const canOpenRule = isRuleFilePreview(preview);
	const canAddPlugin = isPluginAddPreview(preview);
	const canRunGit = isGitActionPreview(preview);
	const hasActionableNonPromptPreview =
		canIngest ||
		canInstallMcp ||
		canOpenSettings ||
		canOpenRule ||
		canAddPlugin ||
		canRunGit;
	const isBusy =
		previewing ||
		launching ||
		ingesting ||
		mcpInstalling ||
		ruleOpening ||
		pluginAdding ||
		gitRunning;

	const runPreviewForUri = useCallback(async (inputUri: string) => {
		const trimmed = inputUri.trim();
		if (!trimmed) {
			setError("URI is required.");
			setPreview(undefined);
			setLaunch(undefined);
			setIngest(undefined);
			setMcpInstall(undefined);
			setRuleOpen(undefined);
			setPluginAdd(undefined);
			setGitAction(undefined);
			return;
		}
		setUri(trimmed);
		setPreviewing(true);
		setError(null);
		setLaunch(undefined);
		setIngest(undefined);
		setMcpInstall(undefined);
		setRuleOpen(undefined);
		setPluginAdd(undefined);
		setGitAction(undefined);
		try {
			const result = await desktopClient.previewCursorUri({ uri: trimmed });
			setPreview(result);
		} catch (previewError) {
			setPreview(undefined);
			setError(
				previewError instanceof Error
					? previewError.message
					: String(previewError),
			);
		} finally {
			setPreviewing(false);
		}
	}, []);

	useEffect(() => {
		if (!incomingUri?.uri) {
			return;
		}
		void runPreviewForUri(incomingUri.uri);
	}, [incomingUri?.id, incomingUri?.uri, runPreviewForUri]);

	const runPreview = async () => {
		await runPreviewForUri(uri);
	};

	const runLaunch = async () => {
		const trimmed = uri.trim();
		if (!trimmed || !canLaunch) {
			return;
		}
		setLaunching(true);
		setError(null);
		setIngest(undefined);
		setMcpInstall(undefined);
		setRuleOpen(undefined);
		setPluginAdd(undefined);
		setGitAction(undefined);
		try {
			const result = await desktopClient.launchCursorUri({
				uri: trimmed,
				confirmed: true,
				provider: DEFAULT_CODEVIBE_PROVIDER_ID,
				model: DEFAULT_CODEVIBE_MODEL_ID,
				mode: "plan",
			});
			setLaunch(result);
			if (result.preview) {
				setPreview(result.preview);
			}
		} catch (launchError) {
			setError(
				launchError instanceof Error ? launchError.message : String(launchError),
			);
		} finally {
			setLaunching(false);
		}
	};

	const runIngest = async () => {
		const trimmed = uri.trim();
		if (!trimmed || !canIngest) {
			return;
		}
		setIngesting(true);
		setError(null);
		setLaunch(undefined);
		setMcpInstall(undefined);
		setRuleOpen(undefined);
		setPluginAdd(undefined);
		setGitAction(undefined);
		try {
			const result = await desktopClient.ingestCursorAutomation({
				uri: trimmed,
				confirmed: true,
			});
			setIngest(result);
		} catch (ingestError) {
			setError(
				ingestError instanceof Error ? ingestError.message : String(ingestError),
			);
		} finally {
			setIngesting(false);
		}
	};

	const runMcpInstall = async () => {
		const trimmed = uri.trim();
		if (!trimmed || !canInstallMcp) {
			return;
		}
		setMcpInstalling(true);
		setError(null);
		setLaunch(undefined);
		setIngest(undefined);
		setRuleOpen(undefined);
		setPluginAdd(undefined);
		setGitAction(undefined);
		try {
			const result = await desktopClient.installCursorMcp({
				uri: trimmed,
				confirmed: true,
			});
			setMcpInstall(result);
		} catch (installError) {
			setError(
				installError instanceof Error
					? installError.message
					: String(installError),
			);
		} finally {
			setMcpInstalling(false);
		}
	};

	const runRuleOpen = async () => {
		const trimmed = uri.trim();
		if (!trimmed || !canOpenRule) {
			return;
		}
		setRuleOpening(true);
		setError(null);
		setLaunch(undefined);
		setIngest(undefined);
		setMcpInstall(undefined);
		setPluginAdd(undefined);
		setGitAction(undefined);
		try {
			const result = await desktopClient.openCursorRule({
				uri: trimmed,
				confirmed: true,
			});
			setRuleOpen(result);
		} catch (openError) {
			setError(openError instanceof Error ? openError.message : String(openError));
		} finally {
			setRuleOpening(false);
		}
	};

	const runPluginAdd = async () => {
		const trimmed = uri.trim();
		if (!trimmed || !canAddPlugin) {
			return;
		}
		setPluginAdding(true);
		setError(null);
		setLaunch(undefined);
		setIngest(undefined);
		setMcpInstall(undefined);
		setRuleOpen(undefined);
		setGitAction(undefined);
		try {
			const result = await desktopClient.addCursorPlugin({
				uri: trimmed,
				confirmed: true,
			});
			setPluginAdd(result);
		} catch (addError) {
			setError(addError instanceof Error ? addError.message : String(addError));
		} finally {
			setPluginAdding(false);
		}
	};

	const runGitAction = async () => {
		const trimmed = uri.trim();
		if (!trimmed || !canRunGit) {
			return;
		}
		setGitRunning(true);
		setError(null);
		setLaunch(undefined);
		setIngest(undefined);
		setMcpInstall(undefined);
		setRuleOpen(undefined);
		setPluginAdd(undefined);
		try {
			const result = await desktopClient.runCursorGitAction({
				uri: trimmed,
				confirmed: true,
			});
			setGitAction(result);
		} catch (gitError) {
			setError(gitError instanceof Error ? gitError.message : String(gitError));
		} finally {
			setGitRunning(false);
		}
	};

	const runOpenSettings = () => {
		if (!canOpenSettings) {
			return;
		}
		onOpenSettings?.({
			query: previewString(preview, "query") || undefined,
			sourceParam: previewString(preview, "sourceParam") || undefined,
		});
	};

	return (
		<ScrollArea className="h-full">
			<div className="mx-auto flex max-w-5xl flex-col gap-5 p-6">
				<div className="flex items-center justify-between gap-3">
					<div>
						<h2 className="text-lg font-semibold text-foreground">Cursor URI</h2>
					</div>
					<Badge
						variant={
							canLaunch ||
							canInstallMcp ||
							canOpenSettings ||
							canOpenRule ||
							canAddPlugin ||
							canRunGit
								? "default"
								: "outline"
						}
					>
						{canLaunch
							? "Launchable"
							: canInstallMcp
								? "Installable"
								: canOpenRule || canOpenSettings || canAddPlugin || canRunGit
									? "Openable"
									: "Preview"}
					</Badge>
				</div>

				<div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
					<div className="space-y-2">
						<Label htmlFor="cursor-uri-input">URI</Label>
						<Input
							id="cursor-uri-input"
							onChange={(event) => setUri(event.target.value)}
							placeholder="vscode://cline.cline/createchat?prompt=..."
							value={uri}
						/>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button
							disabled={isBusy}
							onClick={() => void runPreview()}
							variant="outline"
						>
							{previewing ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Search className="size-4" />
							)}
							Preview
						</Button>
						<Button
							disabled={!canLaunch || isBusy}
							onClick={() => void runLaunch()}
						>
							{launching ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Play className="size-4" />
							)}
							Launch
						</Button>
						<Button
							disabled={!canIngest || isBusy}
							onClick={() => void runIngest()}
							variant="outline"
						>
							{ingesting ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Database className="size-4" />
							)}
							Ingest
						</Button>
						<Button
							disabled={!canInstallMcp || isBusy}
							onClick={() => void runMcpInstall()}
							variant="outline"
						>
							{mcpInstalling ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Plug className="size-4" />
							)}
							Install MCP
						</Button>
						<Button
							disabled={!canOpenSettings || isBusy}
							onClick={runOpenSettings}
							variant="outline"
						>
							<Settings className="size-4" />
							Open Settings
						</Button>
						<Button
							disabled={!canOpenRule || isBusy}
							onClick={() => void runRuleOpen()}
							variant="outline"
						>
							{ruleOpening ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<FileText className="size-4" />
							)}
							Open Rule
						</Button>
						<Button
							disabled={!canAddPlugin || isBusy}
							onClick={() => void runPluginAdd()}
							variant="outline"
						>
							{pluginAdding ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Puzzle className="size-4" />
							)}
							Add Plugin
						</Button>
						<Button
							disabled={!canRunGit || isBusy}
							onClick={() => void runGitAction()}
							variant="outline"
						>
							{gitRunning ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<GitBranch className="size-4" />
							)}
							Run Git
						</Button>
					</div>
				</div>

				{error ? (
					<Alert variant="destructive">
						<AlertTriangle className="size-4" />
						<AlertTitle>Cursor URI failed</AlertTitle>
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				) : null}

				{launch ? (
					<Alert>
						<CheckCircle2 className="size-4" />
						<AlertTitle>Queued session {launch.sessionId}</AlertTitle>
						<AlertDescription>
							{launch.provider}/{launch.model} | {launch.mode}
						</AlertDescription>
					</Alert>
				) : null}

				{ingest ? (
					<Alert variant={ingest.valid ? "default" : "destructive"}>
						{ingest.valid ? (
							<CheckCircle2 className="size-4" />
						) : (
							<AlertTriangle className="size-4" />
						)}
						<AlertTitle>
							{ingest.ingested
								? `Ingested ${ingest.eventCount} event(s)`
								: "Automation ingest blocked"}
						</AlertTitle>
						<AlertDescription>
							{ingest.queuedRunCount} queued run(s),{" "}
							{ingest.rejectedCount} rejected line(s)
							{ingest.matchedSpecIds.length > 0
								? ` | specs: ${ingest.matchedSpecIds.join(", ")}`
								: ""}
						</AlertDescription>
					</Alert>
				) : null}

				{mcpInstall ? (
					<Alert variant={mcpInstall.installed ? "default" : "destructive"}>
						{mcpInstall.installed ? (
							<CheckCircle2 className="size-4" />
						) : (
							<AlertTriangle className="size-4" />
						)}
						<AlertTitle>
							{mcpInstall.installed
								? `Installed MCP server ${mcpInstall.serverName}`
								: "MCP install blocked"}
						</AlertTitle>
						<AlertDescription>
							{mcpInstall.transportType} |{" "}
							{mcpInstall.replaced ? "replaced" : "added"}
							{mcpInstall.urlOrigin ? ` | ${mcpInstall.urlOrigin}` : ""}
						</AlertDescription>
					</Alert>
				) : null}

				{ruleOpen ? (
					<Alert variant={ruleOpen.actionable ? "default" : "destructive"}>
						{ruleOpen.actionable ? (
							<CheckCircle2 className="size-4" />
						) : (
							<AlertTriangle className="size-4" />
						)}
						<AlertTitle>
							{ruleOpen.actionable
								? `${ruleOpen.created ? "Created" : "Opened"} rule ${ruleOpen.filename ?? ""}`
								: "Rule route needs review"}
						</AlertTitle>
						<AlertDescription>
							{ruleOpen.actionable
								? (ruleOpen.relativePath ?? ruleOpen.filePath ?? "")
								: (ruleOpen.reason ?? "This rule payload was not written.")}
						</AlertDescription>
					</Alert>
				) : null}

				{pluginAdd ? (
					<Alert variant={pluginAdd.installed ? "default" : "destructive"}>
						{pluginAdd.installed ? (
							<CheckCircle2 className="size-4" />
						) : (
							<AlertTriangle className="size-4" />
						)}
						<AlertTitle>
							{pluginAdd.installed
								? `Installed plugin ${pluginAdd.sourceLabel ?? ""}`
								: "Plugin install blocked"}
						</AlertTitle>
						<AlertDescription>
							{pluginAdd.installed
								? `${pluginAdd.entryCount ?? 0} entry file(s)`
								: (pluginAdd.reason ?? pluginAdd.detail ?? "Review required.")}
						</AlertDescription>
					</Alert>
				) : null}

				{gitAction ? (
					<Alert variant={gitAction.executed ? "default" : "destructive"}>
						{gitAction.executed ? (
							<CheckCircle2 className="size-4" />
						) : (
							<AlertTriangle className="size-4" />
						)}
						<AlertTitle>
							{gitAction.executed
								? `Ran ${gitAction.kind}`
								: "Git action blocked"}
						</AlertTitle>
						<AlertDescription>
							{gitAction.executed
								? (gitAction.commitHash ??
									gitAction.currentBranch ??
									gitAction.target ??
									gitAction.branch ??
									"done")
								: (gitAction.reason ?? "Review the repository state first.")}
						</AlertDescription>
					</Alert>
				) : null}

				{preview ? (
					<div className="flex flex-col gap-4 rounded-lg border border-border bg-background p-4">
						<div className="flex flex-wrap items-center gap-2">
							<Badge variant="outline">{route || "unknown"}</Badge>
							{path ? <Badge variant="secondary">{path}</Badge> : null}
							{relativePath ? (
								<Badge variant="secondary">{relativePath}</Badge>
							) : null}
							{filename && !relativePath ? (
								<Badge variant="secondary">{filename}</Badge>
							) : null}
							{preview.requiresConfirmation ? (
								<Badge variant="outline">Confirmation</Badge>
							) : null}
						</div>
						{paramKeys.length > 0 ? (
							<div className="text-xs text-muted-foreground">
								Params: {paramKeys.join(", ")}
							</div>
						) : null}
						{configKeys.length > 0 ? (
							<div className="text-xs text-muted-foreground">
								Config: {configKeys.join(", ")}
							</div>
						) : null}
						{previewReason ? (
							<div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
								{previewReason}
							</div>
						) : null}
						{taskPrompt ? (
							<div className="space-y-2">
								<Label htmlFor="cursor-uri-task-prompt">Task Prompt</Label>
								<Textarea
									className="min-h-40 font-mono text-xs"
									id="cursor-uri-task-prompt"
									readOnly
									value={taskPrompt}
								/>
							</div>
						) : hasActionableNonPromptPreview ? null : (
							<div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
								This route is available for preview only.
							</div>
						)}
						<JsonBlock value={preview.commandFile} />
					</div>
				) : null}
			</div>
		</ScrollArea>
	);
}
