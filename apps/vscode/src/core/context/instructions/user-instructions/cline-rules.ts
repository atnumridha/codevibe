import {
	ActivatedConditionalRule,
	combineRuleToggles,
	getRemoteRulesTotalContentWithMetadata,
	getRuleFilesTotalContentWithMetadata,
	RULE_SOURCE_PREFIX,
	RuleLoadResultWithInstructions,
	synchronizeRuleToggles,
} from "@core/context/instructions/user-instructions/rule-helpers"
import { formatResponse } from "@core/prompts/responses"
import { ensureRulesDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { StateManager } from "@core/storage/StateManager"
import { ClineRulesToggles } from "@shared/cline-rules"
import { fileExistsAtPath, isDirectory, readDirectory } from "@utils/fs"
import fs from "fs/promises"
import path from "path"
import { Controller } from "@/core/controller"
import { Logger } from "@/shared/services/Logger"
import { parseYamlFrontmatter } from "./frontmatter"
import { evaluateRuleConditionals, type RuleEvaluationContext } from "./rule-conditionals"

const LOCAL_CODEVIBE_RULE_EXCLUDES = [
	[".codevibe", "rules", "hooks"],
	[".codevibe", "rules", "skills"],
]

const LOCAL_LEGACY_CLINE_RULE_EXCLUDES = [
	[".clinerules", "workflows"],
	[".clinerules", "hooks"],
	[".clinerules", "skills"],
]

export const getGlobalClineRules = async (
	globalClineRulesFilePath: string,
	toggles: ClineRulesToggles,
	opts?: { evaluationContext?: RuleEvaluationContext },
): Promise<RuleLoadResultWithInstructions> => {
	let combinedContent = ""
	const activatedConditionalRules: ActivatedConditionalRule[] = []

	// 1. Get file-based rules
	if (await fileExistsAtPath(globalClineRulesFilePath)) {
		if (await isDirectory(globalClineRulesFilePath)) {
			try {
				const rulesFilePaths = await readDirectory(globalClineRulesFilePath)
				// Note: ruleNamePrefix explicitly set to "global" for clarity (matches the default)
				const rulesFilesTotal = await getRuleFilesTotalContentWithMetadata(
					rulesFilePaths,
					globalClineRulesFilePath,
					toggles,
					{
						evaluationContext: opts?.evaluationContext,
						ruleNamePrefix: "global",
					},
				)
				if (rulesFilesTotal.content) {
					combinedContent = rulesFilesTotal.content
					activatedConditionalRules.push(...rulesFilesTotal.activatedConditionalRules)
				}
			} catch {
				Logger.error(`Failed to read .clinerules directory at ${globalClineRulesFilePath}`)
			}
		} else {
			Logger.error(`${globalClineRulesFilePath} is not a directory`)
		}
	}

	// 2. Append remote config rules
	const stateManager = StateManager.get()
	const remoteConfigSettings = stateManager.getRemoteConfigSettings()
	const remoteRules = remoteConfigSettings.remoteGlobalRules || []
	const remoteToggles = stateManager.getGlobalStateKey("remoteRulesToggles") || {}
	const remoteResult = getRemoteRulesTotalContentWithMetadata(remoteRules, remoteToggles, {
		evaluationContext: opts?.evaluationContext,
	})
	if (remoteResult.content) {
		if (combinedContent) combinedContent += "\n\n"
		combinedContent += remoteResult.content
		activatedConditionalRules.push(...remoteResult.activatedConditionalRules)
	}

	// 3. Return formatted instructions
	if (!combinedContent) {
		return { instructions: undefined, activatedConditionalRules: [] }
	}

	return {
		instructions: formatResponse.clineRulesGlobalDirectoryInstructions(globalClineRulesFilePath, combinedContent),
		activatedConditionalRules,
	}
}

export const getLocalClineRules = async (
	cwd: string,
	toggles: ClineRulesToggles,
	opts?: { evaluationContext?: RuleEvaluationContext },
): Promise<RuleLoadResultWithInstructions> => {
	const localRuleSources = [
		{
			filePath: path.resolve(cwd, GlobalFileNames.codevibeRules),
			displayPath: GlobalFileNames.codevibeRules,
			excludedPaths: LOCAL_CODEVIBE_RULE_EXCLUDES,
			legacySingleFile: false,
		},
		{
			filePath: path.resolve(cwd, GlobalFileNames.clineRules),
			displayPath: GlobalFileNames.clineRules,
			excludedPaths: LOCAL_LEGACY_CLINE_RULE_EXCLUDES,
			legacySingleFile: true,
		},
	]

	let instructions: string | undefined
	const activatedConditionalRules: ActivatedConditionalRule[] = []

	for (const source of localRuleSources) {
		if (!(await fileExistsAtPath(source.filePath))) {
			continue
		}

		if (await isDirectory(source.filePath)) {
			try {
				const rulesFilePaths = await readDirectory(source.filePath, source.excludedPaths)

				const rulesFilesTotal = await getRuleFilesTotalContentWithMetadata(rulesFilePaths, cwd, toggles, {
					evaluationContext: opts?.evaluationContext,
					ruleNamePrefix: "workspace",
				})
				if (rulesFilesTotal.content) {
					const sourceInstructions = formatResponse.clineRulesLocalDirectoryInstructions(
						cwd,
						rulesFilesTotal.content,
						source.displayPath,
					)
					instructions = instructions ? `${instructions}\n\n${sourceInstructions}` : sourceInstructions
					activatedConditionalRules.push(...rulesFilesTotal.activatedConditionalRules)
				}
			} catch {
				Logger.error(`Failed to read CodeVibe rules directory at ${source.filePath}`)
			}
		} else if (source.legacySingleFile) {
			try {
				if (source.filePath in toggles && toggles[source.filePath] !== false) {
					const raw = (await fs.readFile(source.filePath, "utf8")).trim()
					if (raw) {
						// Keep single-file .clinerules behavior consistent with directory/remote rules:
						// - Parse YAML frontmatter (fail-open on parse errors)
						// - Evaluate conditionals against the request's evaluation context
						const parsed = parseYamlFrontmatter(raw)
						if (parsed.hadFrontmatter && parsed.parseError) {
							// Fail-open: preserve the raw contents so the LLM can still see the author's intent.
							const sourceInstructions = formatResponse.clineRulesLocalFileInstructions(cwd, raw)
							instructions = instructions ? `${instructions}\n\n${sourceInstructions}` : sourceInstructions
						} else {
							const { passed, matchedConditions } = evaluateRuleConditionals(
								parsed.data,
								opts?.evaluationContext ?? {},
							)
							if (passed) {
								const sourceInstructions = formatResponse.clineRulesLocalFileInstructions(cwd, parsed.body.trim())
								instructions = instructions ? `${instructions}\n\n${sourceInstructions}` : sourceInstructions
								if (parsed.hadFrontmatter && Object.keys(matchedConditions).length > 0) {
									activatedConditionalRules.push({
										name: `${RULE_SOURCE_PREFIX.workspace}:${GlobalFileNames.clineRules}`,
										matchedConditions,
									})
								}
							}
						}
					}
				}
			} catch {
				Logger.error(`Failed to read .clinerules file at ${source.filePath}`)
			}
		} else {
			Logger.error(`${source.filePath} is not a directory`)
		}
	}

	return { instructions, activatedConditionalRules }
}

export async function refreshClineRulesToggles(
	controller: Controller,
	workingDirectory: string,
): Promise<{
	globalToggles: ClineRulesToggles
	localToggles: ClineRulesToggles
}> {
	// Global toggles
	const globalClineRulesToggles = controller.stateManager.getGlobalSettingsKey("globalClineRulesToggles")
	const globalClineRulesFilePath = await ensureRulesDirectoryExists()
	const updatedGlobalToggles = await synchronizeRuleToggles(globalClineRulesFilePath, globalClineRulesToggles)
	controller.stateManager.setGlobalState("globalClineRulesToggles", updatedGlobalToggles)

	// Local toggles
	const localClineRulesToggles = controller.stateManager.getWorkspaceStateKey("localClineRulesToggles")
	const localCodeVibeRulesFilePath = path.resolve(workingDirectory, GlobalFileNames.codevibeRules)
	const localClineRulesFilePath = path.resolve(workingDirectory, GlobalFileNames.clineRules)
	const updatedCodeVibeRuleToggles = await synchronizeRuleToggles(
		localCodeVibeRulesFilePath,
		localClineRulesToggles,
		"",
		LOCAL_CODEVIBE_RULE_EXCLUDES,
	)
	const updatedLegacyRuleToggles = await synchronizeRuleToggles(
		localClineRulesFilePath,
		localClineRulesToggles,
		"",
		LOCAL_LEGACY_CLINE_RULE_EXCLUDES,
	)
	const updatedLocalToggles = combineRuleToggles(updatedCodeVibeRuleToggles, updatedLegacyRuleToggles)
	controller.stateManager.setWorkspaceState("localClineRulesToggles", updatedLocalToggles)

	return {
		globalToggles: updatedGlobalToggles,
		localToggles: updatedLocalToggles,
	}
}
