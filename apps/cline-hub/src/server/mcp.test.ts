import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("authorizeMcpServerOAuthForHub requires a server name", async () => {
	await assert.rejects(
		() => mcpModule.authorizeMcpServerOAuthForHub({}),
		/authorize_mcp_server_oauth requires a server name/,
	);
});
