import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { TASK_PROGRESS_PARAMETER } from "../types"

const id = ClineDefaultTool.FILE_READ

const READ_FILE_DESCRIPTION =
	"Request to read the contents of a file at the specified path. Follow Codie retrieval-first context discipline: collect and rank likely files with explicit mentions, open/recent files, git changes, list_files, search_files, indexed workspace search, imports, or dependency clues before reading. Prefer start_line and end_line to read only the relevant slice. In PLAN MODE, an un-ranged read_file call is automatically compacted to a small preview; use search_files or indexed workspace search first, then pass start_line/end_line for exact relevant slices. Read an entire file only when the file is explicitly attached or mentioned, small enough, or necessary for an edit. Returned text lines are prefixed with line labels (e.g. `1 |`, `2 |`). These labels are metadata, not part of the file content. For large files, output is automatically limited to 1000 lines in Act mode and a compact preview in Plan mode. Automatically extracts raw text from PDF and DOCX files. May not be suitable for other types of binary files, as it returns the raw content as a string. Do NOT use this tool to list the contents of a directory. Only use this tool on files."

const READ_FILE_PARAMETERS: ClineToolSpec["parameters"] = [
	{
		name: "path",
		required: true,
		instruction: `The path of the file to read (relative to the current working directory {{CWD}}){{MULTI_ROOT_HINT}}`,
		usage: "File path here",
	},
	{
		name: "start_line",
		required: false,
		type: "integer",
		instruction: "The 1-based line number to start reading from (inclusive). Defaults to 1.",
		usage: "1",
	},
	{
		name: "end_line",
		required: false,
		type: "integer",
		instruction:
			"The 1-based line number to stop reading at (inclusive). Defaults to start_line + 1000 in Act mode. In Plan mode, omit this only for a compact preview; after search_files identifies matches, provide an explicit end_line to read the exact useful slice.",
		usage: "1000",
	},
	TASK_PROGRESS_PARAMETER,
]

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "read_file",
	description: READ_FILE_DESCRIPTION,
	parameters: READ_FILE_PARAMETERS,
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id,
	name: "read_file",
	description: READ_FILE_DESCRIPTION,
	parameters: READ_FILE_PARAMETERS,
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

export const read_file_variants = [generic, NATIVE_NEXT_GEN, NATIVE_GPT_5]
