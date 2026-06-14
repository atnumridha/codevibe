import * as path from "node:path"
import * as vscode from "vscode"
import { regexSearchFileMatches } from "@services/ripgrep"
import { SearchWorkspaceTextRequest, SearchWorkspaceTextResponse } from "@/shared/proto/host/workspace"

const DEFAULT_MAX_RESULTS = 300
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

async function searchWorkspaceTextWithRipgrep(
	request: SearchWorkspaceTextRequest,
	searchRoot: string,
	relativeBase: string,
	maxResults: number,
): Promise<SearchWorkspaceTextResponse> {
	const results = await regexSearchFileMatches(
		relativeBase,
		searchRoot,
		request.regex,
		request.filePattern?.trim() || undefined,
		undefined,
		{ includeIgnored: request.includeIgnored },
	)
	const matches = results.slice(0, maxResults).map((result) => ({
		path: path.relative(relativeBase, result.filePath).split(path.sep).join("/"),
		line: result.line,
		column: result.column,
		match: normalizeSearchText(result.match),
		beforeContext: result.beforeContext.map(normalizeSearchText),
		afterContext: result.afterContext.map(normalizeSearchText),
	}))

	matches.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column)

	return SearchWorkspaceTextResponse.create({
		matches,
		limitHit: results.length > maxResults || matches.length >= maxResults,
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

	return searchWorkspaceTextWithRipgrep(request, searchRoot, relativeBase, maxResults)
}
