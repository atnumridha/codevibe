import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { handleDesktopCommand } from "./desktop-commands";
import { HubContext } from "./state";

function withMcpSettingsFile(t: test.TestContext): string {
	const dir = mkdtempSync(join(tmpdir(), "cline-hub-desktop-mcp-"));
	const settingsPath = join(dir, "cline_mcp_settings.json");
	writeFileSync(
		settingsPath,
		`${JSON.stringify(
			{
				mcpServers: {
					local: {
						transport: {
							type: "stdio",
							command: "node",
						},
					},
				},
			},
			null,
			2,
		)}\n`,
	);
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

test("authorize_mcp_server_oauth dispatches to the hub MCP OAuth flow", async (t) => {
	withMcpSettingsFile(t);

	await assert.rejects(
		() =>
			handleDesktopCommand(new HubContext(), "authorize_mcp_server_oauth", {
				name: "local",
			}),
		/MCP server "local" uses stdio transport and does not support OAuth browser flow/,
	);
});

test("authenticate_mcp_server remains a compatibility alias", async (t) => {
	withMcpSettingsFile(t);

	await assert.rejects(
		() =>
			handleDesktopCommand(new HubContext(), "authenticate_mcp_server", {
				serverName: "local",
			}),
		/MCP server "local" uses stdio transport and does not support OAuth browser flow/,
	);
});
