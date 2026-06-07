import {
	createStandaloneBrowserCdpAutomation,
	redactSensitiveBrowserText,
	sanitizeBrowserSnapshotResult,
	type BrowserActionInput,
	type BrowserScreenshotInput,
	type BrowserSnapshotInput,
	type ToolOperationResult,
} from "@cline/core";
import type { SidecarContext } from "./types";

type BrowserAutomation = ReturnType<typeof createStandaloneBrowserCdpAutomation>;

const sidecarBrowsers = new WeakMap<SidecarContext, BrowserAutomation>();

function safeBrowserEvaluateEnabled(): boolean {
	const value = process.env.CODEVIBE_SAFE_BROWSER_EVALUATE?.trim().toLowerCase();
	return value === "1" || value === "true" || value === "yes";
}

export function getSidecarBrowserAutomation(
	ctx: SidecarContext,
): BrowserAutomation {
	const existing = sidecarBrowsers.get(ctx);
	if (existing) return existing;
	const browser = createStandaloneBrowserCdpAutomation({
		host: "desktop-sidecar",
		safeBrowserEvaluateEnabled: safeBrowserEvaluateEnabled(),
	});
	sidecarBrowsers.set(ctx, browser);
	return browser;
}

export function getSidecarBrowserAutomationStatus(ctx: SidecarContext) {
	return getSidecarBrowserAutomation(ctx).getStatus();
}

function browserActionQuery(args?: Record<string, unknown>): string {
	const action =
		typeof args?.action === "string" && args.action.trim()
			? args.action.trim()
			: "unknown";
	const tabId =
		typeof args?.tab_id === "string" && args.tab_id.trim()
			? args.tab_id.trim()
			: "";
	return tabId ? `browser_action:${action}:${tabId}` : `browser_action:${action}`;
}

function browserTabQuery(
	toolName: "browser_snapshot" | "browser_screenshot",
	args?: Record<string, unknown>,
): string {
	const tabId =
		typeof args?.tab_id === "string" && args.tab_id.trim()
			? args.tab_id.trim()
			: "";
	return tabId ? `${toolName}:${tabId}` : toolName;
}

function browserSuccessResult(
	query: string,
	result: unknown,
	startedAt: number,
): ToolOperationResult {
	return {
		query,
		result: sanitizeBrowserSnapshotResult(result),
		success: true,
		duration: Date.now() - startedAt,
	};
}

function browserFailureResult(
	query: string,
	error: unknown,
	startedAt: number,
): ToolOperationResult {
	return {
		query,
		result: "",
		error: redactSensitiveBrowserText(
			error instanceof Error ? error.message : String(error),
		),
		success: false,
		duration: Date.now() - startedAt,
	};
}

export async function runSidecarBrowserSnapshotCommand(
	ctx: SidecarContext,
	args?: Record<string, unknown>,
): Promise<ToolOperationResult> {
	const query = browserTabQuery("browser_snapshot", args);
	const startedAt = Date.now();
	try {
		const result = await getSidecarBrowserAutomation(ctx).browserSnapshot(
			(args ?? {}) as BrowserSnapshotInput,
		);
		return browserSuccessResult(query, result, startedAt);
	} catch (error) {
		return browserFailureResult(query, error, startedAt);
	}
}

export async function runSidecarBrowserActionCommand(
	ctx: SidecarContext,
	args?: Record<string, unknown>,
): Promise<ToolOperationResult> {
	const query = browserActionQuery(args);
	const startedAt = Date.now();
	try {
		const result = await getSidecarBrowserAutomation(ctx).browserAction(
			(args ?? {}) as BrowserActionInput,
		);
		return browserSuccessResult(query, result, startedAt);
	} catch (error) {
		return browserFailureResult(query, error, startedAt);
	}
}

export async function runSidecarBrowserScreenshotCommand(
	ctx: SidecarContext,
	args?: Record<string, unknown>,
): Promise<ToolOperationResult> {
	const query = browserTabQuery("browser_screenshot", args);
	const startedAt = Date.now();
	try {
		const result = await getSidecarBrowserAutomation(ctx).browserScreenshot(
			(args ?? {}) as BrowserScreenshotInput,
		);
		return browserSuccessResult(query, result, startedAt);
	} catch (error) {
		return browserFailureResult(query, error, startedAt);
	}
}
