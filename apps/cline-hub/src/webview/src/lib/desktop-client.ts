"use client";

import type {
	WebviewOutboundMessage,
	WebviewSessionSummary,
} from "../../../webview-protocol";
import { postToHost } from "../vscode";

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeoutId: ReturnType<typeof setTimeout>;
};

export type BrowserAutomationStatus = Record<string, unknown> & {
	available: boolean;
	status: "configured" | "unavailable";
	host: string;
	cursorCompatibility: true;
	toolNames: string[];
	executorNames: string[];
	actions: string[];
	readOnlyTools: string[];
	mutatingActions: string[];
	safeBrowserEvaluateEnabled: boolean;
	evaluatePolicy: "explicitly-enabled" | "disabled-by-default";
	executors: Record<string, "configured" | "missing">;
	reason?: string;
	nextStep?: string;
};

export type BrowserToolResult = {
	query: string;
	result: unknown;
	error?: string;
	success: boolean;
};

export type BrowserActionInput = {
	action:
		| "launch"
		| "click"
		| "type"
		| "scroll_down"
		| "scroll_up"
		| "evaluate"
		| "close";
	tab_id?: string;
	url?: string;
	coordinate?: string;
	text?: string;
};

export type BrowserSnapshotInput = {
	tab_id?: string;
	include_screenshot?: boolean;
	include_logs?: boolean;
};

export type BrowserScreenshotInput = {
	tab_id?: string;
	full_page?: boolean;
};

export type CursorUriPreviewInput = {
	uri: string;
	workspaceRoot?: string;
	workspaceRoots?: string[];
	maxCommandFileBytes?: number;
	maxRuleFileBytes?: number;
};

export type CursorUriPreviewResponse = Record<string, unknown> & {
	handled: boolean;
	route?: string;
	path?: string;
	requiresConfirmation?: boolean;
	taskPrompt?: string;
	paramKeys?: string[];
	configKeys?: string[];
};

export type CursorMcpInstallInput = CursorUriPreviewInput & {
	confirmed: true;
};

export type CursorAutomationIngestInput = CursorUriPreviewInput & {
	confirmed: true;
};

export type CursorAutomationIngestResponse = Record<string, unknown> & {
	handled: true;
	route: "automation-ingest";
	confirmed: boolean;
	ingested: boolean;
	valid: boolean;
	strict: boolean;
	strictFailed: boolean;
	eventCount: number;
	rejectedCount: number;
	queuedRunCount: number;
	duplicateCount: number;
	matchedSpecIds: string[];
	workspaceRoot: string;
};

export type CursorUriLaunchInput = CursorUriPreviewInput & {
	confirmed: true;
	provider?: string;
	model?: string;
};

export type CursorUriLaunchResponse = Record<string, unknown> & {
	handled: true;
	launched: true;
	route: string;
	path?: string;
	backgroundAgent: boolean;
	glass?: boolean;
	backgroundAgentDetails?: Record<string, unknown>;
	sessionId: string;
	provider: string;
	model: string;
	mode: "plan";
	queued: boolean;
	metadata: Record<string, unknown>;
	preview: CursorUriPreviewResponse;
};

export type CursorMcpInstallResponse = Record<string, unknown> & {
	handled: true;
	route: "mcp-install";
	confirmed: boolean;
	installed: boolean;
	serverName: string;
	source: "config" | "direct";
	transportType: string;
	settingsPath: string;
	replaced: boolean;
	urlOrigin?: string;
	command?: string;
	argCount?: number;
	envKeys?: string[];
	headerKeys?: string[];
};

export type CursorRuleOpenInput = CursorUriPreviewInput & {
	confirmed: true;
	open?: boolean;
};

export type CursorRuleOpenResponse = Record<string, unknown> & {
	handled: true;
	route: "rule";
	kind: "file" | "review";
	confirmed: boolean;
	actionable: boolean;
	created: boolean;
	opened: boolean;
	workspaceRoot: string;
	filename?: string;
	relativePath?: string;
	filePath?: string;
	reason?: string;
	name?: string;
	path?: string;
};

export type CursorPluginAddInput = CursorUriPreviewInput & {
	confirmed: true;
	force?: boolean;
};

export type CursorPluginAddResponse = Record<string, unknown> & {
	handled: true;
	route: "plugin-add";
	confirmed: boolean;
	force?: boolean;
	installed: boolean;
	actionable: boolean;
	requiresReview: boolean;
	workspaceRoot: string;
	sourceParam?: "id" | "name" | "url" | "config";
	sourceConfigKey?: "source" | "id" | "name" | "url";
	sourceLabel?: string;
	reason?: string;
	detail?: string;
	paramKeys: string[];
	configKeys: string[];
	installPath?: string;
	entryCount?: number;
	entryPaths?: string[];
};

export type CursorGitActionInput = CursorUriPreviewInput & {
	confirmed: true;
};

export type CursorGitActionResponse = Record<string, unknown> & {
	handled: true;
	route: "git";
	kind: "git-checkout" | "git-branch" | "git-commit";
	confirmed: boolean;
	actionable: boolean;
	executed: boolean;
	workspaceRoot: string;
	paramKeys: string[];
	command?: string[];
	target?: string;
	branch?: string;
	base?: string;
	checkout?: boolean;
	message?: string;
	commitHash?: string;
	currentBranch?: string;
	dirty: boolean;
	statusEntryCount: number;
	reason?: string;
};

export type WorkspaceFileSearchInput = {
	workspaceRoot?: string;
	cwd?: string;
	query?: string;
	limit?: number;
	cursorRetrievalIndexingPrivacyGate?: boolean;
};

const REQUEST_TIMEOUT_MS = 120_000;

class HubDesktopClient {
	private requestCounter = 0;
	private readonly pending = new Map<string, PendingRequest>();

	constructor() {
		if (typeof window !== "undefined") {
			window.addEventListener("message", (event) => {
				this.handleMessage(event as MessageEvent<WebviewOutboundMessage>);
			});
		}
	}

	private handleMessage(event: MessageEvent<WebviewOutboundMessage>) {
		const message = event.data;
		if (
			!message ||
			typeof message !== "object" ||
			message.type !== "desktopCommandResult"
		) {
			return;
		}

		const pending = this.pending.get(message.id);
		if (!pending) {
			return;
		}
		clearTimeout(pending.timeoutId);
		this.pending.delete(message.id);
		if (message.ok) {
			pending.resolve(message.result);
			return;
		}
		pending.reject(new Error(message.error));
	}

	async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
		const id = `desktop_${Date.now()}_${this.requestCounter++}`;
		return await new Promise<T>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Timed out waiting for desktop command: ${command}`));
			}, REQUEST_TIMEOUT_MS);
			this.pending.set(id, {
				resolve: (value) => resolve(value as T),
				reject,
				timeoutId,
			});
			postToHost({ type: "desktopCommand", id, command, args });
		});
	}

	async listBackgroundAgentSessions(limit = 300): Promise<WebviewSessionSummary[]> {
		return await this.invoke<WebviewSessionSummary[]>(
			"list_background_agent_sessions",
			{ limit },
		);
	}

	async getBrowserAutomationStatus(): Promise<BrowserAutomationStatus> {
		return await this.invoke<BrowserAutomationStatus>(
			"browser_automation_status",
		);
	}

	async browserSnapshot(input: BrowserSnapshotInput = {}): Promise<BrowserToolResult> {
		return await this.invoke<BrowserToolResult>("browser_snapshot", input);
	}

	async browserAction(input: BrowserActionInput): Promise<BrowserToolResult> {
		return await this.invoke<BrowserToolResult>("browser_action", input);
	}

	async browserScreenshot(
		input: BrowserScreenshotInput = {},
	): Promise<BrowserToolResult> {
		return await this.invoke<BrowserToolResult>("browser_screenshot", input);
	}

	async previewCursorUri(
		input: CursorUriPreviewInput,
	): Promise<CursorUriPreviewResponse> {
		return await this.invoke<CursorUriPreviewResponse>(
			"cursor_uri_preview",
			input,
		);
	}

	async ingestCursorAutomation(
		input: CursorAutomationIngestInput,
	): Promise<CursorAutomationIngestResponse> {
		return await this.invoke<CursorAutomationIngestResponse>(
			"cursor_automation_ingest",
			{
				uri: input.uri,
				confirmed: input.confirmed,
				...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
				...(input.workspaceRoots ? { workspaceRoots: input.workspaceRoots } : {}),
				...(input.maxCommandFileBytes !== undefined
					? { maxCommandFileBytes: input.maxCommandFileBytes }
					: {}),
				...(input.maxRuleFileBytes !== undefined
					? { maxRuleFileBytes: input.maxRuleFileBytes }
					: {}),
			},
		);
	}

	async launchCursorUri(
		input: CursorUriLaunchInput,
	): Promise<CursorUriLaunchResponse> {
		return await this.invoke<CursorUriLaunchResponse>("cursor_uri_launch", {
			uri: input.uri,
			confirmed: input.confirmed,
			...(input.provider ? { provider: input.provider } : {}),
			...(input.model ? { model: input.model } : {}),
			...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
			...(input.workspaceRoots ? { workspaceRoots: input.workspaceRoots } : {}),
			...(input.maxCommandFileBytes !== undefined
				? { maxCommandFileBytes: input.maxCommandFileBytes }
				: {}),
			...(input.maxRuleFileBytes !== undefined
				? { maxRuleFileBytes: input.maxRuleFileBytes }
				: {}),
		});
	}

	async installCursorMcp(
		input: CursorMcpInstallInput,
	): Promise<CursorMcpInstallResponse> {
		return await this.invoke<CursorMcpInstallResponse>("cursor_mcp_install", {
			uri: input.uri,
			confirmed: input.confirmed,
			...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
			...(input.workspaceRoots ? { workspaceRoots: input.workspaceRoots } : {}),
			...(input.maxCommandFileBytes !== undefined
				? { maxCommandFileBytes: input.maxCommandFileBytes }
				: {}),
			...(input.maxRuleFileBytes !== undefined
				? { maxRuleFileBytes: input.maxRuleFileBytes }
				: {}),
		});
	}

	async openCursorRule(
		input: CursorRuleOpenInput,
	): Promise<CursorRuleOpenResponse> {
		return await this.invoke<CursorRuleOpenResponse>("cursor_rule_open", {
			uri: input.uri,
			confirmed: input.confirmed,
			...(input.open !== undefined ? { open: input.open } : {}),
			...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
			...(input.workspaceRoots ? { workspaceRoots: input.workspaceRoots } : {}),
			...(input.maxCommandFileBytes !== undefined
				? { maxCommandFileBytes: input.maxCommandFileBytes }
				: {}),
			...(input.maxRuleFileBytes !== undefined
				? { maxRuleFileBytes: input.maxRuleFileBytes }
				: {}),
		});
	}

	async addCursorPlugin(
		input: CursorPluginAddInput,
	): Promise<CursorPluginAddResponse> {
		return await this.invoke<CursorPluginAddResponse>("cursor_plugin_add", {
			uri: input.uri,
			confirmed: input.confirmed,
			...(input.force !== undefined ? { force: input.force } : {}),
			...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
			...(input.workspaceRoots ? { workspaceRoots: input.workspaceRoots } : {}),
			...(input.maxCommandFileBytes !== undefined
				? { maxCommandFileBytes: input.maxCommandFileBytes }
				: {}),
			...(input.maxRuleFileBytes !== undefined
				? { maxRuleFileBytes: input.maxRuleFileBytes }
				: {}),
		});
	}

	async runCursorGitAction(
		input: CursorGitActionInput,
	): Promise<CursorGitActionResponse> {
		return await this.invoke<CursorGitActionResponse>("cursor_git_action", {
			uri: input.uri,
			confirmed: input.confirmed,
			...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
			...(input.workspaceRoots ? { workspaceRoots: input.workspaceRoots } : {}),
			...(input.maxCommandFileBytes !== undefined
				? { maxCommandFileBytes: input.maxCommandFileBytes }
				: {}),
			...(input.maxRuleFileBytes !== undefined
				? { maxRuleFileBytes: input.maxRuleFileBytes }
				: {}),
		});
	}

	async searchWorkspaceFiles(
		input: WorkspaceFileSearchInput = {},
	): Promise<string[]> {
		return await this.invoke<string[]>("search_workspace_files", input);
	}
}

export const desktopClient = new HubDesktopClient();
