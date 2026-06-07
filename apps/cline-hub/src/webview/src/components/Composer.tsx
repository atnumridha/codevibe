import {
	CheckIcon,
	HatGlassesIcon,
	PaperclipIcon,
	PlayIcon,
	Settings2Icon,
	SignalHigh,
	SignalLow,
	SignalMedium,
} from "lucide-react";
import {
	type ChangeEvent,
	type KeyboardEvent,
	type SyntheticEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import {
	Attachment,
	AttachmentPreview,
	AttachmentRemove,
	Attachments,
} from "@/components/ai-elements/attachments";
import {
	ModelSelector,
	ModelSelectorContent,
	ModelSelectorEmpty,
	ModelSelectorGroup,
	ModelSelectorInput,
	ModelSelectorItem,
	ModelSelectorList,
	ModelSelectorLogo,
	ModelSelectorLogoGroup,
	ModelSelectorName,
	ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import {
	PromptInput,
	PromptInputBody,
	PromptInputButton,
	PromptInputFooter,
	PromptInputHeader,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
	usePromptInputAttachments,
	usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { desktopClient } from "@/lib/desktop-client";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type {
	WebviewChatAttachments,
	WebviewOutboundMessage,
	WebviewProviderModel,
	WebviewReasonLevel,
} from "../../../webview-protocol";

type ProviderOption = Extract<
	WebviewOutboundMessage,
	{ type: "providers" }
>["providers"][number];

type ActiveMention = {
	start: number;
	end: number;
	query: string;
};

function getActiveMention(input: string, cursor: number): ActiveMention | null {
	const left = input.slice(0, cursor);
	const atIndex = left.lastIndexOf("@");
	if (atIndex < 0) {
		return null;
	}
	const before = atIndex > 0 ? left[atIndex - 1] : "";
	if (before && !/\s/.test(before)) {
		return null;
	}
	const query = left.slice(atIndex + 1);
	if (!/^[^\s@]*$/.test(query)) {
		return null;
	}
	return {
		start: atIndex,
		end: cursor,
		query,
	};
}

function PromptAttachmentsDisplay() {
	const attachments = usePromptInputAttachments();

	if (attachments.files.length === 0) {
		return null;
	}

	return (
		<Attachments variant="inline">
			{attachments.files.map((attachment) => (
				<Attachment
					data={attachment}
					key={attachment.id}
					onRemove={() => attachments.remove(attachment.id)}
				>
					<AttachmentPreview />
					<AttachmentRemove />
				</Attachment>
			))}
		</Attachments>
	);
}

function ComposerSettings({
	autoApproveTools,
	enableSpawn,
	enableTeams,
	model,
	modelSelectorOpen,
	models,
	onAutoApproveToolsChange,
	onEnableSpawnChange,
	onEnableTeamsChange,
	onModelChange,
	onModelSelectorOpenChange,
	onProviderChange,
	provider,
	providers,
	workspaceRoot,
}: {
	autoApproveTools: boolean;
	enableSpawn: boolean;
	enableTeams: boolean;
	enableTools: boolean;
	maxIterations: string;
	model: string;
	modelSelectorOpen: boolean;
	models: WebviewProviderModel[];
	onAutoApproveToolsChange: (value: boolean) => void;
	onEnableSpawnChange: (value: boolean) => void;
	onEnableTeamsChange: (value: boolean) => void;
	onEnableToolsChange: (value: boolean) => void;
	onMaxIterationsChange: (value: string) => void;
	onModelChange: (value: string) => void;
	onModelSelectorOpenChange: (value: boolean) => void;
	onProviderChange: (value: string) => void;
	onSystemPromptChange: (value: string) => void;
	provider: string;
	providers: ProviderOption[];
	systemPrompt: string;
	workspaceRoot: string;
}) {
	const selectedProvider = providers.find((item) => item.id === provider);
	const selectedModel =
		models.find((item) => item.id === model) ?? models[0] ?? undefined;

	return (
		<div className="grid gap-3 bg-background/70 p-3">
			<div className="grid gap-2 md:grid-cols-2">
				<div className="grid gap-2">
					<Label className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
						Provider
					</Label>
					<Select
						onValueChange={(value) => {
							if (value) {
								onProviderChange(value);
							}
						}}
						value={provider}
					>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Select provider" />
						</SelectTrigger>
						<SelectContent>
							{providers.map((item) => (
								<SelectItem key={item.id} value={item.id}>
									<div className="flex items-center gap-2">
										{renderProviderLogo(item.id)}
										<span>{item.name}</span>
									</div>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="grid gap-2">
					<Label className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
						Model
					</Label>
					<ModelSelector
						onOpenChange={onModelSelectorOpenChange}
						open={modelSelectorOpen}
					>
						<ModelSelectorTrigger>
							<Button className="w-full justify-between" variant="outline">
								<div className="flex min-w-0 items-center gap-2">
									{selectedProvider && renderProviderLogo(selectedProvider.id)}
									<span className="truncate">
										{selectedModel?.name || selectedModel?.id || "Select model"}
									</span>
								</div>
							</Button>
						</ModelSelectorTrigger>
						<ModelSelectorContent>
							<ModelSelectorInput placeholder="Search models..." />
							<ModelSelectorList>
								<ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
								<ModelSelectorGroup
									heading={selectedProvider?.name || "Models"}
								>
									{models.map((item) => (
										<ModelSelectorItem
											key={item.id}
											onSelect={() => {
												onModelChange(item.id);
												onModelSelectorOpenChange(false);
											}}
											value={item.id}
										>
											{selectedProvider &&
												renderProviderLogo(selectedProvider.id)}
											<ModelSelectorName>
												{item.name || item.id}
											</ModelSelectorName>
											<ModelSelectorLogoGroup>
												{selectedProvider &&
													renderProviderLogo(selectedProvider.id)}
											</ModelSelectorLogoGroup>
											{model === item.id ? (
												<CheckIcon className="ml-auto size-4" />
											) : (
												<div className="ml-auto size-4" />
											)}
										</ModelSelectorItem>
									))}
								</ModelSelectorGroup>
							</ModelSelectorList>
						</ModelSelectorContent>
					</ModelSelector>
				</div>
			</div>
			<div className="grid gap-2 md:grid-cols-2">
				<div className="grid gap-2">
					<Label
						className="text-xs uppercase tracking-[0.16em] text-muted-foreground"
						htmlFor="workspace-root"
					>
						Workspace
					</Label>
					<Input id="workspace-root" readOnly value={workspaceRoot} />
				</div>
			</div>
			<div className="grid gap-2 md:grid-cols-2">
				<Toggle
					checked={enableSpawn}
					label="Subagents"
					onChange={onEnableSpawnChange}
				/>
				<Toggle
					checked={enableTeams}
					label="Agent Teams"
					onChange={onEnableTeamsChange}
				/>
				<Toggle
					checked={autoApproveTools}
					label="Auto-approves"
					onChange={onAutoApproveToolsChange}
				/>
			</div>
		</div>
	);
}

function renderProviderLogo(providerId: string) {
	return (
		<ModelSelectorLogo className="size-3.5" provider={providerId || "openai"} />
	);
}

function Toggle({
	checked,
	label,
	onChange,
	disabled,
}: {
	checked: boolean;
	label: string;
	onChange: (value: boolean) => void;
	disabled?: boolean;
}) {
	return (
		<div className="flex items-center justify-between rounded-lg border bg-background/60 px-3 py-2">
			<Label className="text-sm" htmlFor={label}>
				{label}
			</Label>
			<Switch
				checked={checked}
				id={label}
				onCheckedChange={(value) => onChange(value)}
				disabled={disabled}
			/>
		</div>
	);
}

const ReasonLevel = {
	None: "none",
	Low: "low",
	Medium: "medium",
	High: "high",
} as const;

const reasonLevels = [
	{ value: ReasonLevel.None, label: "Thinking Off", icon: SignalHigh },
	{ value: ReasonLevel.Low, label: "Low", icon: SignalLow },
	{ value: ReasonLevel.Medium, label: "Medium", icon: SignalMedium },
	{ value: ReasonLevel.High, label: "High", icon: SignalHigh },
];

export function Composer({
	autoApproveTools,
	disabled = false,
	enableSpawn,
	enableTeams,
	enableTools,
	maxIterations,
	model,
	mode,
	modelSelectorOpen,
	models,
	onAbort,
	onAutoApproveToolsChange,
	onEnableSpawnChange,
	onEnableTeamsChange,
	onEnableToolsChange,
	onModeChange,
	onMaxIterationsChange,
	onModelChange,
	onModelSelectorOpenChange,
	onProviderChange,
	onSend,
	onSystemPromptChange,
	onReasonLevelChange,
	provider,
	providers,
	sending,
	status,
	systemPrompt,
	reasonLevel,
	workspaceRoot,
}: {
	autoApproveTools: boolean;
	disabled?: boolean;
	enableSpawn: boolean;
	enableTeams: boolean;
	enableTools: boolean;
	maxIterations: string;
	model: string;
	mode: "act" | "plan";
	modelSelectorOpen: boolean;
	models: WebviewProviderModel[];
	onAbort: () => void;
	onAutoApproveToolsChange: (value: boolean) => void;
	onEnableSpawnChange: (value: boolean) => void;
	onEnableTeamsChange: (value: boolean) => void;
	onEnableToolsChange: (value: boolean) => void;
	onModeChange: (value: "act" | "plan") => void;
	onMaxIterationsChange: (value: string) => void;
	onModelChange: (value: string) => void;
	onModelSelectorOpenChange: (value: boolean) => void;
	onProviderChange: (value: string) => void;
	onSend: (input: {
		prompt: string;
		attachments?: WebviewChatAttachments;
		attachmentCount: number;
	}) => void;
	onSystemPromptChange: (value: string) => void;
	onReasonLevelChange: (value: WebviewReasonLevel) => void;
	provider: string;
	providers: ProviderOption[];
	sending: boolean;
	status: string;
	systemPrompt: string;
	reasonLevel: WebviewReasonLevel;
	workspaceRoot: string;
}) {
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [activeMention, setActiveMention] = useState<ActiveMention | null>(
		null,
	);
	const [mentionOpen, setMentionOpen] = useState(false);
	const [mentionFiles, setMentionFiles] = useState<string[]>([]);
	const [mentionLoading, setMentionLoading] = useState(false);
	const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
	const mentionResultsCacheRef = useRef(new Map<string, string[]>());
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const controller = usePromptInputController();
	const attachments = usePromptInputAttachments();
	const selectedModel = models.find((item) => item.id === model);
	const thinkingSupported = selectedModel?.supportsThinking === true;
	const activeReasonLevel = thinkingSupported ? reasonLevel : ReasonLevel.None;
	const reasonLevelOption = Math.max(
		reasonLevels.findIndex((item) => item.value === activeReasonLevel),
		0,
	);
	const ReasonIcon = reasonLevels[reasonLevelOption].icon;

	const updateActiveMention = useCallback((input: string, cursor: number) => {
		const nextMention = getActiveMention(input, cursor);
		setActiveMention((current) => {
			if (
				current?.start === nextMention?.start &&
				current?.end === nextMention?.end &&
				current?.query === nextMention?.query
			) {
				return current;
			}
			return nextMention;
		});
		setMentionOpen(nextMention !== null);
	}, []);

	useEffect(() => {
		if (!mentionOpen || !activeMention) {
			setMentionFiles([]);
			setMentionLoading(false);
			setMentionSelectedIndex(0);
			return;
		}

		const requestKey = `${workspaceRoot}::${activeMention.query}`;
		const cached = mentionResultsCacheRef.current.get(requestKey);
		if (cached) {
			setMentionFiles(cached);
			setMentionSelectedIndex(0);
			setMentionLoading(false);
			return;
		}

		let cancelled = false;
		const timeoutId = window.setTimeout(async () => {
			if (mentionFiles.length === 0) {
				setMentionLoading(true);
			}
			try {
				const results = await desktopClient.searchWorkspaceFiles({
					workspaceRoot,
					query: activeMention.query,
					limit: 10,
				});
				if (cancelled) {
					return;
				}
				const nextResults = Array.isArray(results) ? results : [];
				mentionResultsCacheRef.current.set(requestKey, nextResults);
				setMentionFiles(nextResults);
				setMentionSelectedIndex(0);
			} catch {
				if (!cancelled && mentionFiles.length === 0) {
					setMentionFiles([]);
				}
			} finally {
				if (!cancelled) {
					setMentionLoading(false);
				}
			}
		}, 120);

		return () => {
			cancelled = true;
			window.clearTimeout(timeoutId);
		};
	}, [activeMention, mentionOpen, workspaceRoot, mentionFiles.length]);

	const insertMentionFile = useCallback(
		(filePath: string) => {
			if (!activeMention) {
				return;
			}
			const currentInput = controller.textInput.value;
			const nextInput =
				`${currentInput.slice(0, activeMention.start)}@${filePath} ` +
				currentInput.slice(activeMention.end);
			controller.textInput.setInput(nextInput);
			setMentionOpen(false);
			setActiveMention(null);
			const nextCursor = activeMention.start + filePath.length + 2;
			window.requestAnimationFrame(() => {
				textareaRef.current?.focus();
				textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
			});
		},
		[activeMention, controller.textInput],
	);

	const handleTextareaChange = useCallback(
		(event: ChangeEvent<HTMLTextAreaElement>) => {
			updateActiveMention(
				event.target.value,
				event.target.selectionStart ?? event.target.value.length,
			);
		},
		[updateActiveMention],
	);

	const handleTextareaCursorChange = useCallback(
		(event: SyntheticEvent<HTMLTextAreaElement>) => {
			updateActiveMention(
				event.currentTarget.value,
				event.currentTarget.selectionStart ?? event.currentTarget.value.length,
			);
		},
		[updateActiveMention],
	);

	const handleTextareaKeyDown = useCallback(
		(event: KeyboardEvent<HTMLTextAreaElement>) => {
			if (!mentionOpen) {
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				setMentionOpen(false);
				return;
			}
			if (mentionFiles.length === 0) {
				return;
			}
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setMentionSelectedIndex((prev) => (prev + 1) % mentionFiles.length);
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				setMentionSelectedIndex(
					(prev) => (prev - 1 + mentionFiles.length) % mentionFiles.length,
				);
				return;
			}
			if (event.key === "Enter" || event.key === "Tab") {
				event.preventDefault();
				const selectedFile = mentionFiles[mentionSelectedIndex];
				if (selectedFile) {
					insertMentionFile(selectedFile);
				}
			}
		},
		[insertMentionFile, mentionFiles, mentionOpen, mentionSelectedIndex],
	);

	return (
		<div className="relative border-t bg-background">
			<PromptInput
				accept="image/*,.txt,.md,.json,.ts,.tsx,.js,.jsx"
				globalDrop
				className="rounded-none [&>[data-slot=input-group]]:border-0! [&>[data-slot=input-group]]:ring-0! [&>[data-slot=input-group]]:has-[[data-slot=input-group-control]:focus-visible]:border-0! [&>[data-slot=input-group]]:has-[[data-slot=input-group-control]:focus-visible]:ring-0!"
				maxFiles={8}
				multiple
				onError={(error) => toast.error(error.message)}
				onSubmit={async (message: PromptInputMessage) => {
					const prompt = message.text.trim();
					if (!prompt && !message.files.length) {
						return;
					}

					let attachments: WebviewChatAttachments | undefined;
					if (message.files.length > 0) {
						const userImages = (
							await Promise.all(
								message.files.map((file) => toImageDataUrl(file.url)),
							)
						).filter((value): value is string => Boolean(value));
						if (userImages.length > 0) {
							attachments = { userImages };
						}
						if (userImages.length !== message.files.length) {
							toast.warning(
								"Only image attachments are currently sent in the VS Code chat runtime.",
							);
						}
					}

					if (!prompt && !attachments?.userImages?.length) {
						return;
					}

					onSend({
						prompt,
						attachments,
						attachmentCount: message.files.length,
					});
				}}
			>
				<PromptInputHeader>
					<PromptAttachmentsDisplay />
				</PromptInputHeader>
				<PromptInputBody>
					{mentionOpen ? (
						<div className="absolute bottom-full left-3 right-3 z-20 mb-2 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md">
							{mentionFiles.length === 0 ? (
								<div className="px-3 py-2 text-sm text-muted-foreground">
									{mentionLoading ? "Searching files..." : "No matching files"}
								</div>
							) : (
								<div className="max-h-56 overflow-y-auto py-1">
									{mentionFiles.map((filePath, index) => (
										<button
											className={[
												"block w-full truncate px-3 py-2 text-left font-mono text-xs",
												index === mentionSelectedIndex
													? "bg-accent text-accent-foreground"
													: "hover:bg-accent/60",
											].join(" ")}
											key={filePath}
											onClick={() => insertMentionFile(filePath)}
											onMouseDown={(event) => event.preventDefault()}
											onMouseEnter={() => setMentionSelectedIndex(index)}
											type="button"
										>
											@{filePath}
										</button>
									))}
									{mentionLoading ? (
										<div className="px-3 py-1 text-xs text-muted-foreground">
											Refreshing...
										</div>
									) : null}
								</div>
							)}
						</div>
					) : null}
					<PromptInputTextarea
						disabled={disabled || status.includes("Failed")}
						onChange={handleTextareaChange}
						onClick={handleTextareaCursorChange}
						onKeyDown={handleTextareaKeyDown}
						onKeyUp={handleTextareaCursorChange}
						onSelect={handleTextareaCursorChange}
						placeholder="Type @ for context and / for skills"
						ref={textareaRef}
						value={controller.textInput.value}
						className="text-sm outline-none ring-0"
					/>
				</PromptInputBody>
				<PromptInputFooter className="flex-col items-stretch gap-1 px-0">
					{settingsOpen ? (
						<ComposerSettings
							autoApproveTools={autoApproveTools}
							enableSpawn={enableSpawn}
							enableTeams={enableTeams}
							enableTools={enableTools}
							maxIterations={maxIterations}
							model={model}
							modelSelectorOpen={modelSelectorOpen}
							models={models}
							onAutoApproveToolsChange={onAutoApproveToolsChange}
							onEnableSpawnChange={onEnableSpawnChange}
							onEnableTeamsChange={onEnableTeamsChange}
							onEnableToolsChange={onEnableToolsChange}
							onMaxIterationsChange={onMaxIterationsChange}
							onModelChange={onModelChange}
							onModelSelectorOpenChange={onModelSelectorOpenChange}
							onProviderChange={onProviderChange}
							onSystemPromptChange={onSystemPromptChange}
							provider={provider}
							providers={providers}
							systemPrompt={systemPrompt}
							workspaceRoot={workspaceRoot}
						/>
					) : null}
					<div className="flex items-center justify-between gap-3">
						<PromptInputTools className="shrink-0">
							<PromptInputButton
								disabled={disabled}
								onClick={() => attachments.openFileDialog()}
								type="button"
								variant="ghost"
							>
								<PaperclipIcon className="size-3" />
							</PromptInputButton>
							<PromptInputButton
								disabled={disabled}
								onClick={() => setSettingsOpen((open) => !open)}
								type="button"
								variant={settingsOpen ? "default" : "ghost"}
							>
								<Settings2Icon className="size-3" />
								<span>
									{provider}:{model}
								</span>
							</PromptInputButton>
							<PromptInputButton
								disabled={disabled || !thinkingSupported}
								onClick={() => {
									const nextOption =
										(reasonLevelOption + 1) % reasonLevels.length;
									onReasonLevelChange(reasonLevels[nextOption].value);
								}}
								type="button"
								title={reasonLevels[reasonLevelOption].label}
								variant={
									activeReasonLevel !== ReasonLevel.None ? "default" : "ghost"
								}
							>
								<ReasonIcon className="size-3" />
							</PromptInputButton>
							<PromptInputButton
								disabled={disabled}
								onClick={() => onModeChange(mode === "act" ? "plan" : "act")}
								type="button"
								variant={mode === "plan" ? "default" : "ghost"}
								className="hidden"
							>
								{mode === "act" ? (
									<PlayIcon className="size-3" />
								) : (
									<HatGlassesIcon className="size-3" />
								)}
								{mode}
							</PromptInputButton>
							<Badge
								className="rounded-sm px-3 py-1 text-xs hidden"
								variant={status.includes("Error") ? "destructive" : "secondary"}
							>
								{status}
							</Badge>
						</PromptInputTools>
						<div className="flex items-center gap-2">
							{sending ? (
								<Button onClick={onAbort} type="button" variant="destructive">
									Abort
								</Button>
							) : null}
							<PromptInputSubmit
								disabled={disabled || status.includes("Failed")}
								status={sending ? "submitted" : "ready"}
								variant="ghost"
							/>
						</div>
					</div>
				</PromptInputFooter>
			</PromptInput>
		</div>
	);
}

async function toImageDataUrl(
	url: string | undefined,
): Promise<string | undefined> {
	if (!url) {
		return undefined;
	}
	if (url.startsWith("data:image/")) {
		return url;
	}
	if (!url.startsWith("blob:")) {
		return undefined;
	}
	try {
		const response = await fetch(url);
		const blob = await response.blob();
		if (!blob.type.startsWith("image/")) {
			return undefined;
		}
		return await new Promise((resolve) => {
			const reader = new FileReader();
			reader.onloadend = () => {
				resolve(typeof reader.result === "string" ? reader.result : undefined);
			};
			reader.onerror = () => resolve(undefined);
			reader.readAsDataURL(blob);
		});
	} catch {
		return undefined;
	}
}
