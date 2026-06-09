import fsSync from "node:fs"
import os from "node:os"
import path from "node:path"
import { ClineFileStorage } from "./ClineFileStorage"
import { ClineMemento } from "./ClineStorage"

/**
 * The storage backend context object used by StateManager and other components.
 * Global, workspace and secret key-value storage goes through this component.
 *
 * This replaces the previous pattern of passing VSCode's ExtensionContext around
 * for storage access. All platforms (VSCode, CLI, JetBrains) use the same
 * file-backed implementation.
 */
export interface StorageContext {
	/** Global state — settings, task history references, UI state, etc. */
	readonly globalState: ClineMemento

	// TODO: Privatize this field after StorageContext becomes class with a reset method.
	/**
	 * The backing store for global state. Prefer `globalState` when possible.
	 *
	 * This split exists because CLI needs to intercept the ClineMemento interface to global state,
	 * but state resets need to write through to the backing store.
	 */
	readonly globalStateBackingStore: ClineFileStorage

	/** Secrets — API keys and other sensitive values. File uses restricted permissions (0o600). */
	readonly secrets: ClineFileStorage<string>

	/** Workspace-scoped state — per-project toggles, rules, etc. */
	readonly workspaceState: ClineFileStorage

	/** The resolved path to the data directory (~/.codevibe/data by default) */
	readonly dataDir: string

	/** The resolved path to the workspace storage directory (contains workspaceState.json) */
	readonly workspaceStoragePath: string
}

export interface StorageContextOptions {
	/**
	 * Override the CodeVibe home directory. Defaults to CODEVIBE_DIR, CLINE_DIR, or ~/.codevibe.
	 */
	clineDir?: string

	/**
	 * Override the CodeVibe data directory directly. Defaults to CODEVIBE_DATA_DIR or <home>/data.
	 */
	dataDir?: string

	/**
	 * The workspace/project directory path. Used to compute a hash-based
	 * workspace storage subdirectory. Defaults to process.cwd().
	 */
	workspacePath?: string

	/**
	 * Explicit workspace storage directory override.
	 * When set, this path is used directly instead of computing a hash.
	 * Used by JetBrains (via WORKSPACE_STORAGE_DIR env var).
	 *
	 * TODO: Unify JetBrains workspace path scheme with the hash-based approach
	 * once the JetBrains client side is cleaned up.
	 */
	workspaceStorageDir?: string
}

const SETTINGS_SUBFOLDER = "data"

function expandHomeDir(dir: string): string {
	if (dir === "~") {
		return os.homedir()
	}
	if (dir.startsWith("~/")) {
		return path.join(os.homedir(), dir.slice(2))
	}
	return dir
}

export function resolveCodeVibeHomeDir(opts: Pick<StorageContextOptions, "clineDir"> = {}): string {
	const primaryDir = path.join(os.homedir(), ".codevibe")
	const legacyDir = path.join(os.homedir(), ".cline")
	const configuredDir =
		opts.clineDir ||
		process.env.CODEVIBE_DIR ||
		process.env.CLINE_DIR ||
		(fsSync.existsSync(legacyDir) && !fsSync.existsSync(primaryDir) ? legacyDir : primaryDir)

	return path.resolve(expandHomeDir(configuredDir))
}

export function resolveCodeVibeDataDir(opts: Pick<StorageContextOptions, "clineDir" | "dataDir"> = {}): string {
	const configuredDataDir = opts.dataDir || process.env.CODEVIBE_DATA_DIR
	if (configuredDataDir?.trim()) {
		return path.resolve(expandHomeDir(configuredDataDir.trim()))
	}
	return path.join(resolveCodeVibeHomeDir(opts), SETTINGS_SUBFOLDER)
}

/**
 * Create a short deterministic hash of a string for use in directory names.
 * Produces an up-to-8-character hex string.
 */
function hashString(str: string): string {
	let hash = 0
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i)
		hash = (hash << 5) - hash + char
		hash = hash & hash // Convert to 32-bit integer
	}
	return Math.abs(hash).toString(16).substring(0, 8)
}

/**
 * Creates a StorageContext backed by JSON files on disk.
 *
 * All path computation is contained here — callers should not
 * construct paths to these storage files themselves.
 *
 * File layout:
 *   ~/.codevibe/data/globalState.json    — global state
 *   ~/.codevibe/data/secrets.json        — secrets (mode 0o600)
 *   ~/.codevibe/data/workspaces/<hash>/workspaceState.json — per-workspace state
 *
 * @param opts Configuration options for path resolution
 * @returns A StorageContext ready for use by StateManager
 */
export function createStorageContext(opts: StorageContextOptions = {}): StorageContext {
	const dataDir = resolveCodeVibeDataDir(opts)

	// Resolve workspace storage directory
	let workspaceDir: string
	if (opts.workspaceStorageDir) {
		// Explicit override (JetBrains via env var, or test overrides)
		workspaceDir = opts.workspaceStorageDir
	} else {
		// Hash-based workspace isolation (CLI, VSCode)
		const workspacePath = opts.workspacePath || process.cwd()
		const workspaceHash = hashString(workspacePath)
		workspaceDir = path.join(dataDir, "workspaces", workspaceHash)
	}

	// Ensure directories exist
	fsSync.mkdirSync(dataDir, { recursive: true })
	fsSync.mkdirSync(workspaceDir, { recursive: true })

	const globalState = new ClineFileStorage(path.join(dataDir, "globalState.json"), "GlobalState")

	return {
		globalState,
		globalStateBackingStore: globalState,
		secrets: new ClineFileStorage<string>(path.join(dataDir, "secrets.json"), "Secrets", {
			fileMode: 0o600, // Owner read/write only — protects API keys
		}),
		workspaceState: new ClineFileStorage(path.join(workspaceDir, "workspaceState.json"), "WorkspaceState"),
		dataDir,
		workspaceStoragePath: workspaceDir,
	}
}
