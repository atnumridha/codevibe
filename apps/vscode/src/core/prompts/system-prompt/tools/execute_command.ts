import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const TERMINAL_POLICY_PARAMETERS: NonNullable<ClineToolSpec["parameters"]> = [
	{
		name: "sandbox_permissions",
		required: false,
		type: "string",
		enum: ["use_default", "sandboxed", "unelevated", "require_escalated"],
		instruction:
			"Optional Codie terminal run-mode request. Use 'use_default' or omit to let Codie choose; use 'sandboxed' to prefer Codie sandbox execution; use 'unelevated' for normal terminal mode while configured command permissions and sandbox preflight still apply; use 'require_escalated' only when the command must bypass Codie sandbox preflight or sandbox-derived command restrictions. 'require_escalated' always requires explicit user approval and does not request OS administrator privileges.",
		usage: "use_default",
	},
	{
		name: "require_escalated",
		required: false,
		type: "boolean",
		instruction:
			"Optional boolean alias for sandbox_permissions=require_escalated. Set true only when the command must bypass Codie sandbox preflight or sandbox-derived command restrictions. This forces explicit user approval and does not request OS administrator privileges.",
		usage: "false",
	},
	{
		name: "prefix_rule",
		required: false,
		type: "string",
		instruction:
			"Optional approval context for elevated commands. Provide a JSON array of leading command tokens that exactly match the command prefix, such as [\"npm\",\"run\",\"dev\"]. Codie shows this with the one-off approval but does not persist a new auto-approval rule.",
		usage: '["npm","run","dev"]',
	},
]

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.BASH,
	name: "execute_command",
	description: `Request to execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task. You must tailor your command to the user's system and provide a clear explanation of what the command does. For command chaining, use the appropriate chaining syntax for the user's shell. Prefer to execute complex CLI commands over creating executable scripts, as they are more flexible and easier to run. Commands will be executed in the current working directory: {{CWD}}{{MULTI_ROOT_HINT}}`,
	parameters: [
		{
			name: "command",
			required: true,
			instruction: `The CLI command to execute. This should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions.`,
			usage: "Your command here",
		},
		{
			name: "requires_approval",
			required: true,
			instruction:
				"A boolean indicating whether this command requires explicit user approval before execution in case the user has auto-approve mode enabled. Set to 'true' for potentially impactful operations like installing/uninstalling packages, deleting/overwriting files, system configuration changes, network operations, long-running services, builds/tests that write artifacts, or any command that uses sandbox_permissions=require_escalated or require_escalated=true. Set to 'false' only for safe read-only commands and clearly non-mutating status checks.",
			usage: "true or false",
			type: "boolean",
		},
		...TERMINAL_POLICY_PARAMETERS,
		{
			name: "timeout",
			required: false,
			type: "integer",
			contextRequirements: (context) => context.yoloModeToggled === true,
			instruction:
				"Integer representing the timeout in seconds for how long to run the terminal command, before timing out and continuing the task.",
			usage: "30",
		},
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id: ClineDefaultTool.BASH,
	name: ClineDefaultTool.BASH,
	description:
		"Request to execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task.",
	parameters: [
		{
			name: "command",
			required: true,
			instruction:
				"The CLI command to execute. This should be valid for the current operating system. Do not use the ~ character or $HOME to refer to the home directory. Always use absolute paths. The command will be executed from the current workspace, you do not need to cd to the workspace.",
		},
		{
			name: "requires_approval",
			required: true,
			instruction:
				"To indicate whether this command requires explicit user approval or interaction before it should be executed. System/file altering operations like installing/uninstalling packages, removing/overwriting files, system configuration changes, network operations, long-running services, builds/tests that write artifacts, or any command that uses sandbox_permissions=require_escalated or require_escalated=true must be set to true. False is only for safe read-only commands and clearly non-mutating status checks.",
			type: "boolean",
		},
		...TERMINAL_POLICY_PARAMETERS,
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

const GEMINI_3: ClineToolSpec = {
	variant: ModelFamily.GEMINI_3,
	id: ClineDefaultTool.BASH,
	name: ClineDefaultTool.BASH,
	description:
		"Request to execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task. When chaining commands, use the shell operator && (not the HTML entity &amp;&amp;). If using search/grep commands, be careful to not use vague search terms that may return thousands of results. When in PLAN MODE, you may use the execute_command tool, but only in a non-destructive manner and in a way that does not alter any files.",
	parameters: [
		{
			name: "command",
			required: true,
			instruction:
				"The CLI command to execute. This should be valid for the current operating system. For command chaining, use proper shell operators like && to chain commands (e.g., 'cd path && command'). Do not use the ~ character or $HOME to refer to the home directory. Always use absolute paths. Do not run search/grep commands that may return thousands of results.",
		},
		{
			name: "requires_approval",
			required: true,
			instruction:
				"To indicate whether this command requires explicit user approval or interaction before it should be executed. System/file altering operations like installing/uninstalling packages, removing/overwriting files, system configuration changes, network operations, long-running services, builds/tests that write artifacts, or any command that uses sandbox_permissions=require_escalated or require_escalated=true must be set to true. False is only for safe read-only commands and clearly non-mutating status checks.",
			type: "boolean",
		},
		...TERMINAL_POLICY_PARAMETERS,
	],
}

export const execute_command_variants: ClineToolSpec[] = [GENERIC, NATIVE_GPT_5, NATIVE_NEXT_GEN, GEMINI_3]
