import * as path from "node:path"
import * as vscode from "vscode"
import { SearchWorkspaceTextRequest, SearchWorkspaceTextResponse } from "@/shared/proto/host/workspace"

const DEFAULT_MAX_RESULTS = 300
const MAX_CANDIDATE_FILES = 5000
const MAX_FILE_BYTES = 1_000_000
const CONTEXT_LINES = 1
const PREVIEW_CHARS_PER_LINE = 20_000

type VscodePositionLike = {
	line: number
	character: number
}

type VscodeRangeLike = {
	start: VscodePositionLike
	end: VscodePositionLike
}

type NativeTextSearchResult = NativeTextSearchMatch | NativeTextSearchContext

type NativeTextSearchMatch = {
	uri: vscode.Uri
	ranges: VscodeRangeLike | VscodeRangeLike[]
	preview: {
		text: string
		matches: VscodeRangeLike | VscodeRangeLike[]
	}
}

type NativeTextSearchContext = {
	uri: vscode.Uri
	text: string
	lineNumber: number
}

type NativeTextSearchComplete = {
	limitHit?: boolean
}

type NativeFindTextInFilesOptions = {
	include?: vscode.GlobPattern
	exclude?: vscode.GlobPattern
	useDefaultExcludes?: boolean
	maxResults?: number
	useIgnoreFiles?: boolean
	useGlobalIgnoreFiles?: boolean
	useParentIgnoreFiles?: boolean
	followSymlinks?: boolean
	encoding?: string
	previewOptions?: {
		matchLines: number
		charsPerLine: number
	}
	beforeContext?: number
	afterContext?: number
}

type NativeWorkspace = typeof vscode.workspace & {
	findTextInFiles?: (
		query: { pattern: string; isRegExp?: boolean },
		options: NativeFindTextInFilesOptions,
		callback: (result: NativeTextSearchResult) => void,
		token?: vscode.CancellationToken,
	) => PromiseLike<NativeTextSearchComplete | undefined>
}

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

function asArray<T>(value: T | T[] | undefined): T[] {
	if (value === undefined) {
		return []
	}
	return Array.isArray(value) ? value : [value]
}

function isNativeTextSearchMatch(result: NativeTextSearchResult): result is NativeTextSearchMatch {
	return "ranges" in result && "preview" in result
}

function normalizeSearchText(text: string): string {
	return text.replace(/\r?\n$/, "")
}

function getPreviewLine(previewText: string, previewRange: VscodeRangeLike | undefined): string {
	const lines = normalizeSearchText(previewText).split(/\r?\n/)
	if (lines.length === 0) {
		return ""
	}

	const previewLine = Math.max(0, Math.min(previewRange?.start.line ?? 0, lines.length - 1))
	return lines[previewLine] ?? lines[0] ?? ""
}

function getContextKey(matchPath: string): string {
	return matchPath
}

function recordNativeContext(
	contexts: Map<string, Map<number, string>>,
	relativeBase: string,
	context: NativeTextSearchContext,
): void {
	const matchPath = path.relative(relativeBase, context.uri.fsPath).split(path.sep).join("/")
	const key = getContextKey(matchPath)
	let fileContexts = contexts.get(key)
	if (!fileContexts) {
		fileContexts = new Map<number, string>()
		contexts.set(key, fileContexts)
	}
	fileContexts.set(context.lineNumber + 1, normalizeSearchText(context.text))
}

function attachNativeContexts(
	matches: SearchWorkspaceTextResponse["matches"],
	contexts: Map<string, Map<number, string>>,
): SearchWorkspaceTextResponse["matches"] {
	return matches.map((match) => {
		const fileContexts = contexts.get(getContextKey(match.path))
		if (!fileContexts) {
			return match
		}

		const beforeContext: string[] = []
		for (let line = match.line - CONTEXT_LINES; line < match.line; line++) {
			const context = fileContexts.get(line)
			if (context !== undefined) {
				beforeContext.push(context)
			}
		}

		const afterContext: string[] = []
		for (let line = match.line + 1; line <= match.line + CONTEXT_LINES; line++) {
			const context = fileContexts.get(line)
			if (context !== undefined) {
				afterContext.push(context)
			}
		}

		return {
			...match,
			beforeContext,
			afterContext,
		}
	})
}

async function searchWorkspaceTextWithNativeApi(
	request: SearchWorkspaceTextRequest,
	searchRoot: string,
	relativeBase: string,
	maxResults: number,
): Promise<SearchWorkspaceTextResponse | undefined> {
	const nativeWorkspace = vscode.workspace as NativeWorkspace
	if (typeof nativeWorkspace.findTextInFiles !== "function") {
		return undefined
	}

	const matches: SearchWorkspaceTextResponse["matches"] = []
	const contexts = new Map<string, Map<number, string>>()

	const complete = await nativeWorkspace.findTextInFiles(
		{ pattern: request.regex, isRegExp: true },
		{
			include: getIncludePattern(request, searchRoot),
			maxResults,
			beforeContext: CONTEXT_LINES,
			afterContext: CONTEXT_LINES,
			previewOptions: {
				matchLines: 1,
				charsPerLine: PREVIEW_CHARS_PER_LINE,
			},
			useDefaultExcludes: !request.includeIgnored,
			useIgnoreFiles: !request.includeIgnored,
			useGlobalIgnoreFiles: !request.includeIgnored,
			useParentIgnoreFiles: !request.includeIgnored,
			followSymlinks: true,
		},
		(result) => {
			if (!isNativeTextSearchMatch(result)) {
				recordNativeContext(contexts, relativeBase, result)
				return
			}

			const resultRanges = asArray(result.ranges)
			const previewRanges = asArray(result.preview.matches)
			for (let index = 0; index < resultRanges.length && matches.length < maxResults; index++) {
				const range = resultRanges[index]
				if (!range) {
					continue
				}

				matches.push({
					path: path.relative(relativeBase, result.uri.fsPath).split(path.sep).join("/"),
					line: range.start.line + 1,
					column: range.start.character,
					match: getPreviewLine(result.preview.text, previewRanges[index] ?? previewRanges[0]),
					beforeContext: [],
					afterContext: [],
				})
			}
		},
	)

	const resolvedMatches = attachNativeContexts(matches, contexts)
	resolvedMatches.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column)

	return SearchWorkspaceTextResponse.create({
		matches: resolvedMatches,
		limitHit: complete?.limitHit || resolvedMatches.length >= maxResults,
	})
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

	const nativeResult = await searchWorkspaceTextWithNativeApi(request, searchRoot, relativeBase, maxResults)
	if (nativeResult) {
		return nativeResult
	}

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
