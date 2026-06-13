/**
 * Default Tools
 *
 * This module provides a set of configurable default tools for agents.
 */

// Zod Utilities
export { validateWithZod, zodToJsonSchema } from "@cline/shared";
// Constants
export { ALL_DEFAULT_TOOL_NAMES, DefaultToolNames } from "./constants";
// AgentTool Definitions
export {
	createApplyPatchTool,
	createAskQuestionTool,
	createBrowserActionTool,
	createBrowserScreenshotTool,
	createBrowserSnapshotTool,
	createBashTool,
	createDefaultTools,
	createEditorTool,
	createReadFilesTool,
	createSearchTool,
	createSkillsTool,
	createSubmitAndExitTool,
	createWebFetchTool,
	createWebSearchTool,
	createWindowsShellTool,
} from "./definitions";
export {
	redactSensitiveBrowserText,
	sanitizeBrowserSnapshotResult,
} from "./browser-redaction";
// Built-in Executors
export {
	type ApplyPatchExecutorOptions,
	type BashExecutorOptions,
	createApplyPatchExecutor,
	createBashExecutor,
	createDefaultExecutors,
	createEditorExecutor,
	createFileReadExecutor,
	createSearchExecutor,
	createWebFetchExecutor,
	createWebSearchExecutor,
	type DefaultExecutorsOptions,
	type EditorExecutorOptions,
	type FileReadExecutorOptions,
	type SearchExecutorOptions,
	type WebFetchExecutorOptions,
	type WebSearchExecutorOptions,
} from "./executors/index";
export {
	DEFAULT_MODEL_TOOL_ROUTING_RULES,
	resolveToolRoutingConfig,
	type ToolRoutingRule,
} from "./model-tool-routing";
// Presets
export {
	createDefaultToolsWithPreset,
	createToolPoliciesWithPreset,
	resolveToolPresetName,
	type ToolPolicyPresetName,
	type ToolPresetName,
	ToolPresets,
} from "./presets";
export {
	type BuiltinToolAvailabilityContext,
	getCoreAcpToolNames,
	getCoreBuiltinToolCatalog,
	getCoreDefaultEnabledToolIds,
	getCoreHeadlessToolNames,
	resolveCoreSelectedToolIds,
	type ToolCatalogEntry,
} from "./runtime";
export {
	createStandaloneBrowserCdpAutomation,
	type StandaloneBrowserCdpOptions,
} from "./standalone-browser-cdp";
export {
	createStandaloneBrowserUnavailableResult,
	getStandaloneBrowserAutomationStatus,
	STANDALONE_BROWSER_ACTIONS,
	STANDALONE_BROWSER_EXECUTOR_NAMES,
	STANDALONE_BROWSER_TOOL_NAMES,
	type StandaloneBrowserAutomationStatus,
	type StandaloneBrowserAutomationStatusInput,
} from "./standalone-browser";
// Schemas
export {
	type ApplyPatchInput,
	ApplyPatchInputSchema,
	type AskQuestionInput,
	AskQuestionInputSchema,
	type BrowserActionInput,
	BrowserActionInputSchema,
	BrowserActionNameSchema,
	type BrowserScreenshotInput,
	BrowserScreenshotInputSchema,
	type BrowserSnapshotInput,
	BrowserSnapshotInputSchema,
	type EditFileInput,
	EditFileInputSchema,
	type FetchWebContentInput,
	FetchWebContentInputSchema,
	type ReadFileRequest,
	ReadFileRequestSchema,
	type ReadFilesInput,
	ReadFilesInputSchema,
	type RunCommandsInput,
	RunCommandsInputSchema,
	type SearchCodebaseInput,
	SearchCodebaseInputSchema,
	type SkillsInput,
	SkillsInputSchema,
	type SubmitInput,
	SubmitInputSchema,
	type WebFetchRequest,
	WebFetchRequestSchema,
	type WebSearchInput,
	WebSearchInputSchema,
} from "./schemas";
export { TEAM_TOOL_NAMES } from "./team/team-tools";
// Types
export type {
	ApplyPatchExecutor,
	AskQuestionExecutor,
	BrowserActionExecutor,
	BrowserActionResult,
	BrowserScreenshotExecutor,
	BrowserSnapshotExecutor,
	BrowserSnapshotNode,
	BrowserSnapshotResult,
	BashExecutor,
	CreateDefaultToolsOptions,
	DefaultToolName,
	DefaultToolsConfig,
	EditorExecutor,
	FileReadExecutor,
	SearchExecutor,
	SkillsExecutor,
	SkillsExecutorSkillMetadata,
	SkillsExecutorWithMetadata,
	ToolExecutors,
	ToolOperationResult,
	VerifySubmitExecutor,
	WebFetchExecutor,
	WebSearchExecutor,
} from "./types";

// =============================================================================
// Convenience: Create Tools with Built-in Executors
// =============================================================================

import type { AgentTool } from "@cline/shared";
import { createDefaultTools } from "./definitions";
import {
	createDefaultExecutors,
	type DefaultExecutorsOptions,
} from "./executors/index";
import type { CreateDefaultToolsOptions, ToolExecutors } from "./types";

/**
 * Options for creating default tools with built-in executors
 */
export interface CreateBuiltinToolsOptions
	extends Omit<CreateDefaultToolsOptions, "executors"> {
	/**
	 * Configuration for the built-in executors
	 */
	executorOptions?: DefaultExecutorsOptions;
	/**
	 * Optional executor overrides/additions for tools without built-ins
	 */
	executors?: Partial<ToolExecutors>;
}

/**
 * Create default tools with built-in Node.js executors
 *
 * This is a convenience function that creates the default tools with
 * working implementations using Node.js built-in modules.
 *
 * @example
 * ```typescript
 * import { Agent, createBuiltinTools } from "@cline/core"
 *
 * const tools = createBuiltinTools({
 *   cwd: "/path/to/project",
 *   enableBash: true,
 *   enableWebFetch: false, // Disable web fetching
 *   executorOptions: {
 *     bash: { timeoutMs: 60000 },
 *   },
 * })
 *
 * const agent = new Agent({
 *   providerId: "anthropic",
 *   modelId: "claude-sonnet-4-20250514",
 *   systemPrompt: "You are a coding assistant.",
 *   tools,
 * })
 * ```
 */
export function createBuiltinTools(
	options: CreateBuiltinToolsOptions = {},
): AgentTool[] {
	const {
		executorOptions = {},
		executors: executorOverrides,
		...toolsConfig
	} = options;
	const effectiveExecutorOptions: DefaultExecutorsOptions = {
		...executorOptions,
		search: {
			cursorRetrievalIndexingPrivacyGate:
				toolsConfig.cursorRetrievalIndexingPrivacyGate,
			...(executorOptions.search ?? {}),
		},
	};

	const executors = {
		...createDefaultExecutors(effectiveExecutorOptions),
		...(executorOverrides ?? {}),
	};

	return createDefaultTools({
		...toolsConfig,
		executors,
	});
}
