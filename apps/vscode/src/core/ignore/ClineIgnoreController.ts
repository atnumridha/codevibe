import { fileExistsAtPath } from "@utils/fs"
import chokidar, { FSWatcher } from "chokidar"
import fs from "fs/promises"
import ignore, { Ignore } from "ignore"
import path from "path"
import { Logger } from "@/shared/services/Logger"

export const LOCK_TEXT_SYMBOL = "\u{1F512}"
const DIRECT_ACCESS_IGNORE_FILES = [".clineignore", ".cursorignore", ".cursorindexingignore"] as const

/**
 * Controls LLM access to files by enforcing ignore patterns.
 * Designed to be instantiated once in Cline.ts and passed to file manipulation services.
 * Uses the 'ignore' library to support standard .gitignore syntax in direct-access ignore files.
 */
export class ClineIgnoreController {
	private cwd: string
	private ignoreInstance: Ignore
	private fileWatcher?: FSWatcher
	private hasIgnoreRules: boolean
	clineIgnoreContent: string | undefined

	constructor(cwd: string) {
		this.cwd = cwd
		this.ignoreInstance = ignore()
		this.hasIgnoreRules = false
		this.clineIgnoreContent = undefined
	}

	/**
	 * Initialize the controller by loading custom patterns and setting up file watcher
	 * Must be called after construction and before using the controller
	 */
	async initialize(): Promise<void> {
		// Set up file watcher for direct-access ignore files
		this.setupFileWatcher()
		await this.loadClineIgnore()
	}

	/**
	 * Set up the file watcher for direct-access ignore file changes
	 */
	private setupFileWatcher(): void {
		const ignorePaths = DIRECT_ACCESS_IGNORE_FILES.map((fileName) => path.join(this.cwd, fileName))

		this.fileWatcher = chokidar.watch(ignorePaths, {
			persistent: true, // Keep the process running as long as files are being watched
			ignoreInitial: true, // Don't fire 'add' events when discovering the file initially
			awaitWriteFinish: {
				// Wait for writes to finish before emitting events (handles chunked writes)
				stabilityThreshold: 100, // Wait 100ms for file size to remain constant
				pollInterval: 100, // Check file size every 100ms while waiting for stability
			},
			atomic: true, // Handle atomic writes where editors write to a temp file then rename
		})

		// Watch for file changes, creation, and deletion
		this.fileWatcher.on("change", () => {
			this.loadClineIgnore()
		})

		this.fileWatcher.on("add", () => {
			this.loadClineIgnore()
		})

		this.fileWatcher.on("unlink", () => {
			this.loadClineIgnore()
		})

		this.fileWatcher.on("error", (error) => {
			Logger.error("Error watching direct-access ignore files:", error)
		})
	}

	/**
	 * Load custom patterns from .clineignore, .cursorignore, and .cursorindexingignore if they exist.
	 * Supports "!include <filename>" in .clineignore to load additional ignore patterns from other files.
	 */
	private async loadClineIgnore(): Promise<void> {
		try {
			// Reset ignore instance to prevent duplicate patterns
			this.ignoreInstance = ignore()
			this.hasIgnoreRules = false
			this.clineIgnoreContent = undefined

			for (const ignoreFileName of DIRECT_ACCESS_IGNORE_FILES) {
				const ignorePath = path.join(this.cwd, ignoreFileName)
				if (!(await fileExistsAtPath(ignorePath))) {
					continue
				}

				const content = await fs.readFile(ignorePath, "utf8")
				this.hasIgnoreRules = true
				if (ignoreFileName === ".clineignore") {
					this.clineIgnoreContent = content
					await this.processIgnoreContent(content, { allowIncludes: true })
				} else {
					this.ignoreInstance.add(content)
				}
				this.ignoreInstance.add(ignoreFileName)
			}
		} catch (error) {
			// Should never happen: reading file failed even though it exists
			Logger.error("Unexpected error loading direct-access ignore files:", error)
		}
	}

	/**
	 * Process ignore content and apply all ignore patterns
	 */
	private async processIgnoreContent(content: string, opts?: { allowIncludes?: boolean }): Promise<void> {
		// Optimization: first check if there are any !include directives
		if (!opts?.allowIncludes || !content.includes("!include ")) {
			this.ignoreInstance.add(content)
			return
		}

		// Process !include directives
		const combinedContent = await this.processClineIgnoreIncludes(content)
		this.ignoreInstance.add(combinedContent)
	}

	/**
	 * Process !include directives and combine all included file contents
	 */
	private async processClineIgnoreIncludes(content: string): Promise<string> {
		let combinedContent = ""
		const lines = content.split(/\r?\n/)

		for (const line of lines) {
			const trimmedLine = line.trim()

			if (!trimmedLine.startsWith("!include ")) {
				combinedContent += "\n" + line
				continue
			}

			// Process !include directive
			const includedContent = await this.readIncludedFile(trimmedLine)
			if (includedContent) {
				combinedContent += "\n" + includedContent
			}
		}

		return combinedContent
	}

	/**
	 * Read content from an included file specified by !include directive
	 */
	private async readIncludedFile(includeLine: string): Promise<string | null> {
		const includePath = includeLine.substring("!include ".length).trim()
		const resolvedIncludePath = await this.resolveIncludedFilePath(includePath)

		if (!resolvedIncludePath) {
			return null
		}

		if (!(await fileExistsAtPath(resolvedIncludePath))) {
			Logger.debug(`[ClineIgnore] Included file not found: ${resolvedIncludePath}`)
			return null
		}

		return await fs.readFile(resolvedIncludePath, "utf8")
	}

	private async resolveIncludedFilePath(includePath: string): Promise<string | null> {
		if (!includePath) {
			Logger.debug("[ClineIgnore] Ignoring empty include directive")
			return null
		}

		if (path.isAbsolute(includePath) || path.win32.isAbsolute(includePath) || /^[a-zA-Z]:/.test(includePath)) {
			Logger.warn(`[ClineIgnore] Ignoring absolute include path: ${includePath}`)
			return null
		}

		const resolvedIncludePath = path.resolve(this.cwd, includePath)
		if (!this.isPathWithinWorkspace(resolvedIncludePath, this.cwd)) {
			Logger.warn(`[ClineIgnore] Ignoring include outside workspace: ${includePath}`)
			return null
		}

		if (!(await fileExistsAtPath(resolvedIncludePath))) {
			return resolvedIncludePath
		}

		try {
			const [workspaceRoot, realIncludePath] = await Promise.all([fs.realpath(this.cwd), fs.realpath(resolvedIncludePath)])
			if (!this.isPathWithinWorkspace(realIncludePath, workspaceRoot)) {
				Logger.warn(`[ClineIgnore] Ignoring include outside workspace: ${includePath}`)
				return null
			}

			const stat = await fs.stat(realIncludePath)
			if (!stat.isFile()) {
				Logger.warn(`[ClineIgnore] Ignoring include that is not a file: ${includePath}`)
				return null
			}

			return realIncludePath
		} catch (error) {
			Logger.warn(`[ClineIgnore] Failed to resolve include path: ${includePath}`, error)
			return null
		}
	}

	private isPathWithinWorkspace(candidatePath: string, workspaceRoot: string): boolean {
		const relativePath = path.relative(workspaceRoot, candidatePath)
		return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
	}

	/**
	 * Check if a file should be accessible to the LLM
	 * @param filePath - Path to check (relative to cwd)
	 * @returns true if file is accessible, false if ignored
	 */
	validateAccess(filePath: string): boolean {
		// Always allow access if no direct-access ignore files exist
		if (!this.hasIgnoreRules) {
			return true
		}
		try {
			// Normalize path to be relative to cwd and use forward slashes
			const absolutePath = path.resolve(this.cwd, filePath)
			const relativePath = path.relative(this.cwd, absolutePath).toPosix()

			// Ignore expects paths to be path.relative()'d
			return !this.ignoreInstance.ignores(relativePath)
		} catch (_error) {
			// Logger.error(`Error validating access for ${filePath}:`, error)
			// Ignore is designed to work with relative file paths, so will throw error for paths outside cwd. We are allowing access to all files outside cwd.
			return true
		}
	}

	/**
	 * Check if a terminal command should be allowed to execute based on file access patterns
	 * @param command - Terminal command to validate
	 * @returns path of file that is being accessed if it is being accessed, undefined if command is allowed
	 */
	validateCommand(command: string): string | undefined {
		// Always allow if no direct-access ignore files exist
		if (!this.hasIgnoreRules) {
			return undefined
		}

		// Split command into parts and get the base command
		const parts = command.trim().split(/\s+/)
		const baseCommand = parts[0].toLowerCase()

		// Commands that read file contents
		const fileReadingCommands = [
			// Unix commands
			"cat",
			"less",
			"more",
			"head",
			"tail",
			"grep",
			"awk",
			"sed",
			// PowerShell commands and aliases
			"get-content",
			"gc",
			"type",
			"select-string",
			"sls",
		]

		if (fileReadingCommands.includes(baseCommand)) {
			// Check each argument that could be a file path
			for (let i = 1; i < parts.length; i++) {
				const arg = parts[i]
				// Skip command flags/options (both Unix and PowerShell style)
				if (arg.startsWith("-") || arg.startsWith("/")) {
					continue
				}
				// Ignore PowerShell parameter names
				if (arg.includes(":")) {
					continue
				}
				// Validate file access
				if (!this.validateAccess(arg)) {
					return arg
				}
			}
		}

		return undefined
	}

	/**
	 * Filter an array of paths, removing those that should be ignored
	 * @param paths - Array of paths to filter (relative to cwd)
	 * @returns Array of allowed paths
	 */
	filterPaths(paths: string[]): string[] {
		try {
			return paths
				.map((p) => ({
					path: p,
					allowed: this.validateAccess(p),
				}))
				.filter((x) => x.allowed)
				.map((x) => x.path)
		} catch (error) {
			Logger.error("Error filtering paths:", error)
			return [] // Fail closed for security
		}
	}

	/**
	 * Clean up resources when the controller is no longer needed
	 */
	async dispose(): Promise<void> {
		if (this.fileWatcher) {
			await this.fileWatcher.close()
			this.fileWatcher = undefined
		}
	}
}
