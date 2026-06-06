import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	runCursorMcpInstallCommand,
	runCursorUriCommand,
} from "./cursor-mcp";

describe("Cursor MCP install command", () => {
	const originalSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
	const tempDirs: string[] = [];

	afterEach(async () => {
		process.env.CLINE_MCP_SETTINGS_PATH = originalSettingsPath;
		await Promise.all(
			tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
		);
		tempDirs.length = 0;
	});

	async function useTempSettingsPath(): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), "cline-cursor-mcp-"));
		tempDirs.push(dir);
		const settingsPath = join(dir, "cline_mcp_settings.json");
		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		return settingsPath;
	}

	function createIo() {
		const out: string[] = [];
		const err: string[] = [];
		return {
			out,
			err,
			io: {
				writeln: (text = "") => out.push(text),
				writeErr: (text: string) => err.push(text),
			},
		};
	}

	it("previews Cursor MCP installs without writing settings", async () => {
		await useTempSettingsPath();
		const { out, err, io } = createIo();

		const code = await runCursorMcpInstallCommand({
			uri: "vscode://cline.cline/mcp/install?name=docs&url=https%3A%2F%2Fmcp.example.com",
			io,
		});

		expect(code).toBe(0);
		expect(err).toEqual([]);
		expect(out.join("\n")).toContain("Re-run with --yes");
	});

	it("writes confirmed installs as direct MCP server records", async () => {
		const settingsPath = await useTempSettingsPath();
		const { out, io } = createIo();

		const code = await runCursorMcpInstallCommand({
			uri: "vscode://cline.cline/mcp/install?name=linear&package=%40modelcontextprotocol%2Fserver-linear",
			confirmed: true,
			io,
		});

		expect(code).toBe(0);
		expect(out.join("\n")).toContain('Installed MCP server "linear"');

		const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as {
			mcpServers?: Record<string, Record<string, unknown>>;
		};
		expect(parsed.mcpServers?.linear).toMatchObject({
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-linear"],
			type: "stdio",
		});
	});

	it("returns JSON errors without writing secret details", async () => {
		await useTempSettingsPath();
		const { out, io } = createIo();

		const code = await runCursorMcpInstallCommand({
			uri: "vscode://cline.cline/createchat?prompt=hi",
			json: true,
			io,
		});

		expect(code).toBe(1);
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			installed: false,
			error: expect.stringContaining("Expected /mcp/install route"),
		});
	});

	it("dispatches generic URI installs and rejects unsupported routes", async () => {
		const settingsPath = await useTempSettingsPath();
		const install = createIo();

		await expect(
			runCursorUriCommand({
				uri: "vscode://cline.cline/mcp/install?name=docs&url=https%3A%2F%2Fmcp.example.com",
				confirmed: true,
				io: install.io,
			}),
		).resolves.toBe(0);

		await expect(readFile(settingsPath, "utf8")).resolves.toContain("docs");

		const unsupported = createIo();
		await expect(
			runCursorUriCommand({
				uri: "vscode://cline.cline/createchat?prompt=hi",
				json: true,
				io: unsupported.io,
			}),
		).resolves.toBe(1);
		expect(JSON.parse(unsupported.out[0] ?? "{}")).toMatchObject({
			handled: false,
			error: "Unsupported Cursor URI route for CLI: /createchat",
		});
	});
});
