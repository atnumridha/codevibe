import type { Dirent } from "node:fs";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { PluginManifest } from "..";

const DEPRECATED_CONFIG_DIR = ".clinerules";
const CODEVIBE_CONFIG_DIR = ".codevibe";
const CLINE_CONFIG_DIR = ".cline";
const CURSOR_CONFIG_DIR = ".cursor";
const CURSOR_RULES_FILE_NAME = ".cursorrules";
const LEGACY_AGENT_SKILLS_CONFIG_DIR = ".agents";

export const AGENT_CONFIG_DIRECTORY_NAME = "agents";
export const HOOKS_CONFIG_DIRECTORY_NAME = "hooks";
export const SKILLS_CONFIG_DIRECTORY_NAME = "skills";
export const RULES_CONFIG_DIRECTORY_NAME = "rules";
export const WORKFLOWS_CONFIG_DIRECTORY_NAME = "workflows";
export const PLUGINS_DIRECTORY_NAME = "plugins";
export const AGENTS_RULES_FILE_NAME = "AGENTS.md";

export const CODEVIBE_MCP_SETTINGS_FILE_NAME = "codevibe_mcp_settings.json";
export const CLINE_MCP_SETTINGS_FILE_NAME = "cline_mcp_settings.json";

function resolveDefaultHomeDir(): string {
	const envHome = process?.env?.HOME?.trim();
	if (envHome && envHome !== "~") {
		return envHome;
	}
	const envUserProfile = process?.env?.USERPROFILE?.trim();
	if (envUserProfile) {
		return envUserProfile;
	}
	const envHomeDrive = process?.env?.HOMEDRIVE?.trim();
	const envHomePath = process?.env?.HOMEPATH?.trim();
	if (envHomeDrive && envHomePath) {
		return `${envHomeDrive}${envHomePath}`;
	}
	const osHomeDir = homedir().trim();
	if (osHomeDir && osHomeDir !== "~") {
		return osHomeDir;
	}
	return "~";
}

let HOME_DIR = resolveDefaultHomeDir();
let HOME_DIR_SET_EXPLICITLY = false;

export function setHomeDir(dir: string) {
	const trimmed = dir.trim();
	if (!trimmed) {
		return;
	}
	HOME_DIR = trimmed;
	HOME_DIR_SET_EXPLICITLY = true;
}

export function setHomeDirIfUnset(dir: string) {
	if (HOME_DIR_SET_EXPLICITLY) {
		return;
	}
	const trimmed = dir.trim();
	if (!trimmed) {
		return;
	}
	HOME_DIR = trimmed;
}

function readEnv(primary: string, legacy?: string): string | undefined {
	const primaryValue = process.env[primary]?.trim();
	if (primaryValue) {
		return primaryValue;
	}
	if (!legacy) {
		return undefined;
	}
	const legacyValue = process.env[legacy]?.trim();
	return legacyValue || undefined;
}

let CODEVIBE_DIR: string | undefined;
let CODEVIBE_DIR_SET_EXPLICITLY = false;

export function setCodeVibeDir(dir: string): void {
	const trimmed = dir.trim();
	if (!trimmed) {
		return;
	}
	CODEVIBE_DIR = trimmed;
	CODEVIBE_DIR_SET_EXPLICITLY = true;
}

export function setCodeVibeDirIfUnset(dir: string): void {
	if (CODEVIBE_DIR_SET_EXPLICITLY) {
		return;
	}
	const trimmed = dir.trim();
	if (!trimmed) {
		return;
	}
	CODEVIBE_DIR = trimmed;
}

export function setClineDir(dir: string): void {
	setCodeVibeDir(dir);
}

export function setClineDirIfUnset(dir: string): void {
	setCodeVibeDirIfUnset(dir);
}

export function resolveCodeVibeDir(): string {
	if (CODEVIBE_DIR) {
		return CODEVIBE_DIR;
	}
	const envDir = readEnv("CODEVIBE_DIR", "CLINE_DIR");
	if (envDir) {
		return envDir;
	}
	return join(HOME_DIR, CODEVIBE_CONFIG_DIR);
}

export function resolveClineDir(): string {
	return resolveCodeVibeDir();
}

function resolveLegacyClineDir(): string {
	const envDir = process.env.CLINE_DIR?.trim();
	if (envDir) {
		return envDir;
	}
	return join(HOME_DIR, CLINE_CONFIG_DIR);
}

export function resolveDocumentsCodeVibeDirectoryPath(): string {
	return join(HOME_DIR, "Documents", "CodeVibe");
}

export function resolveDocumentsClineDirectoryPath(): string {
	return join(HOME_DIR, "Documents", "Cline");
}

type DocumentsExtensionName =
	| "Agents"
	| "Hooks"
	| "Rules"
	| "Workflows"
	| "Plugins";

export function resolveDocumentsExtensionPath(
	name: DocumentsExtensionName,
): string {
	return join(resolveDocumentsCodeVibeDirectoryPath(), name);
}

function resolveDocumentsClineExtensionPath(
	name: DocumentsExtensionName,
): string {
	return join(resolveDocumentsClineDirectoryPath(), name);
}

export function resolveCodeVibeDataDir(): string {
	const explicitDir = readEnv("CODEVIBE_DATA_DIR", "CLINE_DATA_DIR");
	if (explicitDir) {
		return explicitDir;
	}
	return join(resolveCodeVibeDir(), "data");
}

export function resolveClineDataDir(): string {
	return resolveCodeVibeDataDir();
}

export function resolveSessionDataDir(): string {
	const explicitDir = readEnv(
		"CODEVIBE_SESSION_DATA_DIR",
		"CLINE_SESSION_DATA_DIR",
	);
	if (explicitDir) {
		return explicitDir;
	}
	return join(resolveCodeVibeDataDir(), "sessions");
}

export function resolveTeamDataDir(): string {
	const explicitDir = readEnv("CODEVIBE_TEAM_DATA_DIR", "CLINE_TEAM_DATA_DIR");
	if (explicitDir) {
		return explicitDir;
	}
	return join(resolveCodeVibeDataDir(), "teams");
}

export function resolveDbDataDir(): string {
	const explicitDir = readEnv("CODEVIBE_DB_DATA_DIR", "CLINE_DB_DATA_DIR");
	if (explicitDir) {
		return explicitDir;
	}
	return join(resolveCodeVibeDataDir(), "db");
}

/**
 * Path to the dedicated cron/automation database.
 * Lives alongside `sessions.db` but is a separate file so cron lifecycle,
 * retention, and query patterns stay decoupled from session storage.
 */
export function resolveCronDbPath(): string {
	const explicitPath = readEnv("CODEVIBE_CRON_DB_PATH", "CLINE_CRON_DB_PATH");
	if (explicitPath) {
		return explicitPath;
	}
	return join(resolveDbDataDir(), "cron.db");
}

export type CronSpecsScope = "global" | "workspace";

export interface ResolveCronSpecsDirOptions {
	/**
	 * Explicit specs directory. Useful for tests and for future hosts that want
	 * to provide their own merged/global/workspace cron source root.
	 */
	cronSpecsDir?: string;
	/** Defaults to `global`, i.e. `~/.codevibe/cron`. */
	scope?: CronSpecsScope;
	/** Required when `scope` is `workspace`. */
	workspaceRoot?: string;
}

/**
 * Global file-based cron spec authoring directory:
 *   `~/.codevibe/cron/`
 */
export function resolveGlobalCronSpecsDir(): string {
	return join(resolveCodeVibeDir(), "cron");
}

/**
 * Workspace file-based cron spec authoring directory reserved for future
 * workspace-scoped automation support:
 *   `${workspaceRoot}/.codevibe/cron/`
 */
export function resolveWorkspaceCronSpecsDir(workspaceRoot: string): string {
	return join(workspaceRoot, CODEVIBE_CONFIG_DIR, "cron");
}

/**
 * Directory containing file-based cron spec authoring.
 *
 * Default: global `~/.codevibe/cron/`.
 * One-off: `*.md`
 * Recurring: `*.cron.md`
 * Event-driven: `events/*.event.md`
 *
 * A string argument is retained as a deprecated compatibility shorthand for
 * workspace scope. New code should pass `{ scope: "workspace", workspaceRoot }`
 * or use `resolveWorkspaceCronSpecsDir(workspaceRoot)` directly.
 */
export function resolveCronSpecsDir(workspaceRoot: string): string;
export function resolveCronSpecsDir(
	options?: ResolveCronSpecsDirOptions,
): string;
export function resolveCronSpecsDir(
	input?: string | ResolveCronSpecsDirOptions,
): string {
	if (typeof input === "string") {
		return resolveWorkspaceCronSpecsDir(input);
	}
	if (input?.cronSpecsDir?.trim()) {
		return input.cronSpecsDir.trim();
	}
	if (input?.scope === "workspace") {
		const workspaceRoot = input.workspaceRoot?.trim();
		if (!workspaceRoot) {
			throw new Error("workspaceRoot is required for workspace cron scope");
		}
		return resolveWorkspaceCronSpecsDir(workspaceRoot);
	}
	return resolveGlobalCronSpecsDir();
}

/** Directory where per-run markdown reports are written. */
export function resolveCronReportsDir(workspaceRoot: string): string;
export function resolveCronReportsDir(
	options?: ResolveCronSpecsDirOptions,
): string;
export function resolveCronReportsDir(
	input?: string | ResolveCronSpecsDirOptions,
): string {
	return join(
		resolveCronSpecsDir(input as ResolveCronSpecsDirOptions),
		"reports",
	);
}

/** Directory where event-spec files live inside the cron specs dir. */
export function resolveCronEventsDir(workspaceRoot: string): string;
export function resolveCronEventsDir(
	options?: ResolveCronSpecsDirOptions,
): string;
export function resolveCronEventsDir(
	input?: string | ResolveCronSpecsDirOptions,
): string {
	return join(
		resolveCronSpecsDir(input as ResolveCronSpecsDirOptions),
		"events",
	);
}

export function resolveProviderSettingsPath(): string {
	const explicitPath = readEnv(
		"CODEVIBE_PROVIDER_SETTINGS_PATH",
		"CLINE_PROVIDER_SETTINGS_PATH",
	);
	if (explicitPath) {
		return explicitPath;
	}
	return join(resolveCodeVibeDataDir(), "settings", "providers.json");
}

export function resolveGlobalSettingsPath(): string {
	const explicitPath = readEnv(
		"CODEVIBE_GLOBAL_SETTINGS_PATH",
		"CLINE_GLOBAL_SETTINGS_PATH",
	);
	if (explicitPath) {
		return explicitPath;
	}
	return join(resolveCodeVibeDataDir(), "settings", "global-settings.json");
}

export function resolveMcpSettingsPath(): string {
	const explicitPath = readEnv(
		"CODEVIBE_MCP_SETTINGS_PATH",
		"CLINE_MCP_SETTINGS_PATH",
	);
	if (explicitPath) {
		return explicitPath;
	}
	return join(
		resolveCodeVibeDataDir(),
		"settings",
		CODEVIBE_MCP_SETTINGS_FILE_NAME,
	);
}

function dedupePaths(paths: ReadonlyArray<string>): string[] {
	const seen = new Set<string>();
	const deduped: string[] = [];
	for (const candidate of paths) {
		if (!candidate || seen.has(candidate)) {
			continue;
		}
		seen.add(candidate);
		deduped.push(candidate);
	}
	return deduped;
}

function getWorkspaceSkillDirectories(workspacePath?: string): string[] {
	if (!workspacePath) {
		return [];
	}
	return [
		DEPRECATED_CONFIG_DIR,
		CLINE_CONFIG_DIR,
		LEGACY_AGENT_SKILLS_CONFIG_DIR,
		CODEVIBE_CONFIG_DIR,
	].map((dir) => join(workspacePath, dir, SKILLS_CONFIG_DIRECTORY_NAME));
}

export function resolveAgentsConfigDirPath(): string {
	return join(resolveCodeVibeDir(), AGENT_CONFIG_DIRECTORY_NAME);
}

export function resolveAgentConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return dedupePaths([
		workspacePath
			? join(workspacePath, CLINE_CONFIG_DIR, AGENT_CONFIG_DIRECTORY_NAME)
			: "",
		workspacePath
			? join(workspacePath, CODEVIBE_CONFIG_DIR, AGENT_CONFIG_DIRECTORY_NAME)
			: "",
		resolveAgentsConfigDirPath(),
	]);
}

export function resolveHooksConfigSearchPaths(
	workspacePath?: string,
): string[] {
	const hooks = [
		resolveDocumentsExtensionPath("Hooks"),
		resolveDocumentsClineExtensionPath("Hooks"),
		join(resolveLegacyClineDir(), HOOKS_CONFIG_DIRECTORY_NAME),
		join(resolveCodeVibeDir(), HOOKS_CONFIG_DIRECTORY_NAME),
	];
	if (workspacePath) {
		hooks.push(
			join(workspacePath, DEPRECATED_CONFIG_DIR, HOOKS_CONFIG_DIRECTORY_NAME),
			join(workspacePath, CLINE_CONFIG_DIR, HOOKS_CONFIG_DIRECTORY_NAME),
			join(workspacePath, CODEVIBE_CONFIG_DIR, HOOKS_CONFIG_DIRECTORY_NAME),
		);
	}
	return dedupePaths(hooks);
}

export function resolveSkillsConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return dedupePaths([
		...getWorkspaceSkillDirectories(workspacePath),
		join(
			HOME_DIR,
			LEGACY_AGENT_SKILLS_CONFIG_DIR,
			SKILLS_CONFIG_DIRECTORY_NAME,
		),
		join(resolveLegacyClineDir(), SKILLS_CONFIG_DIRECTORY_NAME),
		join(resolveCodeVibeDir(), SKILLS_CONFIG_DIRECTORY_NAME),
	]);
}

export function resolveGlobalAgentsRulesPath(): string {
	return join(HOME_DIR, LEGACY_AGENT_SKILLS_CONFIG_DIR, AGENTS_RULES_FILE_NAME);
}

export function resolveRulesConfigSearchPaths(
	workspacePath?: string,
): string[] {
	const wsPaths = workspacePath
		? [
				join(workspacePath, DEPRECATED_CONFIG_DIR),
				join(workspacePath, CLINE_CONFIG_DIR, RULES_CONFIG_DIRECTORY_NAME),
				join(workspacePath, CURSOR_CONFIG_DIR, RULES_CONFIG_DIRECTORY_NAME),
				join(workspacePath, CODEVIBE_CONFIG_DIR, RULES_CONFIG_DIRECTORY_NAME),
			]
		: [];
	const workspaceAgentsFile = workspacePath
		? [
				join(workspacePath, AGENTS_RULES_FILE_NAME),
				join(workspacePath, CURSOR_RULES_FILE_NAME),
			]
		: [];
	return dedupePaths([
		...workspaceAgentsFile,
		...wsPaths,
		resolveGlobalAgentsRulesPath(),
		join(resolveLegacyClineDir(), RULES_CONFIG_DIRECTORY_NAME),
		resolveDocumentsClineExtensionPath("Rules"),
		resolveDocumentsExtensionPath("Rules"),
		join(resolveCodeVibeDir(), RULES_CONFIG_DIRECTORY_NAME),
	]);
}

export function resolveWorkflowsConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return dedupePaths([
		workspacePath
			? join(workspacePath, ".clinerules", WORKFLOWS_CONFIG_DIRECTORY_NAME)
			: "",
		workspacePath
			? join(workspacePath, ".cline", WORKFLOWS_CONFIG_DIRECTORY_NAME)
			: "",
		resolveDocumentsClineExtensionPath("Workflows"),
		join(resolveLegacyClineDir(), WORKFLOWS_CONFIG_DIRECTORY_NAME),
		resolveDocumentsExtensionPath("Workflows"),
		join(resolveCodeVibeDir(), WORKFLOWS_CONFIG_DIRECTORY_NAME),
		workspacePath
			? join(workspacePath, ".codevibe", WORKFLOWS_CONFIG_DIRECTORY_NAME)
			: "",
	]);
}

export function resolvePluginConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return dedupePaths([
		workspacePath
			? join(workspacePath, ".codevibe", PLUGINS_DIRECTORY_NAME)
			: "",
		join(resolveCodeVibeDir(), PLUGINS_DIRECTORY_NAME),
		resolveDocumentsExtensionPath("Plugins"),
		workspacePath ? join(workspacePath, ".cline", PLUGINS_DIRECTORY_NAME) : "",
		join(resolveLegacyClineDir(), PLUGINS_DIRECTORY_NAME),
		resolveDocumentsClineExtensionPath("Plugins"),
	]);
}

const PLUGIN_MODULE_EXTENSIONS = new Set([".js", ".ts"]);
const PLUGIN_PACKAGE_JSON_FILE_NAME = "package.json";
const PLUGIN_DIRECTORY_INDEX_CANDIDATES = ["index.ts", "index.js"];

interface PluginPackageManifest {
	plugins?: PluginManifest[];
}

export function isPluginModulePath(path: string): boolean {
	const dot = path.lastIndexOf(".");
	if (dot === -1) {
		return false;
	}
	return PLUGIN_MODULE_EXTENSIONS.has(path.slice(dot));
}

function readPluginPackageManifest(
	packageJsonPath: string,
): PluginPackageManifest | null {
	try {
		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
			codevibe?: PluginPackageManifest;
			cline?: PluginPackageManifest;
		};
		if (packageJson.codevibe && typeof packageJson.codevibe === "object") {
			return packageJson.codevibe;
		}
		if (!packageJson.cline || typeof packageJson.cline !== "object") {
			return null;
		}
		return packageJson.cline;
	} catch {
		return null;
	}
}

function getManifestPluginEntries(
	manifest: PluginPackageManifest | null,
): string[] {
	const entries = manifest?.plugins;
	if (!Array.isArray(entries)) {
		return [];
	}
	return entries.flatMap((entry) => entry.paths ?? []);
}

export function resolvePluginModuleEntries(
	directoryPath: string,
): string[] | null {
	const root = resolve(directoryPath);
	if (!existsSync(root) || !statSync(root).isDirectory()) {
		return null;
	}

	const packageJsonPath = join(root, PLUGIN_PACKAGE_JSON_FILE_NAME);
	if (existsSync(packageJsonPath)) {
		const manifest = readPluginPackageManifest(packageJsonPath);
		const entries = getManifestPluginEntries(manifest)
			.map((entry) => resolve(root, entry))
			.filter(
				(entryPath) =>
					existsSync(entryPath) &&
					statSync(entryPath).isFile() &&
					isPluginModulePath(entryPath),
			);
		if (entries.length > 0) {
			return entries;
		}
	}

	for (const candidate of PLUGIN_DIRECTORY_INDEX_CANDIDATES) {
		const entryPath = join(root, candidate);
		if (existsSync(entryPath) && statSync(entryPath).isFile()) {
			return [entryPath];
		}
	}

	return null;
}

export function discoverPluginModulePaths(directoryPath: string): string[] {
	const root = resolve(directoryPath);
	if (!existsSync(root)) {
		return [];
	}
	const discovered: string[] = [];
	const stack = [root];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) {
			continue;
		}
		let entries: Dirent[];
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const candidate = join(current, entry.name);
			if (entry.isDirectory()) {
				const packageJsonPath = join(candidate, PLUGIN_PACKAGE_JSON_FILE_NAME);
				if (existsSync(packageJsonPath)) {
					const manifest = readPluginPackageManifest(packageJsonPath);
					const entries = getManifestPluginEntries(manifest)
						.map((e) => resolve(candidate, e))
						.filter(
							(entryPath) =>
								existsSync(entryPath) &&
								statSync(entryPath).isFile() &&
								isPluginModulePath(entryPath),
						);
					if (entries.length > 0) {
						discovered.push(...entries);
						continue;
					}
				}
				stack.push(candidate);
				continue;
			}
			if (entry.name.startsWith(".")) {
				continue;
			}
			if (entry.isFile() && isPluginModulePath(candidate)) {
				discovered.push(candidate);
			}
		}
	}
	return discovered.sort((a, b) => a.localeCompare(b));
}

export function resolveConfiguredPluginModulePaths(
	pluginPaths: ReadonlyArray<string>,
	cwd: string,
): string[] {
	const resolvedPaths: string[] = [];
	for (const pluginPath of pluginPaths) {
		const trimmed = pluginPath.trim();
		if (!trimmed) {
			continue;
		}
		const absolutePath = resolve(cwd, trimmed);
		if (!existsSync(absolutePath)) {
			throw new Error(`Plugin path does not exist: ${absolutePath}`);
		}
		const stats = statSync(absolutePath);
		if (stats.isDirectory()) {
			const entries = resolvePluginModuleEntries(absolutePath);
			if (entries) {
				resolvedPaths.push(...entries);
				continue;
			}
			resolvedPaths.push(...discoverPluginModulePaths(absolutePath));
			continue;
		}
		if (!isPluginModulePath(absolutePath)) {
			throw new Error(
				`Plugin file must use a supported extension (${[...PLUGIN_MODULE_EXTENSIONS].join(", ")}): ${absolutePath}`,
			);
		}
		resolvedPaths.push(absolutePath);
	}
	return resolvedPaths;
}

export function ensureParentDir(filePath: string): void {
	const parent = dirname(filePath);
	if (!existsSync(parent)) {
		mkdirSync(parent, { recursive: true });
	}
}

export function ensureFileExists(filePath: string): void {
	mkdirSync(dirname(filePath), { recursive: true });
	appendFileSync(filePath, "");
}

export function ensureHookLogDir(filePath?: string): string {
	if (filePath?.trim()) {
		ensureParentDir(filePath);
		return dirname(filePath);
	}
	const dir = join(resolveClineDataDir(), "logs");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}
