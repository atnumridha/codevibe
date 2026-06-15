import { ClineIgnoreController } from "@core/ignore/ClineIgnoreController"
import * as childProcess from "child_process"
import * as path from "path"
import * as readline from "readline"
import { Logger } from "@/shared/services/Logger"
import { getBinaryLocation } from "@/utils/fs"

/*
This file provides functionality to perform regex searches on files using ripgrep.
Inspired by: https://github.com/DiscreteTom/vscode-ripgrep-utils

Key components:
* execRipgrep: Executes the ripgrep command and returns the output.
* regexSearchFiles: The main function that performs regex searches on files.
   - Parameters:
     * cwd: The current working directory (for relative path calculation)
     * directoryPath: The directory to search in
     * regex: The regular expression to search for (Rust regex syntax)
     * filePattern: Optional glob pattern to filter files (default: '*')
   - Returns: A formatted string containing search results with context

The search results include:
- Relative file paths
- 2 lines of context before and after each match
- Matches formatted with pipe characters for easy reading

Usage example:
const results = await regexSearchFiles('/path/to/cwd', '/path/to/search', 'TODO:', '*.ts');

rel/path/to/app.ts
│----
│function processData(data: any) {
│  // Some processing logic here
│  // TODO: Implement error handling
│  return processedData;
│}
│----

rel/path/to/helper.ts
│----
│  let result = 0;
│  for (let i = 0; i < input; i++) {
│    // TODO: Optimize this function for performance
│    result += Math.pow(i, 2);
│  }
│----
*/

export interface RegexSearchResult {
	filePath: string
	line: number
	column: number
	match: string
	beforeContext: string[]
	afterContext: string[]
}

const MAX_RESULTS = 300

export interface RegexSearchOptions {
	includeIgnored?: boolean
}

type NumberedSearchLine = {
	line: number
	text: string
	isMatch: boolean
}

type SearchSnippet = {
	start: number
	end: number
	lines: NumberedSearchLine[]
}

const MAX_FORMATTED_RESULTS = 120
const MAX_MATCHES_PER_FILE = 16
const MERGE_ADJACENT_LINE_GAP = 2
const MAX_SEARCH_OUTPUT_KB = 80
const MAX_SEARCH_OUTPUT_BYTES = MAX_SEARCH_OUTPUT_KB * 1024
const MAX_SEARCH_LINE_CHARS = 700

async function execRipgrep(args: string[]): Promise<string> {
	const binPath: string = await getBinaryLocation("rg")

	return new Promise((resolve, reject) => {
		const rgProcess = childProcess.spawn(binPath, args)
		// cross-platform alternative to head, which is ripgrep author's recommendation for limiting output.
		const rl = readline.createInterface({
			input: rgProcess.stdout,
			crlfDelay: Infinity, // treat \r\n as a single line break even if it's split across chunks. This ensures consistent behavior across different operating systems.
		})

		let output = ""
		let lineCount = 0
		const maxLines = MAX_RESULTS * 5 // limiting ripgrep output with max lines since there's no other way to limit results. it's okay that we're outputting as json, since we're parsing it line by line and ignore anything that's not part of a match. This assumes each result is at most 5 lines.

		rl.on("line", (line) => {
			if (lineCount < maxLines) {
				output += line + "\n"
				lineCount++
			} else {
				rl.close()
				rgProcess.kill()
			}
		})

		let errorOutput = ""
		rgProcess.stderr.on("data", (data) => {
			errorOutput += data.toString()
		})
		rl.on("close", () => {
			if (errorOutput) {
				reject(new Error(`ripgrep process error: ${errorOutput}`))
			} else {
				resolve(output)
			}
		})
		rgProcess.on("error", (error) => {
			reject(new Error(`ripgrep process error: ${error.message}`))
		})
	})
}

export async function regexSearchFiles(
	cwd: string,
	directoryPath: string,
	regex: string,
	filePattern?: string,
	clineIgnoreController?: ClineIgnoreController,
): Promise<string> {
	const filteredResults = await regexSearchFileMatches(cwd, directoryPath, regex, filePattern, clineIgnoreController)
	return formatRegexSearchResults(filteredResults, cwd)
}

export async function regexSearchFileMatches(
	cwd: string,
	directoryPath: string,
	regex: string,
	filePattern?: string,
	clineIgnoreController?: ClineIgnoreController,
	options?: RegexSearchOptions,
): Promise<RegexSearchResult[]> {
	const args = ["--json", "-e", regex, "--glob", filePattern || "*", "--context", "1"]
	if (options?.includeIgnored) {
		args.push("--no-ignore")
	}
	args.push(directoryPath)

	let output: string
	try {
		output = await execRipgrep(args)
	} catch (error) {
		throw Error("Error calling ripgrep", { cause: error })
	}
	const results: RegexSearchResult[] = []
	let currentResult: Partial<RegexSearchResult> | null = null

	output.split("\n").forEach((line) => {
		if (line) {
			try {
				const parsed = JSON.parse(line)
				if (parsed.type === "match") {
					if (currentResult) {
						results.push(currentResult as RegexSearchResult)
					}
					currentResult = {
						filePath: parsed.data.path.text,
						line: parsed.data.line_number,
						column: parsed.data.submatches[0].start,
						match: parsed.data.lines.text,
						beforeContext: [],
						afterContext: [],
					}
				} else if (parsed.type === "context" && currentResult) {
					if (parsed.data.line_number < currentResult.line!) {
						currentResult.beforeContext!.push(parsed.data.lines.text)
					} else {
						currentResult.afterContext!.push(parsed.data.lines.text)
					}
				}
			} catch (error) {
				Logger.error("Error parsing ripgrep output:", error)
			}
		}
	})

	if (currentResult) {
		results.push(currentResult as RegexSearchResult)
	}

	// Filter results using ClineIgnoreController if provided
	const filteredResults = clineIgnoreController
		? results.filter((result) => clineIgnoreController.validateRetrievalAccess(result.filePath))
		: results

	return filteredResults
}

function normalizeSnippetLine(line: string | undefined): string {
	const normalized = (line ?? "").replace(/\r?\n$/, "").trimEnd()
	if (normalized.length <= MAX_SEARCH_LINE_CHARS) {
		return normalized
	}
	return `${normalized.slice(0, MAX_SEARCH_LINE_CHARS)}... [line truncated]`
}

function toNumberedLines(result: RegexSearchResult): NumberedSearchLine[] {
	const beforeStart = result.line - result.beforeContext.length
	const before = result.beforeContext.map((line, index) => ({
		line: beforeStart + index,
		text: normalizeSnippetLine(line),
		isMatch: false,
	}))
	const match = {
		line: result.line,
		text: normalizeSnippetLine(result.match),
		isMatch: true,
	}
	const after = result.afterContext.map((line, index) => ({
		line: result.line + index + 1,
		text: normalizeSnippetLine(line),
		isMatch: false,
	}))
	return [...before, match, ...after].filter((line) => line.line > 0)
}

function mergeResultIntoSnippets(snippets: SearchSnippet[], result: RegexSearchResult): void {
	const numberedLines = toNumberedLines(result)
	if (numberedLines.length === 0) {
		return
	}

	const start = numberedLines[0].line
	const end = numberedLines[numberedLines.length - 1].line
	const previous = snippets[snippets.length - 1]
	if (!previous || start > previous.end + MERGE_ADJACENT_LINE_GAP) {
		snippets.push({ start, end, lines: numberedLines })
		return
	}

	previous.end = Math.max(previous.end, end)
	const byLine = new Map<number, NumberedSearchLine>()
	for (const line of previous.lines) {
		byLine.set(line.line, line)
	}
	for (const line of numberedLines) {
		const existing = byLine.get(line.line)
		byLine.set(line.line, {
			line: line.line,
			text: existing?.text ?? line.text,
			isMatch: (existing?.isMatch ?? false) || line.isMatch,
		})
	}
	previous.lines = Array.from(byLine.values()).sort((a, b) => a.line - b.line)
}

function appendWithinBudget(output: string, addition: string): { output: string; didFit: boolean } {
	if (Buffer.byteLength(output, "utf8") + Buffer.byteLength(addition, "utf8") > MAX_SEARCH_OUTPUT_BYTES) {
		return { output, didFit: false }
	}
	return { output: output + addition, didFit: true }
}

export function formatRegexSearchResults(results: RegexSearchResult[], cwd: string): string {
	const groupedResults = new Map<string, RegexSearchResult[]>()
	const formattedResults = results.slice(0, MAX_FORMATTED_RESULTS)

	let output = ""
	if (results.length > MAX_FORMATTED_RESULTS) {
		output += `Showing first ${MAX_FORMATTED_RESULTS.toLocaleString()} of ${results.length.toLocaleString()} results as compact snippets. Use a more specific search if necessary.\n\n`
	} else if (results.length >= MAX_RESULTS) {
		output += `Showing first ${MAX_FORMATTED_RESULTS.toLocaleString()} of ${MAX_RESULTS}+ results as compact snippets. Use a more specific search if necessary.\n\n`
	} else {
		output += `Found ${results.length === 1 ? "1 result" : `${results.length.toLocaleString()} results`}.\n\n`
	}

	for (const result of formattedResults) {
		const relativeFilePath = path.relative(cwd, result.filePath)
		const fileResults = groupedResults.get(relativeFilePath) ?? []
		if (fileResults.length < MAX_MATCHES_PER_FILE) {
			fileResults.push(result)
		}
		groupedResults.set(relativeFilePath, fileResults)
	}

	let wasLimitReached = false

	for (const [filePath, fileResults] of groupedResults.entries()) {
		const snippets: SearchSnippet[] = []
		for (const result of fileResults.sort((a, b) => a.line - b.line || a.column - b.column)) {
			mergeResultIntoSnippets(snippets, result)
		}
		const omittedForFile = Math.max(0, results.filter((result) => path.relative(cwd, result.filePath) === filePath).length - fileResults.length)
		const fileHeader = `${filePath.toPosix()}\n`
		const headerResult = appendWithinBudget(output, fileHeader)
		if (!headerResult.didFit) {
			wasLimitReached = true
			break
		}
		output = headerResult.output

		for (let snippetIndex = 0; snippetIndex < snippets.length; snippetIndex++) {
			const snippet = snippets[snippetIndex]
			const snippetHeader = `│---- lines ${snippet.start}-${snippet.end}\n`
			const snippetHeaderResult = appendWithinBudget(output, snippetHeader)
			if (!snippetHeaderResult.didFit) {
				wasLimitReached = true
				break
			}
			output = snippetHeaderResult.output

			for (const line of snippet.lines) {
				const marker = line.isMatch ? ">" : " "
				const lineString = `│${marker} ${line.line} | ${line.text}\n`
				const lineResult = appendWithinBudget(output, lineString)
				if (!lineResult.didFit) {
					wasLimitReached = true
					break
				}
				output = lineResult.output
			}

			if (wasLimitReached) {
				break
			}
			if (snippetIndex === snippets.length - 1) {
				continue
			}
		}

		if (wasLimitReached) {
			break
		}

		const footer = omittedForFile > 0 ? `│----\n│ ${omittedForFile} more match(es) in this file omitted.\n\n` : "│----\n\n"
		const footerResult = appendWithinBudget(output, footer)
		if (!footerResult.didFit) {
			wasLimitReached = true
			break
		}
		output = footerResult.output
	}

	if (wasLimitReached || results.length > formattedResults.length) {
		const truncationMessage = `\n[Results truncated to compact snippets under ${MAX_SEARCH_OUTPUT_KB}KB. Use a more specific search pattern, then read precise start_line/end_line ranges.]`
		const truncationResult = appendWithinBudget(output, truncationMessage)
		output = truncationResult.didFit ? truncationResult.output : `${output.trimEnd()}\n[Results truncated.]`
	}

	return output.trim()
}
