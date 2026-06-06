import { readFile } from "node:fs/promises"
import path from "node:path"

export const WORKSPACE_IGNORE_FILE_NAMES = [".gitignore", ".cursorignore", ".cursorindexingignore"]

export interface IgnoreRule {
	basePath: string
	pattern: string
	negated: boolean
	directoryOnly: boolean
	anchored: boolean
	hasSlash: boolean
}

export function shouldSkipWalkError(error: unknown): boolean {
	const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : ""
	return code === "EACCES" || code === "EPERM" || code === "ENOENT"
}

export function toPosixRelative(cwd: string, absolutePath: string): string {
	return path.relative(cwd, absolutePath).split(path.sep).join("/")
}

export function normalizeRelativePath(relativePath: string): string {
	return relativePath
		.replace(/\\/g, "/")
		.replace(/^\.\/+/, "")
		.replace(/\/+/g, "/")
		.replace(/\/$/, "")
}

export function parentDirs(relativePath: string): string[] {
	const segments = normalizeRelativePath(relativePath).split("/")
	const dirs: string[] = []
	for (let i = 1; i < segments.length; i++) {
		dirs.push(segments.slice(0, i).join("/"))
	}
	return dirs
}

function allParentDirs(relativePath: string): string[] {
	const dirs = [""]
	dirs.push(...parentDirs(relativePath))
	return dirs
}

function globSegmentToRegExp(segment: string): RegExp {
	let source = ""
	for (let i = 0; i < segment.length; i++) {
		const char = segment[i]
		if (char === "*") {
			source += "[^/]*"
			continue
		}
		if (char === "?") {
			source += "[^/]"
			continue
		}
		source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
	}
	return new RegExp(`^${source}$`)
}

function globPathToRegExp(pattern: string, anchored: boolean): RegExp {
	const segments = pattern.split("/")
	let source = ""
	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i] ?? ""
		if (segment === "**") {
			source += "(?:[^/]+/)*"
		} else {
			source += globSegmentToRegExp(segment).source.slice(1, -1)
			if (i < segments.length - 1) {
				source += "/"
			}
		}
	}
	const prefix = anchored ? "^" : "^(?:.*/)?"
	return new RegExp(`${prefix}${source}$`)
}

function parseIgnoreContent(content: string, basePath: string): IgnoreRule[] {
	const rules: IgnoreRule[] = []
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith("#")) {
			continue
		}

		let pattern = trimmed
		let negated = false
		if (pattern.startsWith("!")) {
			negated = true
			pattern = pattern.slice(1).trim()
		}
		if (!pattern) {
			continue
		}

		const directoryOnly = pattern.endsWith("/")
		const anchored = pattern.startsWith("/") || pattern.includes("/")
		pattern = pattern.replace(/^\/+/, "").replace(/\/+$/, "")
		if (!pattern) {
			continue
		}

		rules.push({
			basePath,
			pattern,
			negated,
			directoryOnly,
			anchored,
			hasSlash: pattern.includes("/"),
		})
	}
	return rules
}

export async function readIgnoreRules(cwd: string, basePath: string): Promise<IgnoreRule[]> {
	const dir = basePath ? path.join(cwd, basePath) : cwd
	const ruleSets = await Promise.all(
		WORKSPACE_IGNORE_FILE_NAMES.map(async (fileName) => {
			try {
				return parseIgnoreContent(await readFile(path.join(dir, fileName), "utf8"), basePath)
			} catch {
				return []
			}
		}),
	)
	return ruleSets.flat()
}

function toRuleRelativePath(relativePath: string, rule: IgnoreRule): string | null {
	const normalized = normalizeRelativePath(relativePath)
	if (!rule.basePath) {
		return normalized
	}
	if (normalized === rule.basePath) {
		return ""
	}
	const prefix = `${rule.basePath}/`
	if (!normalized.startsWith(prefix)) {
		return null
	}
	return normalized.slice(prefix.length)
}

function ruleMatches(relativePath: string, isDirectory: boolean, rule: IgnoreRule): boolean {
	const ruleRelative = toRuleRelativePath(relativePath, rule)
	if (ruleRelative === null || ruleRelative.length === 0) {
		return false
	}

	const candidates = rule.directoryOnly
		? isDirectory
			? [ruleRelative, ...parentDirs(ruleRelative)]
			: parentDirs(ruleRelative)
		: [ruleRelative, ...parentDirs(ruleRelative)]

	if (!rule.hasSlash) {
		const matcher = globSegmentToRegExp(rule.pattern)
		return candidates.some((candidate) => {
			const basename = candidate.split("/").pop() ?? ""
			return matcher.test(basename)
		})
	}

	const matcher = globPathToRegExp(rule.pattern, rule.anchored)
	return candidates.some((candidate) => matcher.test(candidate))
}

export function isPathIgnored(relativePath: string, isDirectory: boolean, rules: IgnoreRule[]): boolean {
	let ignored = false
	for (const rule of rules) {
		if (ruleMatches(relativePath, isDirectory, rule)) {
			ignored = !rule.negated
		}
	}
	return ignored
}

export function hasNegatedDescendantRule(relativePath: string, rules: IgnoreRule[]): boolean {
	for (const rule of rules) {
		if (!rule.negated) {
			continue
		}
		const ruleRelative = toRuleRelativePath(relativePath, rule)
		if (ruleRelative === null) {
			continue
		}
		if (!rule.hasSlash || (!rule.anchored && rule.pattern.includes("/"))) {
			return true
		}
		if (rule.pattern === ruleRelative || rule.pattern.startsWith(`${ruleRelative}/`)) {
			return true
		}
	}
	return false
}

function collectDirectories(paths: Iterable<string>): string[] {
	const dirs = new Set<string>([""])
	for (const file of paths) {
		for (const dir of allParentDirs(file)) {
			dirs.add(dir)
		}
	}
	return Array.from(dirs).sort((a, b) => {
		const depthA = a ? a.split("/").length : 0
		const depthB = b ? b.split("/").length : 0
		return depthA - depthB || a.localeCompare(b)
	})
}

export async function buildIgnoreRulesForPaths(cwd: string, relativePaths: Iterable<string>): Promise<IgnoreRule[]> {
	const rules: IgnoreRule[] = []
	const normalizedPaths = Array.from(relativePaths, normalizeRelativePath).filter(Boolean)

	for (const dir of collectDirectories(normalizedPaths)) {
		if (dir && isPathIgnored(dir, true, rules)) {
			continue
		}
		rules.push(...(await readIgnoreRules(cwd, dir)))
	}

	return rules
}
