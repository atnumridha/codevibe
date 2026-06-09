import { releaseFolderLock, tryAcquireFolderLockWithRetry } from "@/core/locks/FolderLockUtils"
import type { FolderLockOptions, FolderLockWithRetryResult } from "@/core/locks/types"

/**
 * Logical lock target for task folders.
 * Keep this path-free so logs and lock rows do not leak user home directories.
 */
export function getTaskLockTarget(taskId: string): string {
	return `codevibe:task:${taskId}`
}

/**
 * Attempt to acquire task folder lock with retry logic.
 * This is a convenience wrapper around the generic folder lock utility
 * that uses the taskId as the lock target.
 *
 * @param taskId - The unique identifier for the task
 * @returns Promise<FolderLockWithRetryResult> with acquisition status and any conflicting lock info
 */
export async function tryAcquireTaskLockWithRetry(taskId: string): Promise<FolderLockWithRetryResult> {
	const options: FolderLockOptions = {
		lockTarget: getTaskLockTarget(taskId),
		heldBy: taskId, // will be automatically swapped for instance address in SqliteLockManager
	}

	const result = await tryAcquireFolderLockWithRetry(options)
	return { acquired: result.acquired, skipped: result.skipped, conflictingLock: result.conflictingLock }
}

/**
 * Release task folder lock safely.
 * This is a convenience wrapper around the generic folder lock utility
 * that uses the taskId as the lock target.
 *
 * @param taskId - The unique identifier for the task
 */
export async function releaseTaskLock(taskId: string): Promise<void> {
	await releaseFolderLock(taskId, getTaskLockTarget(taskId))
}
