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
- Omit \`tab_id\` or use \`active\`; this VS Code extension currently snapshots the active browser tab only.
- While the browser is active, only \`browser_action\` and \`browser_snapshot\` should be used. Close the browser with \`browser_action\` before using non-browser tools.`,
	contextRequirements: (context) => context.supportsBrowserUse === true,
	parameters: [
		{
			name: "tab_id",
			required: false,
			instruction: "Optional browser tab identifier. Omit it or use 'active' to snapshot the active browser tab.",
			usage: "active",
		},
		{
			name: "include_screenshot",
			required: false,
			type: "boolean",
			instruction: "Whether to include a screenshot in the snapshot result. Defaults to true.",
			usage: "true",
		},
		{
			name: "include_logs",
			required: false,
			type: "boolean",
			instruction: "Whether to include recent console logs in the snapshot result. Defaults to true.",
			usage: "true",
		},
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id,
	name: "browser_snapshot",
	description: `Capture a read-only snapshot of the currently launched Puppeteer-controlled browser tab. The result includes a screenshot, current URL, page title, visible page text, and new console logs.
- Use this after \`browser_action\` has launched a browser when you need to re-inspect the current page state without clicking, typing, scrolling, navigating, closing, or running user-provided JavaScript.
- Omit \`tab_id\` or use \`active\`; this VS Code extension currently snapshots the active browser tab only.
- While the browser is active, only \`browser_action\` and \`browser_snapshot\` should be used. Close the browser with \`browser_action\` before using non-browser tools.`,
	contextRequirements: (context) => context.supportsBrowserUse === true,
	parameters: [
		{
			name: "tab_id",
			required: false,
			instruction: "Optional browser tab identifier. Omit it or use 'active' to snapshot the active browser tab.",
		},
		{
			name: "include_screenshot",
			required: false,
			type: "boolean",
			instruction: "Whether to include a screenshot in the snapshot result. Defaults to true.",
		},
		{
			name: "include_logs",
			required: false,
			type: "boolean",
			instruction: "Whether to include recent console logs in the snapshot result. Defaults to true.",
		},
	],
}

export const browser_snapshot_variants = [GENERIC, NATIVE_NEXT_GEN]
