import { spawn } from "node:child_process";
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isMainThread, parentPort, Worker } from "node:worker_threads";

const DEFAULT_INDEX_TTL_MS = 15_000;
const STALE_CACHE_EVICTION_MS = 10 * 60_000;
const WORKER_INDEX_REQUEST_TIMEOUT_MS = 1_000;
const DEFAULT_EXCLUDE_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	".next",
	"coverage",
	".turbo",
	".cache",
	"target",
	"out",
]);
const WORKSPACE_IGNORE_FILE_NAMES = [
	".gitignore",
	".cursorignore",
	".cursorindexingignore",
];
const WORKSPACE_GIT_IGNORE_FILE_NAMES = [".gitignore"];

interface IgnoreRule {
	basePath: string;
	pattern: string;
	negated: boolean;
	directoryOnly: boolean;
	anchored: boolean;
	hasSlash: boolean;
}

function shouldSkipWalkError(error: unknown): boolean {
	const code =
		error && typeof error === "object" && "code" in error
			? String((error as { code?: unknown }).code ?? "")
			: "";
	return code === "EACCES" || code === "EPERM" || code === "ENOENT";
}

interface CacheEntry {
	files: Set<string>;
	lastBuiltAt: number;
	lastAccessedAt: number;
	pending: Promise<Set<string>> | null;
}

export interface FastFileIndexOptions {
	ttlMs?: number;
	/**
	 * When false, keeps legacy search/indexing behavior by honoring only
	 * gitignore-style rules. Defaults to true so Cursor privacy ignores are
	 * applied before a file enters the SDK index.
	 */
	cursorRetrievalIndexingPrivacyGate?: boolean;
}

interface IndexRequestMessage {
	type: "index";
	requestId: number;
	cwd: string;
	cursorRetrievalIndexingPrivacyGate?: boolean;
}

interface IndexResponseMessage {
	type: "indexResult";
	requestId: number;
	files?: string[];
	error?: string;
}

const CACHE = new Map<string, CacheEntry>();

function shouldApplyCursorPrivacyRules(options: FastFileIndexOptions): boolean {
	return options.cursorRetrievalIndexingPrivacyGate !== false;
}

function getIgnoreFileNames(
	options: FastFileIndexOptions,
): ReadonlyArray<string> {
	return shouldApplyCursorPrivacyRules(options)
		? WORKSPACE_IGNORE_FILE_NAMES
		: WORKSPACE_GIT_IGNORE_FILE_NAMES;
}

function getCacheKey(cwd: string, options: FastFileIndexOptions): string {
	return `${path.resolve(cwd)}\0cursorPrivacy=${shouldApplyCursorPrivacyRules(options) ? "on" : "off"}`;
}

function canUseFileIndexWorker(): boolean {
	if (!isMainThread) {
		return false;
	}

	return true;
}

function pruneStaleCacheEntries(now: number): void {
	if (CACHE.size <= 1) {
		return;
	}
	for (const [cwd, entry] of CACHE.entries()) {
		if (entry.pending) {
			continue;
		}
		if (now - entry.lastAccessedAt > STALE_CACHE_EVICTION_MS) {
			CACHE.delete(cwd);
		}
	}
}

function toPosixRelative(cwd: string, absolutePath: string): string {
	return path.relative(cwd, absolutePath).split(path.sep).join("/");
}

function normalizeRelativePath(relativePath: string): string {
	return relativePath
		.replace(/\\/g, "/")
		.replace(/^\.\/+/, "")
		.replace(/\/+/g, "/")
		.replace(/\/$/, "");
}

function parentDirs(relativePath: string): string[] {
	const segments = normalizeRelativePath(relativePath).split("/");
	const dirs: string[] = [];
	for (let i = 1; i < segments.length; i++) {
		dirs.push(segments.slice(0, i).join("/"));
	}
	return dirs;
}

function allParentDirs(relativePath: string): string[] {
	const dirs = [""];
	dirs.push(...parentDirs(relativePath));
	return dirs;
}

function globSegmentToRegExp(segment: string): RegExp {
	let source = "";
	for (let i = 0; i < segment.length; i++) {
		const char = segment[i];
		if (char === "*") {
			source += "[^/]*";
			continue;
		}
		if (char === "?") {
			source += "[^/]";
			continue;
		}
		source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
	}
	return new RegExp(`^${source}$`);
}

function globPathToRegExp(pattern: string, anchored: boolean): RegExp {
	const segments = pattern.split("/");
	let source = "";
	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i] ?? "";
		if (segment === "**") {
			source += "(?:[^/]+/)*";
		} else {
			source += globSegmentToRegExp(segment).source.slice(1, -1);
			if (i < segments.length - 1) {
				source += "/";
			}
		}
	}
	const prefix = anchored ? "^" : "^(?:.*/)?";
	return new RegExp(`${prefix}${source}$`);
}

function parseIgnoreContent(content: string, basePath: string): IgnoreRule[] {
	const rules: IgnoreRule[] = [];
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}

		let pattern = trimmed;
		let negated = false;
		if (pattern.startsWith("!")) {
			negated = true;
			pattern = pattern.slice(1).trim();
		}
		if (!pattern) {
			continue;
		}

		const directoryOnly = pattern.endsWith("/");
		const anchored = pattern.startsWith("/") || pattern.includes("/");
		pattern = pattern.replace(/^\/+/, "").replace(/\/+$/, "");
		if (!pattern) {
			continue;
		}

		rules.push({
			basePath,
			pattern,
			negated,
			directoryOnly,
			anchored,
			hasSlash: pattern.includes("/"),
		});
	}
	return rules;
}

async function readIgnoreRules(
	cwd: string,
	basePath: string,
	options: FastFileIndexOptions = {},
): Promise<IgnoreRule[]> {
	const dir = basePath ? path.join(cwd, basePath) : cwd;
	const ignoreFileNames = getIgnoreFileNames(options);
	const ruleSets = await Promise.all(
		ignoreFileNames.map(async (fileName) => {
			try {
				return parseIgnoreContent(
					await readFile(path.join(dir, fileName), "utf8"),
					basePath,
				);
			} catch {
				return [];
			}
		}),
	);
	return ruleSets.flat();
}

function toRuleRelativePath(
	relativePath: string,
	rule: IgnoreRule,
): string | null {
	const normalized = normalizeRelativePath(relativePath);
	if (!rule.basePath) {
		return normalized;
	}
	if (normalized === rule.basePath) {
		return "";
	}
	const prefix = `${rule.basePath}/`;
	if (!normalized.startsWith(prefix)) {
		return null;
	}
	return normalized.slice(prefix.length);
}

function ruleMatches(
	relativePath: string,
	isDirectory: boolean,
	rule: IgnoreRule,
): boolean {
	const ruleRelative = toRuleRelativePath(relativePath, rule);
	if (ruleRelative === null || ruleRelative.length === 0) {
		return false;
	}

	const candidates = rule.directoryOnly
		? isDirectory
			? [ruleRelative, ...parentDirs(ruleRelative)]
			: parentDirs(ruleRelative)
		: [ruleRelative, ...parentDirs(ruleRelative)];

	if (!rule.hasSlash) {
		const matcher = globSegmentToRegExp(rule.pattern);
		return candidates.some((candidate) => {
			const basename = candidate.split("/").pop() ?? "";
			return matcher.test(basename);
		});
	}

	const matcher = globPathToRegExp(rule.pattern, rule.anchored);
	return candidates.some((candidate) => matcher.test(candidate));
}

function isPathIgnored(
	relativePath: string,
	isDirectory: boolean,
	rules: IgnoreRule[],
): boolean {
	let ignored = false;
	for (const rule of rules) {
		if (ruleMatches(relativePath, isDirectory, rule)) {
			ignored = !rule.negated;
		}
	}
	return ignored;
}

function hasNegatedDescendantRule(
	relativePath: string,
	rules: IgnoreRule[],
): boolean {
	for (const rule of rules) {
		if (!rule.negated) {
			continue;
		}
		const ruleRelative = toRuleRelativePath(relativePath, rule);
		if (ruleRelative === null) {
			continue;
		}
		if (!rule.hasSlash || (!rule.anchored && rule.pattern.includes("/"))) {
			return true;
		}
		if (
			rule.pattern === ruleRelative ||
			rule.pattern.startsWith(`${ruleRelative}/`)
		) {
			return true;
		}
	}
	return false;
}

function collectDirectories(files: Set<string>): string[] {
	const dirs = new Set<string>([""]);
	for (const file of files) {
		for (const dir of allParentDirs(file)) {
			dirs.add(dir);
		}
	}
	return Array.from(dirs).sort((a, b) => {
		const depthA = a ? a.split("/").length : 0;
		const depthB = b ? b.split("/").length : 0;
		return depthA - depthB || a.localeCompare(b);
	});
}

async function filterIgnoredFiles(
	cwd: string,
	files: Set<string>,
	options: FastFileIndexOptions = {},
): Promise<Set<string>> {
	const rules: IgnoreRule[] = [];
	for (const dir of collectDirectories(files)) {
		if (dir && isPathIgnored(dir, true, rules)) {
			continue;
		}
		rules.push(...(await readIgnoreRules(cwd, dir, options)));
	}

	return new Set(
		Array.from(files).filter((file) => !isPathIgnored(file, false, rules)),
	);
}

async function listFilesWithRg(cwd: string): Promise<Set<string>> {
	const output = await new Promise<string>((resolve, reject) => {
		const child = spawn("rg", ["--files", "--hidden", "-g", "!.git"], {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk: Buffer | string) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer | string) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (code: number | null) => {
			if (code === 0) {
				resolve(stdout);
				return;
			}
			reject(new Error(stderr || `rg exited with code ${code}`));
		});
	});

	const files = output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => line.replace(/\\/g, "/"));

	return new Set(files);
}

async function walkDir(
	cwd: string,
	dir: string,
	files: Set<string>,
	rules: IgnoreRule[],
	options: FastFileIndexOptions = {},
): Promise<void> {
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch (error) {
		if (shouldSkipWalkError(error)) {
			return;
		}
		throw error;
	}
	const relativeDir = normalizeRelativePath(toPosixRelative(cwd, dir));
	const activeRules = [
		...rules,
		...(await readIgnoreRules(
			cwd,
			relativeDir === "." ? "" : relativeDir,
			options,
		)),
	];
	for (const entry of entries) {
		const absolutePath = path.join(dir, entry.name);
		const relativePath = toPosixRelative(cwd, absolutePath);
		if (entry.isDirectory()) {
			const ignoredDirectory = isPathIgnored(relativePath, true, activeRules);
			if (
				DEFAULT_EXCLUDE_DIRS.has(entry.name) ||
				(ignoredDirectory &&
					!hasNegatedDescendantRule(relativePath, activeRules))
			) {
				continue;
			}
			try {
				await walkDir(cwd, absolutePath, files, activeRules, options);
			} catch (error) {
				if (shouldSkipWalkError(error)) {
					continue;
				}
				throw error;
			}
			continue;
		}
		if (entry.isFile() && !isPathIgnored(relativePath, false, activeRules)) {
			files.add(relativePath);
		}
	}
}

async function listFilesFallback(
	cwd: string,
	options: FastFileIndexOptions = {},
): Promise<Set<string>> {
	const files = new Set<string>();
	await walkDir(cwd, cwd, files, [], options);
	return files;
}

async function buildIndex(
	cwd: string,
	options: FastFileIndexOptions = {},
): Promise<Set<string>> {
	try {
		return await filterIgnoredFiles(cwd, await listFilesWithRg(cwd), options);
	} catch {
		return listFilesFallback(cwd, options);
	}
}

function startWorkerServer(): void {
	if (isMainThread || !parentPort) {
		return;
	}
	const port = parentPort;

	port.on("message", (message: IndexRequestMessage) => {
		if (message.type !== "index") {
			return;
		}

		void buildIndex(message.cwd, {
			cursorRetrievalIndexingPrivacyGate:
				message.cursorRetrievalIndexingPrivacyGate,
		})
			.then((files) => {
				const response: IndexResponseMessage = {
					type: "indexResult",
					requestId: message.requestId,
					files: Array.from(files),
				};
				port.postMessage(response);
			})
			.catch((error: unknown) => {
				const response: IndexResponseMessage = {
					type: "indexResult",
					requestId: message.requestId,
					error:
						error instanceof Error
							? error.message
							: "Failed to build file index",
				};
				port.postMessage(response);
			});
	});
}

class FileIndexWorkerClient {
	private readonly worker = new Worker(new URL(import.meta.url));
	private nextRequestId = 0;
	private pending = new Map<
		number,
		{
			resolve: (files: string[]) => void;
			reject: (reason: Error) => void;
		}
	>();

	constructor() {
		// Keep indexing opportunistic: this worker should never block process exit.
		this.worker.unref();
		this.worker.on("message", (message: IndexResponseMessage) => {
			if (message.type !== "indexResult") {
				return;
			}
			const request = this.pending.get(message.requestId);
			if (!request) {
				return;
			}
			this.pending.delete(message.requestId);
			if (message.error) {
				request.reject(new Error(message.error));
				return;
			}
			request.resolve(message.files ?? []);
		});

		this.worker.on("error", (error: Error) => {
			this.flushPending(error);
		});

		this.worker.on("exit", (code) => {
			if (code !== 0) {
				this.flushPending(
					new Error(`File index worker exited with code ${code}`),
				);
			}
		});
	}

	requestIndex(
		cwd: string,
		options: FastFileIndexOptions = {},
	): Promise<string[] | null> {
		const requestId = ++this.nextRequestId;
		const result = new Promise<string[] | null>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(requestId);
				resolve(null);
			}, WORKER_INDEX_REQUEST_TIMEOUT_MS);
			timeout.unref();
			this.pending.set(requestId, {
				resolve: (files) => {
					clearTimeout(timeout);
					resolve(files);
				},
				reject: (reason) => {
					clearTimeout(timeout);
					reject(reason);
				},
			});
		});

		const message: IndexRequestMessage = {
			type: "index",
			requestId,
			cwd,
			cursorRetrievalIndexingPrivacyGate:
				options.cursorRetrievalIndexingPrivacyGate,
		};
		this.worker.postMessage(message);
		return result;
	}

	private flushPending(error: Error): void {
		for (const [requestId, request] of this.pending.entries()) {
			request.reject(error);
			this.pending.delete(requestId);
		}
	}
}

startWorkerServer();

let workerClient: FileIndexWorkerClient | null | undefined;

function getWorkerClient(): FileIndexWorkerClient | null {
	if (!canUseFileIndexWorker()) {
		return null;
	}
	if (workerClient === undefined) {
		workerClient = new FileIndexWorkerClient();
	}
	return workerClient;
}

async function buildIndexInBackground(
	cwd: string,
	options: FastFileIndexOptions = {},
): Promise<Set<string>> {
	const workerClient = getWorkerClient();
	if (!workerClient) {
		return buildIndex(cwd, options);
	}

	try {
		const files = await workerClient.requestIndex(cwd, options);
		if (files === null) {
			return buildIndex(cwd, options);
		}
		return new Set(files);
	} catch {
		return buildIndex(cwd, options);
	}
}

export async function getFileIndex(
	cwd: string,
	options: FastFileIndexOptions = {},
): Promise<Set<string>> {
	const ttlMs = options.ttlMs ?? DEFAULT_INDEX_TTL_MS;
	const now = Date.now();
	pruneStaleCacheEntries(now);
	const cacheKey = getCacheKey(cwd, options);
	const existing = CACHE.get(cacheKey);

	if (
		existing &&
		ttlMs > 0 &&
		now - existing.lastBuiltAt <= ttlMs &&
		existing.files.size > 0
	) {
		existing.lastAccessedAt = now;
		return existing.files;
	}

	if (existing?.pending) {
		existing.lastAccessedAt = now;
		return existing.pending;
	}

	const pending = buildIndexInBackground(cwd, options).then((files) => {
		CACHE.set(cacheKey, {
			files,
			lastBuiltAt: Date.now(),
			lastAccessedAt: Date.now(),
			pending: null,
		});
		return files;
	});

	CACHE.set(cacheKey, {
		files: existing?.files ?? new Set<string>(),
		lastBuiltAt: existing?.lastBuiltAt ?? 0,
		lastAccessedAt: now,
		pending,
	});

	return pending;
}

export async function prewarmFileIndex(
	cwd: string,
	options: FastFileIndexOptions = {},
): Promise<void> {
	await getFileIndex(cwd, { ...options, ttlMs: 0 });
}
