import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

/**
 * ## search_files
	Description: Request to perform a regex search across files in a specified directory, returning compact path + line-range snippets. This searches/ranks before reading and is the preferred way to find exact start_line/end_line ranges for read_file.
Parameters:
- path: (required) The path of the directory to search in (relative to the current working directory ${cwd.toPosix()}). This directory will be recursively searched.
- regex: (required) The regular expression pattern to search for. Uses Rust regex syntax.
- file_pattern: (optional) Glob pattern to filter files (e.g., '*.ts' for TypeScript files). If not provided, it will search all files (*).
Usage:
<search_files>
<path>Directory path here</path>
<regex>Your regex pattern here</regex>
<file_pattern>file pattern here (optional)</file_pattern>
</search_files>
 */

const id = ClineDefaultTool.SEARCH
const SEARCH_FILES_DESCRIPTION =
	"Request to perform a regex search across files in a specified directory, returning compact path + line-range snippets with nearby context. Use this to rank likely files/ranges before read_file, then read only exact start_line/end_line slices instead of loading whole files."

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "search_files",
	description: SEARCH_FILES_DESCRIPTION,
	parameters: [
		{
			name: "path",
			required: true,
			instruction: `The path of the directory to search in (relative to the current working directory {{CWD}}){{MULTI_ROOT_HINT}}. This directory will be recursively searched.`,
			usage: "Directory path here",
		},
		{
			name: "regex",
			required: true,
			instruction: "The regular expression pattern to search for. Uses Rust regex syntax.",
			usage: "Your regex pattern here",
		},
		{
			name: "file_pattern",
			required: false,
			instruction:
				"Glob pattern to filter files (e.g., '*.ts' for TypeScript files). If not provided, it will search all files (*).",
			usage: "file pattern here (optional)",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id,
	name: "search_files",
	description: SEARCH_FILES_DESCRIPTION,
	parameters: [
		{
			name: "path",
			required: true,
			instruction: `The path of the directory to search in (relative to the current working directory {{CWD}}){{MULTI_ROOT_HINT}}. This directory will be recursively searched.`,
			usage: "Directory path here",
		},
		{
			name: "regex",
			required: true,
			instruction: "The regular expression pattern to search for. Uses Rust regex syntax.",
			usage: "Your regex pattern here",
		},
		{
			name: "file_pattern",
			required: false,
			instruction:
				"Glob pattern to filter files (e.g., '*.ts' for TypeScript files). If not provided, it will search all files (*).",
			usage: "file pattern here (optional)",
		},
		TASK_PROGRESS_PARAMETER,
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	...NATIVE_NEXT_GEN,
	variant: ModelFamily.NATIVE_GPT_5,
}

export const search_files_variants = [generic, NATIVE_GPT_5, NATIVE_NEXT_GEN]
