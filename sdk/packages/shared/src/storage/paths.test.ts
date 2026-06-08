import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	AGENT_CONFIG_DIRECTORY_NAME,
	CLINE_MCP_SETTINGS_FILE_NAME,
	CODEVIBE_MCP_SETTINGS_FILE_NAME,
	HOOKS_CONFIG_DIRECTORY_NAME,
	RULES_CONFIG_DIRECTORY_NAME,
	resolveAgentsConfigDirPath,
	resolveClineDataDir,
	resolveClineDir,
	resolveCodeVibeDataDir,
	resolveCodeVibeDir,
	resolveDbDataDir,
	resolveGlobalAgentsRulesPath,
	resolveGlobalSettingsPath,
	resolveHooksConfigSearchPaths,
	resolveMcpSettingsPath,
	resolveProviderSettingsPath,
	resolveRulesConfigSearchPaths,
	resolveSessionDataDir,
	resolveTeamDataDir,
	resolveWorkflowsConfigSearchPaths,
} from "./paths";

type EnvSnapshot = {
	CODEVIBE_DATA_DIR: string | undefined;
	CODEVIBE_DB_DATA_DIR: string | undefined;
	CODEVIBE_DIR: string | undefined;
	CODEVIBE_GLOBAL_SETTINGS_PATH: string | undefined;
	CODEVIBE_MCP_SETTINGS_PATH: string | undefined;
	CODEVIBE_PROVIDER_SETTINGS_PATH: string | undefined;
	CODEVIBE_SESSION_DATA_DIR: string | undefined;
	CODEVIBE_TEAM_DATA_DIR: string | undefined;
	CLINE_DIR: string | undefined;
	CLINE_DATA_DIR: string | undefined;
	CLINE_DB_DATA_DIR: string | undefined;
	CLINE_GLOBAL_SETTINGS_PATH: string | undefined;
	CLINE_MCP_SETTINGS_PATH: string | undefined;
	CLINE_PROVIDER_SETTINGS_PATH: string | undefined;
	CLINE_SESSION_DATA_DIR: string | undefined;
	CLINE_TEAM_DATA_DIR: string | undefined;
};

let snapshot: EnvSnapshot;

function captureEnv(): EnvSnapshot {
	return {
		CODEVIBE_DATA_DIR: process.env.CODEVIBE_DATA_DIR,
		CODEVIBE_DB_DATA_DIR: process.env.CODEVIBE_DB_DATA_DIR,
		CODEVIBE_DIR: process.env.CODEVIBE_DIR,
		CODEVIBE_GLOBAL_SETTINGS_PATH: process.env.CODEVIBE_GLOBAL_SETTINGS_PATH,
		CODEVIBE_MCP_SETTINGS_PATH: process.env.CODEVIBE_MCP_SETTINGS_PATH,
		CODEVIBE_PROVIDER_SETTINGS_PATH:
			process.env.CODEVIBE_PROVIDER_SETTINGS_PATH,
		CODEVIBE_SESSION_DATA_DIR: process.env.CODEVIBE_SESSION_DATA_DIR,
		CODEVIBE_TEAM_DATA_DIR: process.env.CODEVIBE_TEAM_DATA_DIR,
		CLINE_DIR: process.env.CLINE_DIR,
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
		CLINE_DB_DATA_DIR: process.env.CLINE_DB_DATA_DIR,
		CLINE_GLOBAL_SETTINGS_PATH: process.env.CLINE_GLOBAL_SETTINGS_PATH,
		CLINE_MCP_SETTINGS_PATH: process.env.CLINE_MCP_SETTINGS_PATH,
		CLINE_PROVIDER_SETTINGS_PATH: process.env.CLINE_PROVIDER_SETTINGS_PATH,
		CLINE_SESSION_DATA_DIR: process.env.CLINE_SESSION_DATA_DIR,
		CLINE_TEAM_DATA_DIR: process.env.CLINE_TEAM_DATA_DIR,
	};
}

function restoreEnv(snapshot: EnvSnapshot): void {
	process.env.CODEVIBE_DATA_DIR = snapshot.CODEVIBE_DATA_DIR;
	process.env.CODEVIBE_DB_DATA_DIR = snapshot.CODEVIBE_DB_DATA_DIR;
	process.env.CODEVIBE_DIR = snapshot.CODEVIBE_DIR;
	process.env.CODEVIBE_GLOBAL_SETTINGS_PATH =
		snapshot.CODEVIBE_GLOBAL_SETTINGS_PATH;
	process.env.CODEVIBE_MCP_SETTINGS_PATH = snapshot.CODEVIBE_MCP_SETTINGS_PATH;
	process.env.CODEVIBE_PROVIDER_SETTINGS_PATH =
		snapshot.CODEVIBE_PROVIDER_SETTINGS_PATH;
	process.env.CODEVIBE_SESSION_DATA_DIR = snapshot.CODEVIBE_SESSION_DATA_DIR;
	process.env.CODEVIBE_TEAM_DATA_DIR = snapshot.CODEVIBE_TEAM_DATA_DIR;
	process.env.CLINE_DATA_DIR = snapshot.CLINE_DATA_DIR;
	process.env.CLINE_DIR = snapshot.CLINE_DIR;
	process.env.CLINE_DB_DATA_DIR = snapshot.CLINE_DB_DATA_DIR;
	process.env.CLINE_GLOBAL_SETTINGS_PATH = snapshot.CLINE_GLOBAL_SETTINGS_PATH;
	process.env.CLINE_MCP_SETTINGS_PATH = snapshot.CLINE_MCP_SETTINGS_PATH;
	process.env.CLINE_PROVIDER_SETTINGS_PATH =
		snapshot.CLINE_PROVIDER_SETTINGS_PATH;
	process.env.CLINE_SESSION_DATA_DIR = snapshot.CLINE_SESSION_DATA_DIR;
	process.env.CLINE_TEAM_DATA_DIR = snapshot.CLINE_TEAM_DATA_DIR;
}

function clearStorageEnv(): void {
	delete process.env.CODEVIBE_DATA_DIR;
	delete process.env.CODEVIBE_DB_DATA_DIR;
	delete process.env.CODEVIBE_DIR;
	delete process.env.CODEVIBE_GLOBAL_SETTINGS_PATH;
	delete process.env.CODEVIBE_MCP_SETTINGS_PATH;
	delete process.env.CODEVIBE_PROVIDER_SETTINGS_PATH;
	delete process.env.CODEVIBE_SESSION_DATA_DIR;
	delete process.env.CODEVIBE_TEAM_DATA_DIR;
	delete process.env.CLINE_DATA_DIR;
	delete process.env.CLINE_DB_DATA_DIR;
	delete process.env.CLINE_DIR;
	delete process.env.CLINE_GLOBAL_SETTINGS_PATH;
	delete process.env.CLINE_MCP_SETTINGS_PATH;
	delete process.env.CLINE_PROVIDER_SETTINGS_PATH;
	delete process.env.CLINE_SESSION_DATA_DIR;
	delete process.env.CLINE_TEAM_DATA_DIR;
}

function startTestEnv(): void {
	snapshot = captureEnv();
	clearStorageEnv();
}

describe("storage path resolution", () => {
	afterEach(() => {
		restoreEnv(snapshot);
	});

	it("uses CODEVIBE_DIR as-is and beats CLINE_DIR when both are set", () => {
		startTestEnv();
		process.env.CODEVIBE_DIR = "/tmp/home/.codevibe";
		process.env.CLINE_DIR = "/tmp/home/.cline";

		expect(resolveCodeVibeDir()).toBe("/tmp/home/.codevibe");
		expect(resolveClineDir()).toBe("/tmp/home/.codevibe");
	});

	it("uses CODEVIBE_DATA_DIR as-is and beats CLINE_DATA_DIR when both are set", () => {
		startTestEnv();
		process.env.CODEVIBE_DATA_DIR = "/tmp/codevibe-data";
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveCodeVibeDataDir()).toBe("/tmp/codevibe-data");
		expect(resolveClineDataDir()).toBe("/tmp/codevibe-data");
	});

	it("uses CLINE_DATA_DIR as a legacy fallback when set", () => {
		startTestEnv();
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveClineDataDir()).toBe("/tmp/cline-data");
	});

	it("falls back to CLINE_DATA_DIR/sessions for session storage", () => {
		startTestEnv();
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveSessionDataDir()).toBe(join("/tmp/cline-data", "sessions"));
	});

	it("uses CODEVIBE_SESSION_DATA_DIR before CLINE_SESSION_DATA_DIR", () => {
		startTestEnv();
		process.env.CODEVIBE_SESSION_DATA_DIR = "/tmp/codevibe-sessions";
		process.env.CLINE_SESSION_DATA_DIR = "/tmp/cline-sessions";

		expect(resolveSessionDataDir()).toBe("/tmp/codevibe-sessions");
	});

	it("falls back to CLINE_DATA_DIR/teams for team storage", () => {
		startTestEnv();
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveTeamDataDir()).toBe(join("/tmp/cline-data", "teams"));
	});

	it("falls back to CLINE_DATA_DIR/db for sqlite storage", () => {
		startTestEnv();
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveDbDataDir()).toBe(join("/tmp/cline-data", "db"));
	});

	it("falls back to CLINE_DATA_DIR/settings/providers.json for provider settings", () => {
		startTestEnv();
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveProviderSettingsPath()).toBe(
			join("/tmp/cline-data", "settings", "providers.json"),
		);
	});

	it("falls back to CLINE_DATA_DIR/settings/global-settings.json for global settings", () => {
		startTestEnv();
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";

		expect(resolveGlobalSettingsPath()).toBe(
			join("/tmp/cline-data", "settings", "global-settings.json"),
		);
	});

	it("falls back to CODEVIBE_DATA_DIR/settings/codevibe_mcp_settings.json for MCP settings", () => {
		startTestEnv();
		process.env.CODEVIBE_DATA_DIR = "/tmp/codevibe-data";

		expect(resolveMcpSettingsPath()).toBe(
			join("/tmp/codevibe-data", "settings", CODEVIBE_MCP_SETTINGS_FILE_NAME),
		);
	});

	it("uses CLINE_MCP_SETTINGS_PATH as a legacy explicit fallback", () => {
		startTestEnv();
		process.env.CLINE_MCP_SETTINGS_PATH = "/tmp/cline_mcp_settings.json";

		expect(resolveMcpSettingsPath()).toBe("/tmp/cline_mcp_settings.json");
		expect(CLINE_MCP_SETTINGS_FILE_NAME).toBe("cline_mcp_settings.json");
	});

	it("falls back to ~/.cline/.agents for agent configs", () => {
		startTestEnv();
		process.env.CLINE_DIR = "/tmp/home/.cline";

		expect(resolveAgentsConfigDirPath()).toBe(
			join("/tmp/home", ".cline", AGENT_CONFIG_DIRECTORY_NAME),
		);
	});

	it("resolves global hooks from ~/.cline", () => {
		startTestEnv();
		process.env.CLINE_DIR = "/tmp/home/.cline";
		process.env.CLINE_DATA_DIR = "/tmp/home/.cline/data";

		expect(resolveHooksConfigSearchPaths()).toEqual(
			expect.arrayContaining([
				join("/tmp/home", ".cline", HOOKS_CONFIG_DIRECTORY_NAME),
			]),
		);
		expect(resolveHooksConfigSearchPaths()).not.toContain(
			join("/tmp/home", ".cline", "data", HOOKS_CONFIG_DIRECTORY_NAME),
		);
	});

	it("resolves global rules from ~/.cline", () => {
		startTestEnv();
		process.env.CLINE_DIR = "/tmp/home/.cline";
		process.env.CLINE_DATA_DIR = "/tmp/home/.cline/data";

		expect(resolveRulesConfigSearchPaths()).toEqual(
			expect.arrayContaining([
				resolveGlobalAgentsRulesPath(),
				join("/tmp/home", ".cline", RULES_CONFIG_DIRECTORY_NAME),
			]),
		);
		expect(resolveRulesConfigSearchPaths()).not.toContain(
			join("/tmp/home", ".cline", "data", RULES_CONFIG_DIRECTORY_NAME),
		);
	});

	it("resolves Cursor-compatible workspace rule paths", () => {
		startTestEnv();
		const workspacePath = "/repo/demo";

		expect(resolveRulesConfigSearchPaths(workspacePath)).toEqual(
			expect.arrayContaining([
				join(workspacePath, ".cursorrules"),
				join(workspacePath, ".cursor", RULES_CONFIG_DIRECTORY_NAME),
			]),
		);
	});

	it("resolves legacy and CodeVibe workflow paths, with .codevibe paths later for duplicate-name precedence", () => {
		startTestEnv();
		process.env.CODEVIBE_DIR = "/tmp/home/.codevibe";
		process.env.CLINE_DIR = "/tmp/home/.cline";
		const workspacePath = "/repo/demo";

		const paths = resolveWorkflowsConfigSearchPaths(workspacePath);

		expect(paths).toEqual([
			join(workspacePath, ".clinerules", "workflows"),
			join(workspacePath, ".cline", "workflows"),
			expect.stringContaining(join("Documents", "Cline", "Workflows")),
			join("/tmp/home", ".cline", "workflows"),
			expect.stringContaining(join("Documents", "CodeVibe", "Workflows")),
			join("/tmp/home", ".codevibe", "workflows"),
			join(workspacePath, ".codevibe", "workflows"),
		]);
	});
});
