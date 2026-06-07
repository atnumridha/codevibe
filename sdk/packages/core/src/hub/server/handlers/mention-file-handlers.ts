import { stat } from "node:fs/promises";
import path from "node:path";
import type {
	HubCommandEnvelope,
	HubMentionFileSearchResponse,
	HubReplyEnvelope,
} from "@cline/shared";
import { getFileIndex } from "../../../services/workspace";
import { errorReply, okReply, type HubTransportContext } from "./context";

const DEFAULT_MENTION_FILE_LIMIT = 50;
const MAX_MENTION_FILE_LIMIT = 200;
const DEFAULT_QUERYLESS_LIMIT = 25;

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asPositiveIntegerAtMost(value: unknown, max: number): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		!Number.isInteger(value) ||
		value <= 0
	) {
		throw new Error("mention_files.search payload 'limit' must be a positive integer.");
	}
	return Math.min(value, max);
}

function resolveClientWorkspaceRoot(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): string | undefined {
	const clientId = envelope.clientId?.trim();
	if (!clientId) {
		return undefined;
	}
	const workspaceContext = ctx.clients.get(clientId)?.workspaceContext;
	return (
		asString(workspaceContext?.workspaceRoot) ?? asString(workspaceContext?.cwd)
	);
}

async function resolveWorkspaceRoot(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<string> {
	const payload = envelope.payload ?? {};
	const root =
		asString(payload.workspaceRoot) ??
		asString(payload.cwd) ??
		resolveClientWorkspaceRoot(ctx, envelope);
	if (!root) {
		throw new Error(
			"mention_files.search requires workspaceRoot, cwd, or a registered client workspaceContext.",
		);
	}
	const resolved = path.resolve(root);
	const rootStat = await stat(resolved);
	if (!rootStat.isDirectory()) {
		throw new Error("mention_files.search workspaceRoot must be a directory.");
	}
	return resolved;
}

function normalizeQuery(value: unknown): string {
	return typeof value === "string"
		? value.trim().replace(/\\/g, "/").replace(/^@+/, "").toLowerCase()
		: "";
}

function scoreFileMatch(file: string, query: string): number | undefined {
	if (!query) {
		return 1;
	}
	const normalizedFile = file.toLowerCase();
	const basename = path.posix.basename(normalizedFile);
	if (basename === query || normalizedFile === query) {
		return 1000;
	}
	if (basename.startsWith(query)) {
		return 900 - basename.length / 1000;
	}
	if (normalizedFile.startsWith(query)) {
		return 800 - normalizedFile.length / 1000;
	}
	const basenameIndex = basename.indexOf(query);
	if (basenameIndex >= 0) {
		return 700 - basenameIndex - basename.length / 1000;
	}
	const pathIndex = normalizedFile.indexOf(query);
	if (pathIndex >= 0) {
		return 600 - pathIndex - normalizedFile.length / 1000;
	}
	return undefined;
}

export async function handleMentionFilesSearch(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	try {
		const payload = envelope.payload ?? {};
		const query = normalizeQuery(payload.query);
		const workspaceRoot = await resolveWorkspaceRoot(ctx, envelope);
		const limit =
			asPositiveIntegerAtMost(payload.limit, MAX_MENTION_FILE_LIMIT) ??
			(query ? DEFAULT_MENTION_FILE_LIMIT : DEFAULT_QUERYLESS_LIMIT);
		const ttlMs =
			typeof payload.ttlMs === "number" &&
			Number.isFinite(payload.ttlMs) &&
			payload.ttlMs >= 0
				? payload.ttlMs
				: undefined;
		const files = await getFileIndex(workspaceRoot, { ttlMs });
		const ranked = Array.from(files)
			.map((file) => {
				const score = scoreFileMatch(file, query);
				if (score === undefined) {
					return undefined;
				}
				const basename = path.posix.basename(file);
				const directory = path.posix.dirname(file);
				return {
					path: file,
					basename,
					directory: directory === "." ? "" : directory,
					score,
				};
			})
			.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
			.sort(
				(a, b) =>
					b.score - a.score ||
					a.path.length - b.path.length ||
					a.path.localeCompare(b.path),
			);
		const results = ranked.slice(0, limit);
		const response: HubMentionFileSearchResponse = {
			query,
			workspaceRoot,
			count: results.length,
			truncated: ranked.length > results.length,
			results,
		};
		return okReply(envelope, response);
	} catch (error) {
		return errorReply(
			envelope,
			"mention_files_search_failed",
			error instanceof Error ? error.message : String(error),
		);
	}
}
