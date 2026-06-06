import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.BROWSER_SNAPSHOT

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "browser_snapshot",
	description: `Capture a read-only snapshot of the currently launched Puppeteer-controlled browser tab. The result includes a screenshot, current URL, page title, visible page text, and new console logs.
- Use this after \`browser_action\` has launched a browser when you need to re-inspect the current page state without clicking, typing, scrolling, navigating, closing, or running user-provided JavaScript.
- While the browser is active, only \`browser_action\` and \`browser_snapshot\` should be used. Close the browser with \`browser_action\` before using non-browser tools.`,
	contextRequirements: (context) => context.supportsBrowserUse === true,
	parameters: [],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id,
	name: "browser_snapshot",
	description: `Capture a read-only snapshot of the currently launched Puppeteer-controlled browser tab. The result includes a screenshot, current URL, page title, visible page text, and new console logs.
- Use this after \`browser_action\` has launched a browser when you need to re-inspect the current page state without clicking, typing, scrolling, navigating, closing, or running user-provided JavaScript.
- While the browser is active, only \`browser_action\` and \`browser_snapshot\` should be used. Close the browser with \`browser_action\` before using non-browser tools.`,
	contextRequirements: (context) => context.supportsBrowserUse === true,
	parameters: [],
}

export const browser_snapshot_variants = [GENERIC, NATIVE_NEXT_GEN]
