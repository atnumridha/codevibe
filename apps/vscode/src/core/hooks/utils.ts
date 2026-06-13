import fs from "fs/promises"
import os from "os"
import path from "path"
import { getWorkspaceHookDirCandidates } from "@/core/storage/disk"
import { HostProvider } from "@/hosts/host-provider"
import { getCwd, getDesktopDir } from "@/utils/path"

/**
 * All valid hook types that can be created and executed by Codie.
 * These hooks correspond to specific lifecycle events in the task execution process.
 */
export const VALID_HOOK_TYPES = [
	"TaskStart",
	"TaskResume",
	"TaskCancel",
	"TaskComplete",
	"PreToolUse",
	"PostToolUse",
	"UserPromptSubmit",
	"Notification",
	"PreCompact",
] as const

/**
 * Type representing a valid hook name
 */
export type HookType = (typeof VALID_HOOK_TYPES)[number]

/**
 * Validates if a given hook name is a valid hook type.
 *
 * @param hookName - The hook name to validate
 * @returns True if the hook name is valid, false otherwise
 */
export function isValidHookType(hookName: string): hookName is HookType {
	return VALID_HOOK_TYPES.includes(hookName as HookType)
}

/**
 * Resolves the primary hooks directory path for either global or workspace hooks.
 * New workspace hooks are created under .codevibe/hooks; legacy .clinerules/hooks
 * remains available via resolveHooksDirectories for reading, toggling, and deletion.
 * Handles both single and multi-root workspaces.
 *
 * @param isGlobal - Whether to resolve the global hooks directory
 * @param workspaceName - For multi-root workspaces, the name of the specific workspace
 * @param globalHooksDirOverride - Optional override for global hooks directory (for testing)
 * @returns The absolute path to the hooks directory
 * @throws Error if the specified workspace cannot be found
 */
export async function resolveHooksDirectory(
	isGlobal: boolean,
	workspaceName?: string,
	globalHooksDirOverride?: string,
): Promise<string> {
	return (await resolveHooksDirectories(isGlobal, workspaceName, globalHooksDirOverride))[0]
}

/**
 * Resolves all hook directory candidates for an operation.
 * For workspace hooks, .codevibe/hooks is first and legacy .clinerules/hooks is second.
 */
export async function resolveHooksDirectories(
	isGlobal: boolean,
	workspaceName?: string,
	globalHooksDirOverride?: string,
): Promise<string[]> {
	if (isGlobal) {
		return [globalHooksDirOverride || path.join(os.homedir(), "Documents", "Codie", "Hooks")]
	}

	const workspaceRoot = await resolveWorkspaceRoot(workspaceName)
	return getWorkspaceHookDirCandidates(workspaceRoot)
}

async function resolveWorkspaceRoot(workspaceName?: string): Promise<string> {
	if (workspaceName) {
		// Multi-root workspace: find the workspace with this name
		const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
		const targetWorkspace = workspacePaths.paths.find((p) => path.basename(p) === workspaceName)
		if (!targetWorkspace) {
			throw new Error(`Workspace "${workspaceName}" not found`)
		}
		return targetWorkspace
	}

	// Single workspace: use getCwd
	return getCwd(getDesktopDir())
}

/**
 * Resolves the active hook file path for a given hook name.
 *
 * Platform-specific filename rules are intentionally strict:
 *
 * On Windows, only PowerShell-native naming is supported:
 * - <HookName>.ps1
 *
 * Why: Windows hooks execute via PowerShell (`powershell -File ...`).
 * PowerShell cannot execute bash-style extensionless hook files as-is.
 *
 * On Unix-like platforms (Linux/macOS), only canonical extensionless names are considered:
 * - <HookName>
 *
 * Why: Unix hooks are discovered/executed as native executable files
 * (bash scripts, binaries, etc.) using executable-bit semantics.
 * `.ps1` files are not part of the supported Unix hook contract.
 *
 * @param hooksDir Directory containing hook files
 * @param hookName Hook type/name to resolve
 * @returns Resolved absolute file path if present, otherwise undefined
 */
export async function resolveExistingHookPath(hooksDir: string, hookName: string): Promise<string | undefined> {
	const candidates = process.platform === "win32" ? [path.join(hooksDir, `${hookName}.ps1`)] : [path.join(hooksDir, hookName)]

	for (const candidate of candidates) {
		if (await isRegularFile(candidate)) {
			return candidate
		}
	}

	return undefined
}

export async function resolveExistingHookPathInDirectories(
	hooksDirs: readonly string[],
	hookName: string,
): Promise<{ hooksDir: string; hookPath: string } | undefined> {
	for (const hooksDir of hooksDirs) {
		const hookPath = await resolveExistingHookPath(hooksDir, hookName)
		if (hookPath) {
			return { hooksDir, hookPath }
		}
	}

	return undefined
}

async function isRegularFile(filePath: string): Promise<boolean> {
	try {
		const stat = await fs.stat(filePath)
		return stat.isFile()
	} catch {
		return false
	}
}
