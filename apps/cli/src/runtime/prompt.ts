import { statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import {
	assertPathAllowedByDirectAccessIgnores,
	buildWorkspaceMetadata,
	isPathAllowedByCursorSandbox,
	mergeRulesForSystemPrompt,
	type CursorSandboxRuntimePolicy,
	type UserInstructionConfigService,
} from "@cline/core";
import { type AgentMode, buildClineSystemPrompt } from "@cline/shared";
import { isImagePath, loadImageAsDataUrl } from "../utils/image-attachments";

const PLAN_MODE_INSTRUCTIONS = `# Plan Mode

You are in Plan mode. Your role is to explore, analyze, and plan -- not to execute. Behave exploration-first, like a Codie agent preparing a change.

- Read files, search the codebase, inspect errors/tests, and gather enough context before proposing a concrete plan
- Do not announce files you intend to inspect instead of inspecting them when tools are available
- Ask clarifying questions when requirements are ambiguous or when a safe assumption would materially change the implementation
- Present your plan as a structured outline with clear steps, likely files, risks, validation commands, and open questions
- Explain tradeoffs between different approaches when they exist
- Track meaningful progress for multi-step work, updating the checklist only as milestones are completed
- Do NOT edit files, write code, run destructive commands, or make any changes
- Do NOT implement anything -- focus on understanding and alignment first

When the user aligns on a plan and is ready to proceed, use the switch_to_act_mode tool to switch to act mode and begin implementation. Do not call it before the user has agreed.`;

const ACT_MODE_INSTRUCTIONS = `# Act Mode

You are in Act mode. Your role is to implement while preserving import-compatible reviewability and permission boundaries.

- Start by inspecting the relevant current files, existing patterns, and any user changes before editing
- Keep a concise progress checklist for multi-step work and update it when milestones are completed
- Make minimal, reviewable patches; prefer apply_patch when available, keep hunks scoped, and avoid unrelated formatting churn
- Re-read files before retrying a failed patch or when the workspace may have changed
- Preserve unrelated user changes and adapt around them
- Ask before destructive commands, dependency installs, network access, credential use, broad rewrites, commits, or pushes unless the user already authorized that action
- Validate with targeted tests, type checks, linting, or command output when possible, and clearly report anything you could not run`;

export async function resolveSystemPrompt(input: {
	cwd: string;
	explicitSystemPrompt?: string;
	providerId?: string;
	rules?: string;
	mode?: AgentMode;
}): Promise<string> {
	const metadata = await buildWorkspaceMetadata(input.cwd);
	let rules = mergeRulesForSystemPrompt(undefined, input.rules);
	if (input.mode === "plan") {
		rules = rules
			? `${rules}\n\n${PLAN_MODE_INSTRUCTIONS}`
			: PLAN_MODE_INSTRUCTIONS;
	} else if (input.mode === "act") {
		rules = rules
			? `${rules}\n\n${ACT_MODE_INSTRUCTIONS}`
			: ACT_MODE_INSTRUCTIONS;
	}
	return buildClineSystemPrompt({
		ide: "Terminal Shell",
		workspaceRoot: input.cwd,
		workspaceName: basename(input.cwd),
		metadata,
		rules,
		mode: input.mode,
		providerId: input.providerId,
		overridePrompt: input.explicitSystemPrompt,
		platform:
			(typeof process !== "undefined" && process?.platform) || "unknown",
	});
}

const FILE_MENTION_PREFIX = String.raw`(?:\/|~\/|\.{1,2}\/)`;
const FILE_MENTION_PATTERN_TEST = new RegExp(
	String.raw`@(?:"${FILE_MENTION_PREFIX}[^"\r\n]+"|${FILE_MENTION_PREFIX}\S+)`,
	"i",
);
const FILE_MENTION_PATTERN_EXEC = new RegExp(
	String.raw`@(?:"(${FILE_MENTION_PREFIX}[^"\r\n]+)"|(${FILE_MENTION_PREFIX}\S+))`,
	"g",
);
function hasFileMentions(prompt: string): boolean {
	return FILE_MENTION_PATTERN_TEST.test(prompt);
}

function extractFileMentions(
	prompt: string,
): Array<{ path: string; index: number; raw: string }> {
	const matches: Array<{ path: string; index: number; raw: string }> = [];
	let match: RegExpExecArray | null;
	const pattern = new RegExp(
		FILE_MENTION_PATTERN_EXEC.source,
		FILE_MENTION_PATTERN_EXEC.flags,
	);

	for (;;) {
		match = pattern.exec(prompt);
		if (!match) break;
		const path = match[1] ?? match[2];
		if (!path) continue;
		matches.push({
			path,
			index: match.index,
			raw: match[0],
		});
	}
	return matches;
}

function resolveMentionPath(filePath: string, cwd: string): string {
	if (filePath.startsWith("~/")) {
		return resolve(homedir(), filePath.slice(2));
	}
	return resolve(cwd, filePath);
}

export async function buildUserInputMessage(
	rawPrompt: string,
	userInstructionService?: UserInstructionConfigService,
	options: { cwd?: string; cursorSandboxPolicy?: CursorSandboxRuntimePolicy } = {},
): Promise<{
	prompt: string;
	userImages: string[];
	userFiles: string[];
}> {
	// First, resolve slash commands if the core config service is available.
	let prompt = rawPrompt;
	if (userInstructionService) {
		prompt = userInstructionService.resolveRuntimeSlashCommand(rawPrompt);
	}

	if (!hasFileMentions(prompt)) {
		return {
			prompt,
			userImages: [],
			userFiles: [],
		};
	}

	const fileMentions = extractFileMentions(prompt);

	if (fileMentions.length === 0) {
		return {
			prompt,
			userImages: [],
			userFiles: [],
		};
	}

	fileMentions.sort((a, b) => b.index - a.index);

	let processedPrompt = prompt;
	const userImages: string[] = [];
	const userFiles: string[] = [];
	const loadedImages: Array<{
		index: number;
		dataUrl: string;
		fileName: string;
	}> = [];
	const loadedFiles: Array<{
		index: number;
		path: string;
		fileName: string;
	}> = [];
	const cwd = options.cwd?.trim() ? resolve(options.cwd) : process.cwd();

	for (const mention of fileMentions) {
		try {
			const resolvedPath = resolveMentionPath(mention.path, cwd);
			await assertPathAllowedByDirectAccessIgnores(cwd, resolvedPath);
			if (
				options.cursorSandboxPolicy &&
				!isPathAllowedByCursorSandbox(
					resolvedPath,
					options.cursorSandboxPolicy.readablePaths,
				)
			) {
				throw new Error(
					`Access to ${resolvedPath} is outside import-compatible sandbox read paths from .cursor/sandbox.json.`,
				);
			}
			const stats = statSync(resolvedPath);
			if (!stats.isFile()) {
				throw new Error(`Path is not a file: ${resolvedPath}`);
			}
			const fileName = basename(resolvedPath);

			if (isImagePath(resolvedPath)) {
				const dataUrl = loadImageAsDataUrl(resolvedPath);
				loadedImages.push({
					index: mention.index,
					dataUrl,
					fileName,
				});
				processedPrompt = processedPrompt.replace(
					mention.raw,
					`[image: ${fileName}]`,
				);
				continue;
			}

			loadedFiles.push({
				index: mention.index,
				path: resolvedPath,
				fileName,
			});
			processedPrompt = processedPrompt.replace(
				mention.raw,
				`[file: ${fileName}]`,
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.error(`[warning] ${errorMsg}`);
		}
	}

	for (const image of loadedImages.reverse()) {
		userImages.push(image.dataUrl);
	}
	for (const file of loadedFiles.reverse()) {
		userFiles.push(file.path);
	}

	return {
		prompt: processedPrompt,
		userImages,
		userFiles,
	};
}
