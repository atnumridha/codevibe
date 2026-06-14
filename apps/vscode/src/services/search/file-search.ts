import type { WorkspaceRoot } from "@shared/multi-root/types"
import * as childProcess from "child_process"
import * as fs from "fs"
import type { FzfResultItem } from "fzf"
import * as path from "path"
import * as readline from "readline"
import { WorkspaceRootManager } from "@/core/workspace"
import { HostProvider } from "@/hosts/host-provider"
import { GetActiveEditorRequest, GetOpenTabsRequest, GetVisibleTabsRequest } from "@/shared/proto/host/window"
import { SearchWorkspaceItemsRequest, SearchWorkspaceItemsRequest_SearchItemType } from "@/shared/proto/host/workspace"
import { Logger } from "@/shared/services/Logger"
import { filterIgnoredWorkspaceItems, type WorkspaceSearchItem } from "@/services/workspace/file-indexer"
import { getBinaryLocation } from "@/utils/fs"

/**
 * Indicates which backend served a workspace-files search.
 *
 * - `host_index`: served by the host's native file-name index (e.g. JetBrains FilenameIndex).
 * - `ripgrep`:    served by the bundled ripgrep walker (default everywhere).
 */
export type FileSearchSource = "host_index" | "ripgrep"

export type FileSearchPrivacyOptions = {
	cursorRetrievalIndexingPrivacyGate?: boolean
}

// Wrapper function for childProcess.spawn
export type SpawnFunction = typeof childProcess.spawn
export const getSpawnFunction = (): SpawnFunction => childProcess.spawn

// Wrapper function for childProcess.execFile
export type ExecFileFunction = typeof childProcess.execFile
export const getExecFileFunction = (): ExecFileFunction => childProcess.execFile

/** Thrown when ripgrep fails to spawn or exits non-zero. */
export class RipgrepError extends Error {
	public readonly stderr: string

	constructor(message: string, opts: { stderr?: string } = {}) {
		super(message)
		this.name = "RipgrepError"
		this.stderr = opts.stderr ?? ""
	}
}

export async function executeRipgrepForFiles(
	workspacePath: string,
	limit = 5000,
	options?: FileSearchPrivacyOptions,
): Promise<{ path: string; type: "file" | "folder"; label?: string }[]> {
	const rgPath = await resolveRipgrepPath()

	return new Promise((resolve, reject) => {
		// Arguments for ripgrep to list files, follow symlinks, include hidden, and exclude common directories
		const args = [
			"--files",
			"--follow",
			"--hidden",
			"-g",
			"!**/{node_modules,.git,.github,out,dist,__pycache__,.venv,.env,venv,env,.cache,tmp,temp}/**",
			workspacePath,
		]

		// Spawn the ripgrep process with the specified arguments
		const rgProcess = getSpawnFunction()(rgPath, args)
		const rl = readline.createInterface({ input: rgProcess.stdout })

		// Array to store file results and Set to track unique directories
		const fileResults: { path: string; type: "file" | "folder"; label?: string }[] = []
		const dirSet = new Set<string>()
		let count = 0
		let exitCode: number | null = null

		// Handle each line of output from ripgrep (each line is a file path)
		rl.on("line", (line) => {
			if (count >= limit) {
				rl.close()
				rgProcess.kill()
				return
			}

			// Convert absolute path to a relative path from workspace root
			const relativePath = path.relative(workspacePath, line)

			// Add file result to array
			fileResults.push({
				path: relativePath,
				type: "file",
				label: path.basename(relativePath),
			})

			// Extract and add parent directories to the set
			let dirPath = path.dirname(relativePath)
			while (dirPath && dirPath !== "." && dirPath !== "/") {
				dirSet.add(dirPath)
				dirPath = path.dirname(dirPath)
			}

			count++
		})

		// Capture any error output from ripgrep
		let errorOutput = ""
		rgProcess.stderr.on("data", (data) => {
			errorOutput += data.toString()
		})

		// On Windows the readline 'close' and the child-process 'exit' events
		// fire in non-deterministic order; await both so we can read exitCode
		// before deciding to resolve or reject.
		let resolveOutputClosed!: () => void
		const outputClosed = new Promise<void>((r) => {
			resolveOutputClosed = r
		})
		let resolveExited!: () => void
		const exited = new Promise<void>((r) => {
			resolveExited = r
		})

		rgProcess.on("exit", (code) => {
			exitCode = code
			resolveExited()
		})
		rl.on("close", () => resolveOutputClosed())

		Promise.all([outputClosed, exited]).then(() => {
			// A non-zero exit with results is normal — we proactively SIGTERM
			// after hitting the limit. Only reject when we have nothing to return.
			if (fileResults.length === 0 && (errorOutput || (exitCode !== null && exitCode !== 0))) {
				reject(
					new RipgrepError(
						errorOutput
							? `ripgrep exited with code ${exitCode}: ${errorOutput.trim()}`
							: `ripgrep exited with code ${exitCode}`,
						{ stderr: errorOutput.trim() },
					),
				)
				return
			}

			const dirResults = Array.from(dirSet, (dirPath): { path: string; type: "folder"; label?: string } => ({
				path: dirPath,
				type: "folder",
				label: path.basename(dirPath),
			}))
			filterWorkspaceItemsForPrivacy(workspacePath, [...fileResults, ...dirResults], options)
				.then(resolve)
				.catch(reject)
		})

		rgProcess.on("error", (error) => {
			reject(new RipgrepError(`ripgrep failed to spawn: ${error.message}`))
		})
	})
}

async function resolveRipgrepPath(): Promise<string> {
	try {
		return await getBinaryLocation("rg")
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		const fallback = await findSystemRipgrep()
		Logger.warn(`[file-search] bundled ripgrep unavailable, trying ${fallback}: ${message}`)
		return fallback
	}
}

async function findSystemRipgrep(): Promise<string> {
	const fallback = process.platform === "win32" ? "rg.exe" : "rg"
	const candidates = process.platform === "win32" ? [] : ["/usr/bin/rg", "/opt/homebrew/bin/rg", "/usr/local/bin/rg"]

	for (const candidate of candidates) {
		try {
			await fs.promises.access(candidate, fs.constants.X_OK)
			return candidate
		} catch {
			// Keep looking; the bare command is the final PATH-based fallback.
		}
	}

	return fallback
}

function shouldFilterIgnoredWorkspaceItems(options?: FileSearchPrivacyOptions): boolean {
	return options?.cursorRetrievalIndexingPrivacyGate !== false
}

async function filterWorkspaceItemsForPrivacy<T extends WorkspaceSearchItem>(
	workspacePath: string,
	items: T[],
	options?: FileSearchPrivacyOptions,
): Promise<T[]> {
	return shouldFilterIgnoredWorkspaceItems(options) ? ((await filterIgnoredWorkspaceItems(workspacePath, items)) as T[]) : items
}

function absolutePathToWorkspaceItem(workspacePath: string, filePath?: string): WorkspaceSearchItem | undefined {
	if (!filePath || !(filePath.startsWith(workspacePath + path.sep) || filePath.startsWith(workspacePath + "/"))) {
		return undefined
	}
	const relativePath = path.relative(workspacePath, filePath)
	const normalizedPath = relativePath.replace(/\\/g, "/")
	return {
		path: normalizedPath,
		type: "file",
		label: path.basename(normalizedPath),
	}
}

async function getWindowFilePaths(label: string, read: () => Promise<string[]>): Promise<string[]> {
	try {
		return await read()
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		Logger.warn(`[file-search] failed to read ${label}, continuing without that retrieval boost: ${message}`)
		return []
	}
}

async function getWindowFileCandidates(
	workspacePath: string,
	selectedType?: "file" | "folder",
): Promise<RankedWorkspaceSearchItem[]> {
	if (selectedType === "folder") {
		return []
	}

	const [activeEditorPaths, visibleTabPaths, openTabPaths] = await Promise.all([
		getWindowFilePaths("active editor", async () => {
			const response = await HostProvider.window.getActiveEditor(GetActiveEditorRequest.create({}))
			return response.filePath ? [response.filePath] : []
		}),
		getWindowFilePaths("visible tabs", async () => {
			const response = await HostProvider.window.getVisibleTabs(GetVisibleTabsRequest.create({}))
			return response.paths
		}),
		getWindowFilePaths("open tabs", async () => {
			const response = await HostProvider.window.getOpenTabs(GetOpenTabsRequest.create({}))
			return response.paths
		}),
	])

	const candidates: RankedWorkspaceSearchItem[] = []
	const seenPaths = new Set<string>()
	for (const [boost, paths] of [
		["active", activeEditorPaths],
		["visible", visibleTabPaths],
		["recent", openTabPaths],
	] as const) {
		for (const filePath of paths) {
			const item = absolutePathToWorkspaceItem(workspacePath, filePath)
			if (item) {
				addUniqueCandidate(candidates, seenPaths, { ...item, retrievalBoost: boost })
			}
		}
	}
	return candidates
}

// Maximum number of candidates to ask the host for. The result is filtered &
// ranked by fzf in core, so we want a comfortably wider net than `limit`.
const HOST_INDEX_CANDIDATE_LIMIT = 5000
const GIT_CHANGED_CANDIDATE_LIMIT = 200
const GIT_CHANGED_CACHE_TTL_MS = 2_000
const DEPENDENCY_CANDIDATE_LIMIT = 200
const DEPENDENCY_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".scss", ".md"]

type RetrievalBoost = "active" | "visible" | "recent" | "git_changed" | "dependency"
type RankedWorkspaceSearchItem = WorkspaceSearchItem & { retrievalBoost?: RetrievalBoost }

type GitChangedCacheEntry = {
	items: WorkspaceSearchItem[]
	queriedAt: number
	pending?: Promise<WorkspaceSearchItem[]>
}

const gitChangedCache = new Map<string, GitChangedCacheEntry>()

// gRPC status code 12 — the standalone host returns this when the RPC isn't
// registered (the in-process VS Code stub throws a plain Error, matched on
// message instead). Treat both as silent steady-state, not failure.
const GRPC_STATUS_UNIMPLEMENTED = 12

/**
 * Returns candidates from the host's native index, or `null` when the host
 * doesn't implement the RPC / the index is unavailable. Returning `[]` is
 * authoritative — caller does not fall back to ripgrep.
 */
async function executeHostIndexForFiles(
	query: string,
	workspacePath: string,
	selectedType?: "file" | "folder",
	options?: FileSearchPrivacyOptions,
): Promise<{ path: string; type: "file" | "folder"; label?: string }[] | null> {
	try {
		const req = SearchWorkspaceItemsRequest.create({
			query,
			workspacePath,
			limit: HOST_INDEX_CANDIDATE_LIMIT,
			includeIgnored: !shouldFilterIgnoredWorkspaceItems(options),
			selectedType:
				selectedType === "file"
					? SearchWorkspaceItemsRequest_SearchItemType.FILE
					: selectedType === "folder"
						? SearchWorkspaceItemsRequest_SearchItemType.FOLDER
						: undefined,
		})
		const resp = await HostProvider.workspace.searchWorkspaceItems(req)

		// Pre-pass: collect host-provided folder paths so the parent-walk below
		// doesn't re-add them as inferred parents and double-list them.
		const folderPaths = new Set<string>()
		for (const item of resp.items) {
			if (item.type === SearchWorkspaceItemsRequest_SearchItemType.FOLDER) {
				folderPaths.add(item.path)
			}
		}

		const fileResults: { path: string; type: "file" | "folder"; label?: string }[] = []
		const dirSet = new Set<string>()
		for (const item of resp.items) {
			const isFolder = item.type === SearchWorkspaceItemsRequest_SearchItemType.FOLDER
			fileResults.push({
				path: item.path,
				type: isFolder ? "folder" : "file",
				label: item.label || path.basename(item.path),
			})
			if (!isFolder) {
				let dirPath = path.dirname(item.path)
				while (dirPath && dirPath !== "." && dirPath !== "/") {
					if (!folderPaths.has(dirPath)) {
						dirSet.add(dirPath)
					}
					dirPath = path.dirname(dirPath)
				}
			}
		}
		const dirResults = Array.from(dirSet, (dirPath): { path: string; type: "folder"; label?: string } => ({
			path: dirPath,
			type: "folder",
			label: path.basename(dirPath),
		}))
		return [...fileResults, ...dirResults]
	} catch (err) {
		// "Unimplemented" is the steady state on VS Code/CLI/ACP — every
		// keystroke trips it — so log at debug to keep the noise floor flat.
		// Anything else (UNAVAILABLE during indexing, INTERNAL, transport
		// errors) is a real degradation we want visible to operators, since
		// the caller is about to silently fall back to a much slower path.
		const code = (err as { code?: unknown } | null)?.code
		const msg = (err as { message?: string } | null)?.message ?? ""
		const isUnimplemented = code === GRPC_STATUS_UNIMPLEMENTED || /not implemented/i.test(msg)
		if (isUnimplemented) {
			Logger.debug("[file-search] host index unimplemented, using ripgrep")
		} else {
			Logger.warn(`[file-search] host index call failed (code=${String(code)}), falling back to ripgrep: ${msg}`)
		}
		return null
	}
}

function parseGitStatusPorcelainZ(output: string): string[] {
	const fields = output.split("\0").filter(Boolean)
	const changedPaths: string[] = []

	for (let index = 0; index < fields.length; index++) {
		const field = fields[index]
		if (field.length < 4) {
			continue
		}

		const status = field.slice(0, 2)
		const filePath = field.startsWith(`${status} `) ? field.slice(3) : field.slice(2).trimStart()
		if (!filePath || status.includes("D")) {
			continue
		}

		changedPaths.push(filePath)

		if ((status[0] === "R" || status[0] === "C" || status[1] === "R" || status[1] === "C") && index + 1 < fields.length) {
			index++
		}
	}

	return changedPaths
}

function normalizeGitChangedPath(workspacePath: string, gitPath: string): string | undefined {
	const relativePath = path.isAbsolute(gitPath) ? path.relative(workspacePath, gitPath) : gitPath
	const absolutePath = path.resolve(workspacePath, relativePath)
	const relativeToWorkspace = path.relative(path.resolve(workspacePath), absolutePath)

	if (!relativeToWorkspace || relativeToWorkspace.startsWith("..") || path.isAbsolute(relativeToWorkspace)) {
		return undefined
	}

	return relativeToWorkspace.replace(/\\/g, "/")
}

async function readGitChangedFiles(workspacePath: string): Promise<WorkspaceSearchItem[]> {
	const output = await new Promise<string>((resolve, reject) => {
		const execFile = getExecFileFunction()
		execFile(
			"git",
			["status", "--porcelain", "-z", "--untracked-files=all"],
			{ cwd: workspacePath, encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 2_000 },
			(error, stdout) => {
				if (error) {
					reject(error)
					return
				}
				resolve(stdout)
			},
		)
	})

	const seen = new Set<string>()
	const items: WorkspaceSearchItem[] = []
	for (const gitPath of parseGitStatusPorcelainZ(output)) {
		if (items.length >= GIT_CHANGED_CANDIDATE_LIMIT) {
			break
		}

		const normalizedPath = normalizeGitChangedPath(workspacePath, gitPath)
		if (!normalizedPath || seen.has(normalizedPath)) {
			continue
		}

		seen.add(normalizedPath)
		items.push({
			path: normalizedPath,
			type: "file",
			label: path.basename(normalizedPath),
		})
	}

	return items
}

async function getGitChangedFiles(
	workspacePath: string,
	selectedType?: "file" | "folder",
): Promise<WorkspaceSearchItem[]> {
	if (selectedType === "folder") {
		return []
	}

	const now = Date.now()
	const cached = gitChangedCache.get(workspacePath)
	if (cached?.pending) {
		return cached.pending
	}
	if (cached && now - cached.queriedAt < GIT_CHANGED_CACHE_TTL_MS) {
		return cached.items
	}

	const pending = readGitChangedFiles(workspacePath)
		.catch((error) => {
			const message = error instanceof Error ? error.message : String(error)
			Logger.debug(`[file-search] git changed candidates unavailable: ${message}`)
			return []
		})
		.then((items) => {
			gitChangedCache.set(workspacePath, { items, queriedAt: Date.now() })
			return items
		})

	gitChangedCache.set(workspacePath, { items: cached?.items ?? [], queriedAt: cached?.queriedAt ?? 0, pending })
	return pending
}

function extractRelativeImportSpecifiers(source: string): string[] {
	const specifiers = new Set<string>()
	const importPattern =
		/(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)/g
	let match: RegExpExecArray | null
	while ((match = importPattern.exec(source))) {
		const specifier = match[1] || match[2] || match[3]
		if (specifier?.startsWith(".")) {
			specifiers.add(specifier)
		}
	}
	return Array.from(specifiers)
}

function getDependencyResolutionCandidates(importerPath: string, specifier: string): string[] {
	const importerDir = path.dirname(importerPath)
	const rawTarget = path.normalize(path.join(importerDir, specifier))
	const candidates = [rawTarget]
	for (const extension of DEPENDENCY_EXTENSIONS) {
		candidates.push(`${rawTarget}${extension}`)
		candidates.push(path.join(rawTarget, `index${extension}`))
	}
	return candidates.map((candidate) => candidate.replace(/\\/g, "/"))
}

async function resolveDependencyPath(workspacePath: string, relativeCandidate: string): Promise<WorkspaceSearchItem | undefined> {
	const absoluteCandidate = path.resolve(workspacePath, relativeCandidate)
	const relativeToWorkspace = path.relative(path.resolve(workspacePath), absoluteCandidate)
	if (!relativeToWorkspace || relativeToWorkspace.startsWith("..") || path.isAbsolute(relativeToWorkspace)) {
		return undefined
	}
	try {
		const stats = await fs.promises.stat(absoluteCandidate)
		if (!stats.isFile()) {
			return undefined
		}
		const normalizedPath = relativeToWorkspace.replace(/\\/g, "/")
		return {
			path: normalizedPath,
			type: "file",
			label: path.basename(normalizedPath),
		}
	} catch {
		return undefined
	}
}

async function getDependencyCandidates(
	workspacePath: string,
	seedItems: WorkspaceSearchItem[],
	selectedType?: "file" | "folder",
): Promise<WorkspaceSearchItem[]> {
	if (selectedType === "folder" || seedItems.length === 0) {
		return []
	}

	const dependencies: WorkspaceSearchItem[] = []
	const seenPaths = new Set(seedItems.map((item) => item.path))
	for (const seedItem of seedItems) {
		if (dependencies.length >= DEPENDENCY_CANDIDATE_LIMIT || seedItem.type !== "file") {
			continue
		}

		try {
			const source = await fs.promises.readFile(path.join(workspacePath, seedItem.path), "utf8")
			for (const specifier of extractRelativeImportSpecifiers(source)) {
				if (dependencies.length >= DEPENDENCY_CANDIDATE_LIMIT) {
					break
				}
				for (const candidatePath of getDependencyResolutionCandidates(seedItem.path, specifier)) {
					const dependency = await resolveDependencyPath(workspacePath, candidatePath)
					if (dependency && !seenPaths.has(dependency.path)) {
						seenPaths.add(dependency.path)
						dependencies.push(dependency)
						break
					}
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			Logger.debug(`[file-search] dependency expansion skipped ${seedItem.path}: ${message}`)
		}
	}

	return dependencies
}

function withRetrievalBoost(items: WorkspaceSearchItem[], retrievalBoost: RetrievalBoost): RankedWorkspaceSearchItem[] {
	return items.map((item) => ({ ...item, retrievalBoost }))
}

function addUniqueCandidate(
	items: RankedWorkspaceSearchItem[],
	seenPaths: Set<string>,
	item: RankedWorkspaceSearchItem,
): void {
	if (seenPaths.has(item.path)) {
		return
	}
	seenPaths.add(item.path)
	items.push(item)
}

function toSearchResultItem(item: RankedWorkspaceSearchItem, workspaceName?: string): SearchWorkspaceFilesResult["items"][number] {
	const { retrievalBoost: _retrievalBoost, ...searchItem } = item
	return workspaceName ? { ...searchItem, workspaceName } : searchItem
}

function getFzfSelector(item: { label?: string; path: string; retrievalBoost?: RetrievalBoost }): string {
	const label = item.label || ""
	const boost = item.retrievalBoost ? `${label} ${item.path}` : ""
	return `${label} ${label} ${boost} ${item.path}`
}

export type SearchWorkspaceFilesResult = {
	items: { path: string; type: "file" | "folder"; label?: string; workspaceName?: string }[]
	source: FileSearchSource
}

export async function searchWorkspaceFiles(
	query: string,
	workspacePath: string,
	limit = 20,
	selectedType?: "file" | "folder",
	workspaceName?: string,
	options?: FileSearchPrivacyOptions,
): Promise<SearchWorkspaceFilesResult> {
	try {
		const windowCandidates = await getWindowFileCandidates(workspacePath, selectedType)

		const hostItems = await executeHostIndexForFiles(query, workspacePath, selectedType, options)

		const allItems = hostItems
			? await filterWorkspaceItemsForPrivacy(workspacePath, hostItems, options)
			: await executeRipgrepForFiles(workspacePath, 5000, options)
		const source: FileSearchSource = hostItems ? "host_index" : "ripgrep"
		const [allowedWindowCandidates, allowedGitChangedFiles] = await Promise.all([
			filterWorkspaceItemsForPrivacy(workspacePath, windowCandidates, options),
			getGitChangedFiles(workspacePath, selectedType).then((items) => filterWorkspaceItemsForPrivacy(workspacePath, items, options)),
		])
		const allowedDependencyFiles = await getDependencyCandidates(workspacePath, [
			...allowedWindowCandidates,
			...allowedGitChangedFiles,
		]).then((items) => filterWorkspaceItemsForPrivacy(workspacePath, items, options))

		// Combine high-signal retrieval candidates before broad index results,
		// removing duplicates like the old WorkspaceTracker path cache.
		const combinedItems: RankedWorkspaceSearchItem[] = []
		const seenPaths = new Set<string>()
		for (const item of [
			...allowedWindowCandidates,
			...withRetrievalBoost(allowedGitChangedFiles, "git_changed"),
			...withRetrievalBoost(allowedDependencyFiles, "dependency"),
			...allItems,
		]) {
			addUniqueCandidate(combinedItems, seenPaths, item)
		}

		// If no query, return the combined items
		if (!query.trim()) {
			const addWorkspaceName = (items: typeof combinedItems) => items.map((item) => toSearchResultItem(item, workspaceName))

			let items: SearchWorkspaceFilesResult["items"]
			if (selectedType === "file") {
				items = addWorkspaceName(combinedItems.filter((item) => item.type === "file").slice(0, limit))
			} else if (selectedType === "folder") {
				items = addWorkspaceName(combinedItems.filter((item) => item.type === "folder").slice(0, limit))
			} else {
				items = addWorkspaceName(combinedItems.slice(0, limit))
			}
			return { items, source }
		}

		// Match Scoring - Prioritize the label (filename) by including it twice in the search string
		// Use multiple tiebreakers in order of importance: Match score, then length of match (shorter=better)
		// Get more (2x) results than needed for filtering, we pick the top half after sorting
		const fzfModule = await import("fzf")
		const fzf = new fzfModule.Fzf(combinedItems, {
			selector: getFzfSelector,
			tiebreakers: [OrderbyMatchScore, fzfModule.byLengthAsc],
			limit: limit * 2,
		})

		const filteredResults = fzf.find(query).slice(0, limit)

		// Verify if the path exists and is actually a directory
		const verifiedResultsPromises = filteredResults.map(
			async ({ item }: { item: { path: string; type: "file" | "folder"; label?: string } }) => {
				const fullPath = path.join(workspacePath, item.path)
				let type = item.type

				try {
					const stats = await fs.promises.lstat(fullPath)
					type = stats.isDirectory() ? "folder" : "file"
				} catch {
					// Keep original type if path doesn't exist
				}

				return toSearchResultItem({ ...item, type }, workspaceName)
			},
		)

		const items = await Promise.all(verifiedResultsPromises)
		return { items, source }
	} catch (error) {
		// Re-throw so the controller can attach a structured error_reason.
		Logger.error("Error in searchWorkspaceFiles:", error)
		throw error
	}
}

// Custom match scoring for results ordering
// Candidate score tiebreaker - fewer gaps between matched characters scores higher
export const OrderbyMatchScore = (a: FzfResultItem<any>, b: FzfResultItem<any>) => {
	const countGaps = (positions: Iterable<number>) => {
		let gaps = 0,
			prev = Number.NEGATIVE_INFINITY
		for (const pos of positions) {
			if (prev !== Number.NEGATIVE_INFINITY && pos - prev > 1) {
				gaps++
			}
			prev = pos
		}
		return gaps
	}

	return countGaps(a.positions) - countGaps(b.positions)
}

/**
 * Search for files across multiple workspace roots or a specific workspace
 * Similar to searchWorkspaceFiles but supports multiroot workspaces
 */
export async function searchWorkspaceFilesMultiroot(
	query: string,
	workspaceManager: WorkspaceRootManager,
	limit = 20,
	selectedType?: "file" | "folder",
	workspaceHint?: string,
	options?: FileSearchPrivacyOptions,
): Promise<SearchWorkspaceFilesResult> {
	try {
		const workspaceRoots = workspaceManager?.getRoots?.() || []

		if (workspaceRoots.length === 0) {
			return { items: [], source: "ripgrep" }
		}

		let workspacesToSearch: WorkspaceRoot[] = []

		// Search only the user-specified workspace (Ex input: @frontend:/query)
		if (workspaceHint) {
			const targetWorkspace = workspaceRoots.find((root: WorkspaceRoot) => root.name === workspaceHint)
			if (targetWorkspace) {
				workspacesToSearch = [targetWorkspace]
			} else {
				return { items: [], source: "ripgrep" }
			}
		} else {
			// Search all workspaces if no hint provided
			workspacesToSearch = workspaceRoots
		}

		// In a true multi-root search, swallow per-root errors so a single broken
		// root doesn't kill the rest; we still re-throw below if *every* root
		// failed. In single-root mode the throw propagates up unchanged.
		let firstError: unknown
		const searchPromises = workspacesToSearch.map(async (workspace): Promise<SearchWorkspaceFilesResult> => {
			try {
				return await searchWorkspaceFiles(query, workspace.path, limit, selectedType, workspace.name, options)
			} catch (error) {
				if (!firstError) {
					firstError = error
				}
				Logger.error(`[searchWorkspaceFilesMultiroot] Error searching workspace ${workspace.name}:`, error)
				return { items: [], source: "ripgrep" }
			}
		})

		// Aggregate per-root results. The combined `source` is `host_index`
		// only if every contributing root reported `host_index`; if any root
		// fell back to ripgrep we report `ripgrep` so telemetry isn't misleading.
		const allResults = await Promise.all(searchPromises)
		let flatResults: SearchWorkspaceFilesResult["items"] = allResults.flatMap((r) => r.items)
		const aggregateSource: FileSearchSource =
			allResults.length > 0 && allResults.every((r) => r.source === "host_index") ? "host_index" : "ripgrep"
		if (workspacesToSearch.length > 1) {
			const pathCounts = new Map<string, number>()
			for (const result of flatResults) {
				pathCounts.set(result.path, (pathCounts.get(result.path) || 0) + 1)
			}

			flatResults = flatResults.map((result) => {
				if (pathCounts.get(result.path)! > 1 && result.workspaceName) {
					return {
						...result,
						label: `${result.workspaceName}:/${result.path}`,
					}
				}
				return result
			})
		}

		// Apply fuzzy matching across all results if needed
		if (query.trim() && flatResults.length > limit) {
			const fzfModule = await import("fzf")
			const fzf = new fzfModule.Fzf(flatResults, {
				selector: (item: { label?: string; path: string }) => `${item.label || ""} ${item.label || ""} ${item.path}`,
				tiebreakers: [OrderbyMatchScore, fzfModule.byLengthAsc],
			})
			flatResults = fzf
				.find(query)
				.slice(0, limit)
				.map((result) => result.item)
		} else {
			flatResults = flatResults.slice(0, limit)
		}

		if (firstError && flatResults.length === 0) {
			throw firstError
		}

		return { items: flatResults, source: aggregateSource }
	} catch (error) {
		Logger.error("[searchWorkspaceFilesMultiroot] Error in multiroot search:", error)
		throw error
	}
}
