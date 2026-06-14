import * as path from "node:path"
import * as vscode from "vscode"
import { SearchWorkspaceTextRequest, SearchWorkspaceTextResponse } from "@/shared/proto/host/workspace"

const DEFAULT_MAX_RESULTS = 300
const MAX_CANDIDATE_FILES = 5000
const MAX_FILE_BYTES = 1_000_000
const CONTEXT_LINES = 1

function getSearchRoot(request: SearchWorkspaceTextRequest): string | undefined {
	return request.directoryPath || request.workspacePath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
}

function getRelativeBase(request: SearchWorkspaceTextRequest, searchRoot: string): string {
	return request.workspacePath || searchRoot
}

function getIncludePattern(request: SearchWorkspaceTextRequest, searchRoot: string): vscode.GlobPattern {
	const pattern = request.filePattern?.trim() || "**/*"
	const normalizedPattern = pattern.includes("/") || pattern.startsWith("**/") ? pattern : `**/${pattern}`
	return new vscode.RelativePattern(vscode.Uri.file(searchRoot), normalizedPattern)
}

function createRegex(pattern: string): RegExp {
	return new RegExp(pattern, "g")
}

function pushLineMatches(input: {
	matches: SearchWorkspaceTextResponse["matches"]
	uri: vscode.Uri
	relativeBase: string
	lines: string[]
	lineIndex: number
	regex: RegExp
	maxResults: number
}): void {
	const line = input.lines[input.lineIndex] ?? ""
	input.regex.lastIndex = 0

	let match: RegExpExecArray | null
	while ((match = input.regex.exec(line)) && input.matches.length < input.maxResults) {
		const beforeStart = Math.max(0, input.lineIndex - CONTEXT_LINES)
		const afterEnd = Math.min(input.lines.length - 1, input.lineIndex + CONTEXT_LINES)
		input.matches.push({
			path: path.relative(input.relativeBase, input.uri.fsPath).split(path.sep).join("/"),
			line: input.lineIndex + 1,
			column: match.index,
			match: line,
			beforeContext: input.lines.slice(beforeStart, input.lineIndex),
			afterContext: input.lines.slice(input.lineIndex + 1, afterEnd + 1),
		})
		if (match[0].length === 0) {
			input.regex.lastIndex++
		}
	}
}

export async function searchWorkspaceText(request: SearchWorkspaceTextRequest): Promise<SearchWorkspaceTextResponse> {
	const searchRoot = getSearchRoot(request)
	if (!searchRoot) {
		return SearchWorkspaceTextResponse.create({ matches: [] })
	}

	const maxResults = request.maxResults && request.maxResults > 0 ? request.maxResults : DEFAULT_MAX_RESULTS
	const relativeBase = getRelativeBase(request, searchRoot)
	const regex = createRegex(request.regex)
	const files = await vscode.workspace.findFiles(getIncludePattern(request, searchRoot), undefined, MAX_CANDIDATE_FILES)
	const matches: SearchWorkspaceTextResponse["matches"] = []

	for (const uri of files) {
		const relativeToRoot = path.relative(searchRoot, uri.fsPath)
		if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot) || matches.length >= maxResults) {
			continue
		}

		const stat = await vscode.workspace.fs.stat(uri)
		if (stat.size > MAX_FILE_BYTES) {
			continue
		}

		const bytes = await vscode.workspace.fs.readFile(uri)
		const text = new TextDecoder("utf-8").decode(bytes)
		const lines = text.split(/\r?\n/)
		if (text.endsWith("\n")) {
			lines.pop()
		}

		for (let lineIndex = 0; lineIndex < lines.length && matches.length < maxResults; lineIndex++) {
			pushLineMatches({ matches, uri, relativeBase, lines, lineIndex, regex, maxResults })
		}
	}

	matches.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column)

	return SearchWorkspaceTextResponse.create({
		matches,
		limitHit: matches.length >= maxResults,
	})
}
