import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export function isInsideOrSamePath(parent: string, candidate: string): boolean {
	const rel = relative(parent, candidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function resolveRealPathIfPresent(candidate: string): string {
	const resolved = resolve(candidate);
	try {
		return realpathSync(resolved);
	} catch {
		return resolved;
	}
}

export function resolveWorkspaceSubpath(
	activeWorkspaceRoot: string,
	requestedWorkspaceRoot: string | undefined,
	operationName: string,
): string {
	const activeRoot = resolveRealPathIfPresent(activeWorkspaceRoot);
	const requestedRoot = resolveRealPathIfPresent(
		requestedWorkspaceRoot?.trim() || activeWorkspaceRoot,
	);

	if (!isInsideOrSamePath(activeRoot, requestedRoot)) {
		throw new Error(
			`${operationName} workspaceRoot must be inside the active workspace`,
		);
	}

	return requestedRoot;
}
