import { workspaceResolver } from "@core/workspace"
import {
	type IgnoreRule,
	WORKSPACE_GIT_IGNORE_FILE_NAMES,
	hasNegatedDescendantRule,
	isPathIgnored,
	normalizeRelativePath,
	readIgnoreRules,
	shouldSkipWalkError,
	toPosixRelative,
} from "@services/workspace/ignore-rules"
import { isDirectory } from "@utils/fs"
import { arePathsEqual } from "@utils/path"
import type { Dirent } from "node:fs"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

// Constants
const DEFAULT_IGNORE_DIRECTORIES = [
	"node_modules",
	"__pycache__",
	"env",
	"venv",
	"target/dependency",
	"build/dependencies",
	"dist",
	"out",
	"bundle",
	"vendor",
	"tmp",
	"temp",
	"deps",
	"Pods",
]

export interface ListFilesOptions {
	cursorIgnoreBehavior?: "omit" | "include"
}

// Helper functions
function isRestrictedPath(absolutePath: string): boolean {
	const root = process.platform === "win32" ? path.parse(absolutePath).root : "/"
	const isRoot = arePathsEqual(absolutePath, root)
	if (isRoot) {
		return true
	}

	const homeDir = os.homedir()
	const isHomeDir = arePathsEqual(absolutePath, homeDir)
	if (isHomeDir) {
		return true
	}

	return false
}

function isTargetingHiddenDirectory(absolutePath: string): boolean {
	const dirName = workspaceResolver.getBasename(absolutePath, "Services.glob.isTargetingHiddenDirectory")
	return dirName.startsWith(".")
}

function isDefaultIgnoredDirectory(relativePath: string, entryName: string, isTargetHidden: boolean): boolean {
	if (!isTargetHidden && entryName.startsWith(".")) {
		return true
	}
	const normalized = normalizeRelativePath(relativePath)
	return DEFAULT_IGNORE_DIRECTORIES.some((ignoredDir) => {
		const ignored = normalizeRelativePath(ignoredDir)
		if (!ignored.includes("/")) {
			return normalized.split("/").includes(ignored)
		}
		return normalized === ignored || normalized.endsWith(`/${ignored}`)
	})
}

function toDirectoryResultPath(absolutePath: string): string {
	return absolutePath.split(path.sep).join("/") + "/"
}

async function readDirectoryEntries(dirPath: string): Promise<Dirent[]> {
	try {
		return await fs.readdir(dirPath, { withFileTypes: true })
	} catch (error) {
		if (shouldSkipWalkError(error)) {
			return []
		}
		throw error
	}
}

async function listFilesLevelByLevel(
	absolutePath: string,
	recursive: boolean,
	limit: number,
	options: ListFilesOptions = {},
): Promise<string[]> {
	const results: string[] = []
	const queue: { dirPath: string; rules: IgnoreRule[] }[] = [{ dirPath: absolutePath, rules: [] }]
	const isTargetHidden = isTargetingHiddenDirectory(absolutePath)
	const ignoreFileNames = options.cursorIgnoreBehavior === "include" ? WORKSPACE_GIT_IGNORE_FILE_NAMES : undefined

	while (queue.length > 0 && results.length < limit) {
		const { dirPath, rules } = queue.shift()!
		const relativeDir = normalizeRelativePath(toPosixRelative(absolutePath, dirPath))
		const activeRules = [
			...rules,
			...(await readIgnoreRules(absolutePath, relativeDir === "." ? "" : relativeDir, {
				fileNames: ignoreFileNames,
			})),
		]
		const entries = (await readDirectoryEntries(dirPath)).sort((a, b) => {
			if (a.isDirectory() !== b.isDirectory()) {
				return a.isDirectory() ? -1 : 1
			}
			return a.name.localeCompare(b.name)
		})

		for (const entry of entries) {
			if (results.length >= limit) {
				break
			}

			const entryPath = path.join(dirPath, entry.name)
			const relativePath = toPosixRelative(absolutePath, entryPath)

			if (entry.isDirectory()) {
				const ignoredByRules = isPathIgnored(relativePath, true, activeRules)
				const hasNegatedDescendant = hasNegatedDescendantRule(relativePath, activeRules)
				if (
					(recursive && isDefaultIgnoredDirectory(relativePath, entry.name, isTargetHidden)) ||
					(ignoredByRules && !hasNegatedDescendant)
				) {
					continue
				}

				results.push(toDirectoryResultPath(entryPath))
				if (recursive) {
					queue.push({ dirPath: entryPath, rules: activeRules })
				}
				continue
			}

			if (entry.isFile() && !isPathIgnored(relativePath, false, activeRules)) {
				results.push(entryPath)
			}
		}
	}

	return results
}

export async function listFiles(
	dirPath: string,
	recursive: boolean,
	limit: number,
	options: ListFilesOptions = {},
): Promise<[string[], boolean]> {
	const absolutePathResult = workspaceResolver.resolveWorkspacePath(dirPath, "", "Services.glob.listFiles")
	const absolutePath = typeof absolutePathResult === "string" ? absolutePathResult : absolutePathResult.absolutePath

	// Do not allow listing files in root or home directory
	if (isRestrictedPath(absolutePath)) {
		return [[], false]
	}

	// Directory traversal requires cwd to point to a directory
	if (!(await isDirectory(absolutePath))) {
		return [[], false]
	}

	const filePaths = await listFilesLevelByLevel(absolutePath, recursive, limit, options)

	return [filePaths, filePaths.length >= limit]
}
