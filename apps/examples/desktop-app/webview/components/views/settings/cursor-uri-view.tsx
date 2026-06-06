"use client";

import {
	AlertTriangle,
	CheckCircle2,
	Loader2,
	Play,
	Search,
} from "lucide-react";
import { useMemo, useState } from "react";
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

export function CursorUriView() {
	const [uri, setUri] = useState("");
	const [preview, setPreview] = useState<CursorUriPreviewResponse | undefined>();
	const [launch, setLaunch] = useState<CursorUriLaunchResponse | undefined>();
	const [error, setError] = useState<string | null>(null);
	const [previewing, setPreviewing] = useState(false);
	const [launching, setLaunching] = useState(false);

	const taskPrompt = previewString(preview, "taskPrompt");
	const route = previewString(preview, "route");
	const path = previewString(preview, "path");
	const paramKeys = useMemo(
		() => previewStringList(preview, "paramKeys"),
		[preview],
	);
	const configKeys = useMemo(
		() => previewStringList(preview, "configKeys"),
		[preview],
	);
	const canLaunch = isLaunchablePreview(preview);

	const runPreview = async () => {
		const trimmed = uri.trim();
		if (!trimmed) {
			setError("URI is required.");
			setPreview(undefined);
			setLaunch(undefined);
			return;
		}
		setPreviewing(true);
		setError(null);
		setLaunch(undefined);
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
	};

	const runLaunch = async () => {
		const trimmed = uri.trim();
		if (!trimmed || !canLaunch) {
			return;
		}
		setLaunching(true);
		setError(null);
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

	return (
		<ScrollArea className="h-full">
			<div className="mx-auto flex max-w-5xl flex-col gap-5 p-6">
				<div className="flex items-center justify-between gap-3">
					<div>
						<h2 className="text-lg font-semibold text-foreground">Cursor URI</h2>
					</div>
					<Badge variant={canLaunch ? "default" : "outline"}>
						{canLaunch ? "Launchable" : "Preview"}
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
							disabled={previewing || launching}
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
							disabled={!canLaunch || previewing || launching}
							onClick={() => void runLaunch()}
						>
							{launching ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Play className="size-4" />
							)}
							Launch
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

				{preview ? (
					<div className="flex flex-col gap-4 rounded-lg border border-border bg-background p-4">
						<div className="flex flex-wrap items-center gap-2">
							<Badge variant="outline">{route || "unknown"}</Badge>
							{path ? <Badge variant="secondary">{path}</Badge> : null}
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
						) : (
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
