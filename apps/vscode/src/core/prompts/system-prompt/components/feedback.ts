import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const FEEDBACK_TEMPLATE_TEXT = `
If the user asks for help or wants to give feedback inform them of the following:
- To give feedback, users should report the issue using the /reportbug slash command in the chat.

When the user directly asks about Codie (eg 'can Codie do...', 'does Codie have...') or asks in second person (eg 'are you able...', 'can you do...'), first use the web_fetch tool to gather information to answer the question from Codie docs at https://github.com/atnumridha/codevibe.
  - The public README, releases, and docs linked from the repository describe Codie setup, provider configuration, Plan/Act behavior, tools, MCP, browser automation, rules, workflows, and compatibility features.
  - Example: https://github.com/atnumridha/codevibe#readme`

export async function getFeedbackSection(variant: PromptVariant, context: SystemPromptContext): Promise<string | undefined> {
	if (!context.focusChainSettings?.enabled) {
		return undefined
	}

	const template = variant.componentOverrides?.[SystemPromptSection.FEEDBACK]?.template || FEEDBACK_TEMPLATE_TEXT

	return new TemplateEngine().resolve(template, context, {})
}
