import { ToggleHookRequest, ToggleHookResponse } from "@shared/proto/cline/file"
import fs from "fs/promises"
import { HookDiscoveryCache } from "../../hooks/HookDiscoveryCache"
import { resolveExistingHookPathInDirectories, resolveHooksDirectories } from "../../hooks/utils"
import { Controller } from ".."
import { refreshHooks } from "./refreshHooks"

export async function toggleHook(
	controller: Controller,
	request: ToggleHookRequest,
	globalHooksDirOverride?: string,
): Promise<ToggleHookResponse> {
	const { hookName, isGlobal, enabled, workspaceName } = request

	const hooksDirs = await resolveHooksDirectories(isGlobal, workspaceName, globalHooksDirOverride)
	const existingHook = await resolveExistingHookPathInDirectories(hooksDirs, hookName)

	// Verify hook exists
	if (!existingHook) {
		throw new Error(`Hook ${hookName} does not exist in ${hooksDirs.join(", ")}`)
	}

	// On Windows, we can't use chmod, so we just return the current state
	// without modifying the file. The frontend will disable the toggle.
	// TODO(PR-9552 follow-up): Replace this temporary behavior with a
	// JSON-backed cross-platform enabled/disabled hook state.
	if (process.platform !== "win32") {
		// Toggle executable bit (Unix-like systems only)
		// TODO(PR-9552 follow-up): Revisit chmod-driven enablement semantics
		// once cross-platform JSON-backed state is implemented.
		await fs.chmod(existingHook.hookPath, enabled ? 0o755 : 0o644)
	}

	// Invalidate cache
	await HookDiscoveryCache.getInstance().invalidateAll()

	// Return updated state
	const hooksToggles = await refreshHooks(controller, undefined, globalHooksDirOverride)
	return ToggleHookResponse.create({ hooksToggles })
}
