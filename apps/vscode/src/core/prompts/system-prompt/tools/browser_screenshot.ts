import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.BROWSER_SCREENSHOT

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "browser_screenshot",
	description: `Capture a read-only screenshot of the currently launched Puppeteer-controlled browser tab. The result includes a screenshot, current URL, page title, and tab id.
- Use this after \`browser_action\` has launched a browser when you only need pixels rather than the full DOM/text snapshot from \`browser_snapshot\`.
- Omit \`tab_id\` or use \`active\`; this VS Code extension currently screenshots the active browser tab only.
- Do not use this to click, type, navigate, scroll, close, or run user-provided JavaScript.
- While the browser is active, only \`browser_action\`, \`browser_snapshot\`, and \`browser_screenshot\` should be used. Close the browser with \`browser_action\` before using non-browser tools.`,
	contextRequirements: (context) => context.supportsBrowserUse === true,
	parameters: [
		{
			name: "tab_id",
			required: false,
			instruction: "Optional browser tab identifier. Omit it or use 'active' to screenshot the active browser tab.",
			usage: "active",
		},
		{
			name: "full_page",
			required: false,
			type: "boolean",
			instruction: "Whether to request a full-page screenshot when supported by the browser.",
			usage: "false",
		},
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id,
	name: "browser_screenshot",
	description: `Capture a read-only screenshot of the currently launched Puppeteer-controlled browser tab. The result includes a screenshot, current URL, page title, and tab id.
- Use this after \`browser_action\` has launched a browser when you only need pixels rather than the full DOM/text snapshot from \`browser_snapshot\`.
- Omit \`tab_id\` or use \`active\`; this VS Code extension currently screenshots the active browser tab only.
- Do not use this to click, type, navigate, scroll, close, or run user-provided JavaScript.
- While the browser is active, only \`browser_action\`, \`browser_snapshot\`, and \`browser_screenshot\` should be used. Close the browser with \`browser_action\` before using non-browser tools.`,
	contextRequirements: (context) => context.supportsBrowserUse === true,
	parameters: [
		{
			name: "tab_id",
			required: false,
			instruction: "Optional browser tab identifier. Omit it or use 'active' to screenshot the active browser tab.",
		},
		{
			name: "full_page",
			required: false,
			type: "boolean",
			instruction: "Whether to request a full-page screenshot when supported by the browser.",
		},
	],
}

export const browser_screenshot_variants = [GENERIC, NATIVE_NEXT_GEN]
