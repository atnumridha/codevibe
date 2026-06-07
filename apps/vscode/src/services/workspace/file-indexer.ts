import { spawn } from "node:child_process"
import type { Dirent } from "node:fs"
import { readdir } from "node:fs/promises"
import path from "node:path"
import {
	type IgnoreRule,
	buildIgnoreRulesForPaths,
	hasNegatedDescendantRule,
	isPathIgnored,
	normalizeRelativePath,
	parentDirs,
	readIgnoreRules,
	shouldSkipWalkError,
	toPosixRelative,
} from "./ignore-rules"

const DEFAULT_INDEX_TTL_MS = 15_000
const STALE_CACHE_EVICTION_MS = 10 * 60_000
const DEFAULT_EXCLUDE_DIRS = new Set([
	".cache",
	".env",
	".git",
	".github",
	".next",
	".turbo",
	".venv",
	"__pycache__",
	"build",
	"coverage",
	"dist",
	"env",
	"node_modules",
	"out",
	"target",
	"temp",
	"tmp",
	"venv",
])

interface CacheEntry {
	files: Set<string>
	lastBuiltAt: number
	lastAccessedAt: number
	pending: Promise<Set<string>> | null
}

export interface WorkspaceFileIndexOptions {
	ttlMs?: number
	includeIgnored?: boolean
}

export interface WorkspaceSearchItem {
	path: string
	type: "file" | "folder"
	label?: string
}

const CACHE = new Map<string, CacheEntry>()

function pruneStaleCacheEntries(now: number): void {
	if (CACHE.size <= 1) {
		return
	}
	for (const [cwd, entry] of CACHE.entries()) {
		if (entry.pending) {
			continue
		}
		if (now - entry.lastAccessedAt > STALE_CACHE_EVICTION_MS) {
			CACHE.delete(cwd)
		}
	}
}

function collectFolderItems(files: Iterable<string>): WorkspaceSearchItem[] {
	const folders = new Set<string>()
	for (const file of files) {
		for (const dir of parentDirs(file)) {
			folders.add(dir)
		}
	}
	return Array.from(folders, (folderPath) => ({
		path: folderPath,
		type: "folder" as const,
		label: path.basename(folderPath),
	}))
}

function isDefaultExcludedPath(relativePath: string): boolean {
	return normalizeRelativePath(relativePath)
		.split("/")
		.some((segment) => DEFAULT_EXCLUDE_DIRS.has(segment))
}

async function filterIgnoredFiles(cwd: string, files: Set<string>): Promise<Set<string>> {
	const rules = await buildIgnoreRulesForPaths(cwd, files)
	return new Set(Array.from(files).filter((file) => !isDefaultExcludedPath(file) && !isPathIgnored(file, false, rules)))
}

function filterDefaultExcludedFiles(files: Set<string>): Set<string> {
	return new Set(Array.from(files).filter((file) => !isDefaultExcludedPath(file)))
}

async function listFilesWithRg(cwd: string): Promise<Set<string>> {
	const output = await new Promise<string>((resolve, reject) => {
		const child = spawn("rg", ["--files", "--hidden", "-g", "!.git"], {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		})

		let stdout = ""
		let stderr = ""

		child.stdout.on("data", (chunk: Buffer | string) => {
			stdout += chunk.toString()
		})
		child.stderr.on("data", (chunk: Buffer | string) => {
			stderr += chunk.toString()
		})
		child.on("error", reject)
		child.on("close", (code: number | null) => {
			if (code === 0) {
				resolve(stdout)
				return
			}
			reject(new Error(stderr || `rg exited with code ${code}`))
		})
	})

	const files = output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => normalizeRelativePath(line))

	return new Set(files)
}

async function walkDir(
	cwd: string,
	dir: string,
	files: Set<string>,
	rules: IgnoreRule[],
	options: { includeIgnored?: boolean } = {},
): Promise<void> {
	let entries: Dirent[]
	try {
		entries = await readdir(dir, { withFileTypes: true })
	} catch (error) {
		if (shouldSkipWalkError(error)) {
			return
		}
		throw error
	}

	const relativeDir = normalizeRelativePath(toPosixRelative(cwd, dir))
	const activeRules = options.includeIgnored
		? rules
		: [...rules, ...(await readIgnoreRules(cwd, relativeDir === "." ? "" : relativeDir))]
	for (const entry of entries) {
		const absolutePath = path.join(dir, entry.name)
		const relativePath = toPosixRelative(cwd, absolutePath)
		if (entry.isDirectory()) {
			const ignoredDirectory = !options.includeIgnored && isPathIgnored(relativePath, true, activeRules)
			if (DEFAULT_EXCLUDE_DIRS.has(entry.name) || (ignoredDirectory && !hasNegatedDescendantRule(relativePath, activeRules))) {
				continue
			}
			try {
				await walkDir(cwd, absolutePath, files, activeRules, options)
			} catch (error) {
				if (shouldSkipWalkError(error)) {
					continue
				}
				throw error
			}
			continue
		}
		if (
			entry.isFile() &&
			!isDefaultExcludedPath(relativePath) &&
			(options.includeIgnored || !isPathIgnored(relativePath, false, activeRules))
		) {
			files.add(relativePath)
		}
	}
}

async function listFilesFallback(cwd: string, options: { includeIgnored?: boolean } = {}): Promise<Set<string>> {
	const files = new Set<string>()
	await walkDir(cwd, cwd, files, [], options)
	return files
}

async function buildIndex(cwd: string, options: WorkspaceFileIndexOptions): Promise<Set<string>> {
	try {
		const files = await listFilesWithRg(cwd)
		return options.includeIgnored ? filterDefaultExcludedFiles(files) : await filterIgnoredFiles(cwd, files)
	} catch {
		return listFilesFallback(cwd, options)
	}
}

export async function getFileIndex(cwd: string, options: WorkspaceFileIndexOptions = {}): Promise<Set<string>> {
	const ttlMs = options.ttlMs ?? DEFAULT_INDEX_TTL_MS
	const now = Date.now()
	pruneStaleCacheEntries(now)
	const cacheKey = `${cwd}\0${options.includeIgnored === true ? "include-ignored" : "filtered"}`
	const existing = CACHE.get(cacheKey)

	if (existing && ttlMs > 0 && now - existing.lastBuiltAt <= ttlMs && existing.files.size > 0) {
		existing.lastAccessedAt = now
		return existing.files
	}

	if (existing?.pending) {
		existing.lastAccessedAt = now
		return existing.pending
	}

	const pending = buildIndex(cwd, options).then((files) => {
		CACHE.set(cacheKey, {
			files,
			lastBuiltAt: Date.now(),
			lastAccessedAt: Date.now(),
			pending: null,
		})
		return files
	})

	CACHE.set(cacheKey, {
		files: existing?.files ?? new Set<string>(),
		lastBuiltAt: existing?.lastBuiltAt ?? 0,
		lastAccessedAt: now,
		pending,
	})

	return pending
}

export async function getWorkspaceSearchItems(
	cwd: string,
	options: WorkspaceFileIndexOptions = {},
): Promise<WorkspaceSearchItem[]> {
	const files = await getFileIndex(cwd, options)
	const fileItems = Array.from(files, (file): WorkspaceSearchItem => ({
		path: file,
		type: "file",
		label: path.basename(file),
	}))
	return [...fileItems, ...collectFolderItems(files)]
}

export async function filterIgnoredWorkspaceItems(cwd: string, items: WorkspaceSearchItem[]): Promise<WorkspaceSearchItem[]> {
	const rules = await buildIgnoreRulesForPaths(
		cwd,
		items.map((item) => item.path),
	)
	const allowedFileParents = new Set<string>()

	const allowedItems = items.filter((item) => {
		if (item.type === "folder") {
			return false
		}
		const allowed = !isPathIgnored(item.path, false, rules)
		if (allowed) {
			for (const dir of parentDirs(item.path)) {
				allowedFileParents.add(dir)
			}
		}
		return allowed
	})

	for (const item of items) {
		if (item.type !== "folder") {
			continue
		}
		if (!isPathIgnored(item.path, true, rules) || allowedFileParents.has(normalizeRelativePath(item.path))) {
			allowedItems.push(item)
		}
	}

	return allowedItems
}
