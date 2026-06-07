import { isAbsolute, relative, resolve } from "node:path";
import { getFileIndex } from "@cline/core";
import type { SidecarContext } from "../types";

function isInsideOrSame(parent: string, candidate: string): boolean {
	const rel = relative(parent, candidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function resolveSearchRoot(
	ctx: Pick<SidecarContext, "workspaceRoot">,
	args?: Record<string, unknown>,
): string {
	const activeRoot = resolve(ctx.workspaceRoot);
	const requestedRoot =
		typeof args?.workspaceRoot === "string" && args.workspaceRoot.trim()
			? resolve(args.workspaceRoot.trim())
			: activeRoot;
	if (!isInsideOrSame(activeRoot, requestedRoot)) {
		throw new Error(
			"search_workspace_files workspaceRoot must be inside the active workspace",
		);
	}
	return requestedRoot;
}

export function searchWorkspaceFiles(
	ctx: Pick<SidecarContext, "workspaceRoot">,
	args?: Record<string, unknown>,
): Promise<string[]> {
	const root = resolveSearchRoot(ctx, args);
	const query =
		typeof args?.query === "string" ? args.query.trim().toLowerCase() : "";
	const limit =
		typeof args?.limit === "number" && Number.isFinite(args.limit)
			? Math.max(1, Math.min(50, Math.trunc(args.limit)))
			: 10;
	const ttlMs =
		typeof args?.ttlMs === "number" &&
		Number.isFinite(args.ttlMs) &&
		args.ttlMs >= 0
			? args.ttlMs
			: undefined;
	const cursorRetrievalIndexingPrivacyGate =
		typeof args?.cursorRetrievalIndexingPrivacyGate === "boolean"
			? args.cursorRetrievalIndexingPrivacyGate
			: undefined;
	const indexOptions = {
		...(ttlMs !== undefined ? { ttlMs } : {}),
		...(cursorRetrievalIndexingPrivacyGate !== undefined
			? { cursorRetrievalIndexingPrivacyGate }
			: {}),
	};
	const rankPath = (path: string) => {
		if (!query) {
			return 3;
		}
		const lower = path.toLowerCase();
		if (lower.startsWith(query)) {
			return 0;
		}
		if (lower.includes(`/${query}`)) {
			return 1;
		}
		if (lower.includes(query)) {
			return 2;
		}
		return Number.POSITIVE_INFINITY;
	};
	return getFileIndex(root, indexOptions).then((index) =>
		Array.from(index)
			.sort((a, b) => a.localeCompare(b))
			.map((path) => ({ path, rank: rankPath(path) }))
			.filter((item) => Number.isFinite(item.rank))
			.sort((left, right) =>
				left.rank !== right.rank
					? left.rank - right.rank
					: left.path.localeCompare(right.path),
			)
			.slice(0, limit)
			.map((item) => item.path),
	);
}
