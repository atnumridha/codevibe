import { MAX_SUBAGENT_PROMPTS, SUBAGENT_PROMPT_KEYS, SUBAGENT_PROMPT_ORDINALS } from "@core/task/tools/subagent/constants"
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.USE_SUBAGENTS

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "use_subagents",
	description:
		`Run up to ${MAX_SUBAGENT_PROMPTS} focused in-process subagents in parallel. Each subagent gets its own prompt and returns a comprehensive research result with tool and token stats. Use this for broad exploration when reading many files would consume the main agent's context window. You do not need to launch multiple subagents every time; using one subagent is valid when it avoids unnecessary context usage for light discovery work.`,
	contextRequirements: (context) => context.subagentsEnabled === true && !context.isSubagentRun,
	parameters: SUBAGENT_PROMPT_KEYS.map((name, index) => ({
		name,
		required: index === 0,
		instruction: `${index === 0 ? "" : "Optional "}${SUBAGENT_PROMPT_ORDINALS[index]} subagent prompt.`,
	})),
}

export const subagent_variants = [generic]
