import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { AuthorizeMcpServerOAuthOptions } from "@cline/core";
import * as mcpModule from "./mcp";

function withMcpSettingsFile(
	t: test.TestContext,
	settings: Record<string, unknown>,
): string {
	const dir = mkdtempSync(join(tmpdir(), "cline-hub-mcp-"));
	const settingsPath = join(dir, "cline_mcp_settings.json");
	writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
	const previous = process.env.CLINE_MCP_SETTINGS_PATH;
	process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
	t.after(() => {
		if (previous === undefined) {
			delete process.env.CLINE_MCP_SETTINGS_PATH;
		} else {
			process.env.CLINE_MCP_SETTINGS_PATH = previous;
		}
		rmSync(dir, { recursive: true, force: true });
	});
	return settingsPath;
}

function withTempDir(t: test.TestContext): string {
	const dir = mkdtempSync(join(tmpdir(), "cline-hub-mcp-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

function writeJsonFile(filePath: string, value: Record<string, unknown>): void {
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function withEnvValue(
	t: test.TestContext,
	key: string,
	value: string | undefined,
): void {
	const previous = process.env[key];
	if (value === undefined) {
		delete process.env[key];
	} else {
		process.env[key] = value;
	}
	t.after(() => {
		if (previous === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = previous;
		}
	});
}

test("readMcpServersResponse exposes sanitized OAuth status", (t) => {
	withMcpSettingsFile(t, {
		mcpServers: {
			local: {
				transport: {
					type: "stdio",
					command: "node",
				},
			},
			remote: {
				transport: {
					type: "streamableHttp",
					url: "https://mcp.example.test",
				},
				oauth: {
					lastError: 'MCP server "remote" requires OAuth authorization.',
				},
			},
			authed: {
				transport: {
					type: "sse",
					url: "https://mcp.example.test/sse",
				},
				oauth: {
					tokens: {
						access_token: "secret-token",
					},
					lastAuthenticatedAt: 1_780_884_800_000,
				},
			},
		},
	});

	const response = mcpModule.readMcpServersResponse();
	const servers = response.servers as Array<Record<string, unknown>>;
	const local = servers.find((server) => server.name === "local");
	const remote = servers.find((server) => server.name === "remote");
	const authed = servers.find((server) => server.name === "authed");

	assert.equal(local?.oauthSupported, false);
	assert.equal(local?.oauthStatus, "unsupported");
	assert.equal(remote?.oauthSupported, true);
	assert.equal(remote?.oauthConfigured, false);
	assert.equal(remote?.oauthStatus, "needs_auth");
	assert.equal(
		remote?.oauthLastError,
		'MCP server "remote" requires OAuth authorization.',
	);
	assert.equal(authed?.oauthSupported, true);
	assert.equal(authed?.oauthConfigured, true);
	assert.equal(authed?.oauthStatus, "authenticated");
	assert.equal(authed?.oauthLastAuthenticatedAt, 1_780_884_800_000);
	assert.equal(Object.hasOwn(authed ?? {}, "oauth"), false);
	assert.equal(JSON.stringify(response).includes("secret-token"), false);
});

test("readMcpServersResponse merges native, workspace Cursor, and global Cursor sources", (t) => {
	const dir = withTempDir(t);
	const nativePath = join(dir, "settings", "cline_mcp_settings.json");
	const workspaceRoot = join(dir, "workspace");
	const userHome = join(dir, "home");
	const workspaceCursorPath = join(workspaceRoot, ".cursor", "mcp.json");
	const globalCursorPath = join(userHome, ".cursor", "mcp.json");
	withEnvValue(t, "CLINE_MCP_SETTINGS_PATH", nativePath);
	withEnvValue(t, "CODEVIBE_CURSOR_HOME", userHome);
	withEnvValue(t, "CODEVIBE_LIVE_MCP_TEST_ENV", "expanded-env");
	writeJsonFile(nativePath, {
		mcpServers: {
			alpha: {
				transport: {
					type: "stdio",
					command: "native-alpha",
				},
			},
			duplicate: {
				transport: {
					type: "stdio",
					command: "native-duplicate",
				},
			},
		},
	});
	writeJsonFile(workspaceCursorPath, {
		mcpServers: {
			beta: {
				type: "stdio",
				command: "${workspaceFolder}${/}bin${/}cursor-beta",
				args: [
					"${workspaceFolderBasename}",
					"${env:CODEVIBE_LIVE_MCP_TEST_ENV}",
				],
			},
			duplicate: {
				type: "stdio",
				command: "workspace-duplicate",
			},
		},
	});
	writeJsonFile(globalCursorPath, {
		mcpServers: {
			beta: {
				type: "stdio",
				command: "global-beta",
			},
			gamma: {
				type: "stdio",
				command: "${userHome}${/}bin${/}cursor-gamma",
			},
		},
	});

	const response = mcpModule.readMcpServersResponse({
		workspaceRoot,
		userHome,
	});
	const servers = response.servers as Array<Record<string, unknown>>;
	const skipped = response.skippedServers as Array<Record<string, unknown>>;

	assert.deepEqual(
		servers.map((server) => server.name),
		["alpha", "duplicate", "beta", "gamma"],
	);
	assert.equal(servers[0].settingsSource, "cline");
	assert.equal(servers[0].settingsPath, nativePath);
	assert.equal(servers[2].settingsSource, "cursor-workspace");
	assert.equal(servers[2].settingsPath, workspaceCursorPath);
	assert.equal(servers[2].command, join(workspaceRoot, "bin", "cursor-beta"));
	assert.deepEqual(servers[2].args, ["workspace", "expanded-env"]);
	assert.equal(servers[2].canEdit, false);
	assert.equal(servers[3].settingsSource, "cursor-global");
	assert.equal(servers[3].settingsPath, globalCursorPath);
	assert.equal(servers[3].command, join(userHome, "bin", "cursor-gamma"));
	assert.deepEqual(
		skipped.map((entry) => [
			entry.name,
			entry.settingsSource,
			entry.shadowedBy,
		]),
		[
			["duplicate", "cursor-workspace", "cline"],
			["beta", "cursor-global", "cursor-workspace"],
		],
	);
});

test("setMcpServerDisabled writes global Cursor source servers in place", (t) => {
	const dir = withTempDir(t);
	const nativePath = join(dir, "settings", "cline_mcp_settings.json");
	const userHome = join(dir, "home");
	const globalCursorPath = join(userHome, ".cursor", "mcp.json");
	withEnvValue(t, "CLINE_MCP_SETTINGS_PATH", nativePath);
	withEnvValue(t, "CODEVIBE_CURSOR_HOME", userHome);
	writeJsonFile(nativePath, { mcpServers: {} });
	writeJsonFile(globalCursorPath, {
		mcpServers: {
			gamma: {
				type: "stdio",
				command: "cursor-gamma",
				disabled: false,
			},
		},
	});

	const response = mcpModule.setMcpServerDisabled("gamma", true);
	const nativeSettings = JSON.parse(readFileSync(nativePath, "utf8"));
	const cursorSettings = JSON.parse(readFileSync(globalCursorPath, "utf8"));
	const gamma = (response.servers as Array<Record<string, unknown>>).find(
		(server) => server.name === "gamma",
	);

	assert.equal(nativeSettings.mcpServers.gamma, undefined);
	assert.equal(cursorSettings.mcpServers.gamma.disabled, true);
	assert.equal(gamma?.settingsSource, "cursor-global");
	assert.equal(gamma?.disabled, true);
});

test("authorizeMcpServerOAuthForHub delegates to SDK OAuth helper", async (t) => {
	const settingsPath = withMcpSettingsFile(t, {
		mcpServers: {
			remote: {
				transport: {
					type: "streamableHttp",
					url: "https://mcp.example.test",
				},
			},
		},
	});
	let openedUrl: string | undefined;
	let captured: AuthorizeMcpServerOAuthOptions | undefined;

	const response = await mcpModule.authorizeMcpServerOAuthForHub(
		{
			name: "remote",
			timeoutMs: 12_345,
		},
		{
			openUrl: (url) => {
				openedUrl = url;
			},
			authorize: async (options) => {
				captured = options;
				await options.openUrl?.("https://auth.example.test/authorize");
				await options.onServerListening?.({
					host: "127.0.0.1",
					port: 1456,
					callbackUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
				});
				await options.onServerClose?.({
					host: "127.0.0.1",
					port: 1456,
				});
				return {
					serverName: options.serverName,
					authorized: true,
					message: "authorized",
				};
			},
		},
	);

	assert.equal(captured?.serverName, "remote");
	assert.equal(captured?.filePath, settingsPath);
	assert.equal(captured?.clientName, "cline-hub");
	assert.equal(captured?.timeoutMs, 12_345);
	assert.equal(openedUrl, "https://auth.example.test/authorize");
	assert.equal(response.route, "mcp-oauth");
	assert.equal(response.authorized, true);
	assert.equal(response.message, "authorized");
	assert.deepEqual(response.serverListening, [
		{
			host: "127.0.0.1",
			port: 1456,
			callbackOrigin: "http://127.0.0.1:1456",
		},
	]);
	assert.deepEqual(response.serverClosed, [
		{
			host: "127.0.0.1",
			port: 1456,
		},
	]);
});

test("authorizeMcpServerOAuthForHub uses the owning Cursor source file", async (t) => {
	const dir = withTempDir(t);
	const nativePath = join(dir, "settings", "cline_mcp_settings.json");
	const userHome = join(dir, "home");
	const globalCursorPath = join(userHome, ".cursor", "mcp.json");
	withEnvValue(t, "CLINE_MCP_SETTINGS_PATH", nativePath);
	withEnvValue(t, "CODEVIBE_CURSOR_HOME", userHome);
	writeJsonFile(nativePath, { mcpServers: {} });
	writeJsonFile(globalCursorPath, {
		mcpServers: {
			remote: {
				type: "streamableHttp",
				url: "https://mcp.example.test",
			},
		},
	});
	let captured: AuthorizeMcpServerOAuthOptions | undefined;

	const response = await mcpModule.authorizeMcpServerOAuthForHub(
		{
			name: "remote",
		},
		{
			openUrl: () => undefined,
			authorize: async (options) => {
				captured = options;
				return {
					serverName: options.serverName,
					authorized: true,
					message: "authorized cursor source",
				};
			},
		},
	);

	assert.equal(captured?.filePath, globalCursorPath);
	assert.equal(captured?.timeoutMs, 110_000);
	assert.equal(response.message, "authorized cursor source");
	const remote = (response.servers as Array<Record<string, unknown>>).find(
		(server) => server.name === "remote",
	);
	assert.equal(remote?.settingsSource, "cursor-global");
});

test("upsertMcpServer preserves OAuth state for the same URL server", (t) => {
	withMcpSettingsFile(t, {
		mcpServers: {
			remote: {
				transport: {
					type: "streamableHttp",
					url: "https://mcp.example.test",
					headers: {
						"x-old": "value",
					},
				},
				oauth: {
					tokens: {
						access_token: "secret-token",
					},
					lastAuthenticatedAt: 1_780_884_800_000,
				},
			},
		},
	});

	const response = mcpModule.upsertMcpServer({
		name: "remote",
		previousName: "remote",
		transportType: "streamableHttp",
		url: "https://mcp.example.test",
		headers: {
			"x-new": "value",
		},
	});
	const servers = response.servers as Array<Record<string, unknown>>;
	const remote = servers.find((server) => server.name === "remote");

	assert.equal(remote?.oauthConfigured, true);
	assert.equal(remote?.oauthStatus, "authenticated");
	assert.equal(JSON.stringify(response).includes("secret-token"), false);
});

test("upsertMcpServer rejects names already owned by Cursor sources", (t) => {
	const dir = withTempDir(t);
	const nativePath = join(dir, "settings", "cline_mcp_settings.json");
	const userHome = join(dir, "home");
	const globalCursorPath = join(userHome, ".cursor", "mcp.json");
	withEnvValue(t, "CLINE_MCP_SETTINGS_PATH", nativePath);
	withEnvValue(t, "CODEVIBE_CURSOR_HOME", userHome);
	writeJsonFile(nativePath, { mcpServers: {} });
	writeJsonFile(globalCursorPath, {
		mcpServers: {
			remote: {
				type: "stdio",
				command: "cursor-remote",
			},
		},
	});

	assert.throws(
		() =>
			mcpModule.upsertMcpServer({
				name: "remote",
				transportType: "stdio",
				command: "native-remote",
			}),
		/MCP server "remote" already exists in cursor-global settings/,
	);
});

test("authorizeMcpServerOAuthForHub requires a server name", async () => {
	await assert.rejects(
		() => mcpModule.authorizeMcpServerOAuthForHub({}),
		/authorize_mcp_server_oauth requires a server name/,
	);
});
