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
}

export const desktopClient = new HubDesktopClient();
