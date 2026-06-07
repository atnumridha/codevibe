import { VcsType, type WorkspaceRoot } from "@shared/multi-root/types"
import type { Dirent } from "fs"
import { readdir } from "fs/promises"
import os from "os"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { getLatestGitCommitHash, isGitRepository } from "@/utils/git"
import { getCwd, getDesktopDir } from "@/utils/path"

/**
 * Detect the VCS type for a given directory path.
 * Currently supports Git; returns None otherwise.
 */
export async function detectVcs(dirPath: string): Promise<VcsType> {
	try {
		const isGit = await isGitRepository(dirPath)
		return isGit ? VcsType.Git : VcsType.None
	} catch {
		return VcsType.None
	}
}

function normalizePathForComparison(dirPath: string): string {
	const resolved = path.resolve(dirPath)
	const normalized = process.platform === "win32" ? resolved.toLowerCase() : resolved
	return normalized.replace(/[\\/]+$/, "")
}

function isProtectedDiscoveryRoot(dirPath: string): boolean {
	const homeDir = os.homedir()
	const protectedRoots = [
		homeDir,
		getDesktopDir(),
		path.join(homeDir, "Documents"),
		path.join(homeDir, "Downloads"),
	].map(normalizePathForComparison)
	return protectedRoots.includes(normalizePathForComparison(dirPath))
}

async function toWorkspaceRoot(workspacePath: string): Promise<WorkspaceRoot> {
	const vcs = await detectVcs(workspacePath)
	return {
		path: workspacePath,
		name: path.basename(workspacePath),
		vcs,
		commitHash: vcs === VcsType.Git ? (await getLatestGitCommitHash(workspacePath)) || undefined : undefined,
	}
}

async function discoverProtectedChildGitRoots(parentPath: string): Promise<WorkspaceRoot[]> {
	let entries: Dirent[]
	try {
		entries = await readdir(parentPath, { withFileTypes: true })
	} catch {
		return []
	}

	const roots: WorkspaceRoot[] = []
	for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
		if (!entry.isDirectory()) {
			continue
		}
		const childPath = path.join(parentPath, entry.name)
		try {
			if (await isGitRepository(childPath)) {
				roots.push(await toWorkspaceRoot(childPath))
			}
		} catch {
			// Keep discovery best-effort; one unreadable child should not hide valid sibling repositories.
		}
	}
	return roots
}

async function resolveWorkspaceRootsForPath(workspacePath: string): Promise<WorkspaceRoot[]> {
	const root = await toWorkspaceRoot(workspacePath)
	if (root.vcs === VcsType.Git || !isProtectedDiscoveryRoot(workspacePath)) {
		return [root]
	}
	const childRepos = await discoverProtectedChildGitRoots(workspacePath)
	return childRepos.length > 0 ? childRepos : [root]
}

/**
 * Detect workspace roots from the host editor (VS Code, etc.).
 * Falls back to current working directory when no workspace folders are present.
 */
export async function detectWorkspaceRoots(): Promise<WorkspaceRoot[]> {
	const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})

	if (!workspacePaths.paths || workspacePaths.paths.length === 0) {
		// No workspace folders, use cwd
		const cwd = await getCwd(getDesktopDir())
		return resolveWorkspaceRootsForPath(cwd)
	}

	// Convert workspace paths to WorkspaceRoots
	const roots: WorkspaceRoot[] = []
	for (const workspacePath of workspacePaths.paths) {
		roots.push(...(await resolveWorkspaceRootsForPath(workspacePath)))
	}

	return roots
}
