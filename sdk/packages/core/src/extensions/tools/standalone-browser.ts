import type { ToolOperationResult } from "./types";

export const STANDALONE_BROWSER_TOOL_NAMES = [
	"browser_snapshot",
	"browser_action",
	"browser_screenshot",
] as const;

export const STANDALONE_BROWSER_EXECUTOR_NAMES = [
	"browserSnapshot",
	"browserAction",
	"browserScreenshot",
] as const;

export const STANDALONE_BROWSER_ACTIONS = [
	"launch",
	"click",
	"type",
	"scroll_down",
	"scroll_up",
	"evaluate",
	"close",
] as const;

export type StandaloneBrowserAutomationStatus = {
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
	executors: {
		browserSnapshot: "configured" | "missing";
		browserAction: "configured" | "missing";
		browserScreenshot: "configured" | "missing";
	};
	reason?: string;
	nextStep?: string;
};

export type StandaloneBrowserAutomationStatusInput = {
	host: string;
	hasBrowserSnapshotExecutor?: boolean;
	hasBrowserActionExecutor?: boolean;
	hasBrowserScreenshotExecutor?: boolean;
	safeBrowserEvaluateEnabled?: boolean;
	unavailableReason?: string;
	nextStep?: string;
};

const STANDALONE_BROWSER_UNAVAILABLE_REASON =
	"Standalone browser automation executor is not configured for this host yet.";

const STANDALONE_BROWSER_NEXT_STEP =
	"Register host browserSnapshot, browserAction, and browserScreenshot executors before enabling browser automation tools.";

function executorState(configured: boolean): "configured" | "missing" {
	return configured ? "configured" : "missing";
}

export function getStandaloneBrowserAutomationStatus(
	input: StandaloneBrowserAutomationStatusInput,
): StandaloneBrowserAutomationStatus {
	const hasBrowserSnapshotExecutor = input.hasBrowserSnapshotExecutor === true;
	const hasBrowserActionExecutor = input.hasBrowserActionExecutor === true;
	const hasBrowserScreenshotExecutor =
		input.hasBrowserScreenshotExecutor === true;
	const available =
		hasBrowserSnapshotExecutor ||
		hasBrowserActionExecutor ||
		hasBrowserScreenshotExecutor;
	const safeBrowserEvaluateEnabled = input.safeBrowserEvaluateEnabled === true;

	return {
		available,
		status: available ? "configured" : "unavailable",
		host: input.host,
		cursorCompatibility: true,
		toolNames: [...STANDALONE_BROWSER_TOOL_NAMES],
		executorNames: [...STANDALONE_BROWSER_EXECUTOR_NAMES],
		actions: [...STANDALONE_BROWSER_ACTIONS],
		readOnlyTools: ["browser_snapshot", "browser_screenshot"],
		mutatingActions: [
			"launch",
			"click",
			"type",
			"scroll_down",
			"scroll_up",
			"evaluate",
			"close",
		],
		safeBrowserEvaluateEnabled,
		evaluatePolicy: safeBrowserEvaluateEnabled
			? "explicitly-enabled"
			: "disabled-by-default",
		executors: {
			browserSnapshot: executorState(hasBrowserSnapshotExecutor),
			browserAction: executorState(hasBrowserActionExecutor),
			browserScreenshot: executorState(hasBrowserScreenshotExecutor),
		},
		...(available
			? {}
			: {
					reason:
						input.unavailableReason ?? STANDALONE_BROWSER_UNAVAILABLE_REASON,
					nextStep: input.nextStep ?? STANDALONE_BROWSER_NEXT_STEP,
				}),
	};
}

export function createStandaloneBrowserUnavailableResult(input: {
	toolName: "browser_snapshot" | "browser_action" | "browser_screenshot";
	query?: string;
	host: string;
	action?: string;
	safeBrowserEvaluateEnabled?: boolean;
	reason?: string;
	nextStep?: string;
}): ToolOperationResult {
	const query = input.query ?? input.toolName;
	if (
		input.toolName === "browser_action" &&
		input.action === "evaluate" &&
		input.safeBrowserEvaluateEnabled !== true
	) {
		return {
			query,
			result: "",
			error:
				"browser_action evaluate is disabled. Enable safe browser evaluate before running JavaScript in a page.",
			success: false,
		};
	}
	return {
		query,
		result: "",
		error: `${input.reason ?? STANDALONE_BROWSER_UNAVAILABLE_REASON} Host: ${input.host}. ${input.nextStep ?? STANDALONE_BROWSER_NEXT_STEP}`,
		success: false,
	};
}
