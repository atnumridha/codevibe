import { releaseFolderLock, tryAcquireFolderLockWithRetry } from "@/core/locks/FolderLockUtils"
import type { FolderLockOptions, FolderLockWithRetryResult } from "@/core/locks/types"

/**
 * Logical lock target for checkpoint folders.
 * Keep this path-free so logs and lock rows do not leak user home directories.
 */
export function getCheckpointLockTarget(cwdHash: string): string {
	return `codevibe:checkpoint:${cwdHash}`
}

/**
 * Attempt to acquire checkpoint folder lock with retry logic.
 * This is a convenience wrapper around the generic folder lock utility
 * that automatically derives the correct folder path from the cwdHash.
 *
 * @param cwdHash - The hash of the working directory
 * @param taskId - The task ID (swapped to instance address in SqliteLockManager)
 * @returns Promise<FolderLockWithRetryResult> with acquisition status and any conflicting lock info
 */
export async function tryAcquireCheckpointLockWithRetry(cwdHash: string, taskId: string): Promise<FolderLockWithRetryResult> {
	const options: FolderLockOptions = {
		lockTarget: getCheckpointLockTarget(cwdHash),
		heldBy: taskId,
	}

	const result = await tryAcquireFolderLockWithRetry(options)
	return { acquired: result.acquired, skipped: result.skipped, conflictingLock: result.conflictingLock }
}

/**
 * Release checkpoint folder lock safely.
 * This is a convenience wrapper around the generic folder lock utility
 * that automatically derives the correct folder path from the cwdHash.
 *
 * @param cwdHash - The hash of the working directory
 */
export async function releaseCheckpointLock(cwdHash: string, taskId: string): Promise<void> {
	await releaseFolderLock(taskId, getCheckpointLockTarget(cwdHash))
}
