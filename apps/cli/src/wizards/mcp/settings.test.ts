import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseStdioCommand } from "./index";
import {
	addServer,
	addServerRecord,
	clearServerOAuth,
	loadServers,
	removeServer,
} from "./settings";

describe("MCP wizard settings", () => {
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
		const dir = await mkdtemp(join(tmpdir(), "cline-mcp-settings-"));
		tempDirs.push(dir);
		const settingsPath = join(dir, "cline_mcp_settings.json");
		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		return settingsPath;
	}

	it("preserves unrelated top-level settings when writing servers", async () => {
		const settingsPath = await useTempSettingsPath();
		await writeFile(
			settingsPath,
			`${JSON.stringify(
				{
					otherSetting: true,
					mcpServers: {
						existing: { transport: { type: "stdio", command: "node" } },
					},
				},
				null,
				2,
			)}\n`,
		);

		addServer("added", { type: "stdio", command: "npx", args: ["server"] });
		removeServer("existing");

		const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as {
			otherSetting?: boolean;
			mcpServers?: Record<string, unknown>;
		};
		expect(parsed.otherSetting).toBe(true);
		expect(Object.keys(parsed.mcpServers ?? {})).toEqual(["added"]);
	});

	it("parses quoted stdio command arguments", () => {
		expect(
			parseStdioCommand('npx -y "@scope/server name" --root "my dir"'),
		).toEqual(["npx", "-y", "@scope/server name", "--root", "my dir"]);
	});

	it("loads and clears OAuth state stored on a server entry", async () => {
		const settingsPath = await useTempSettingsPath();
		await writeFile(
			settingsPath,
			`${JSON.stringify(
				{
					mcpServers: {
						linear: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.linear.app/mcp",
							},
							oauth: {
								tokens: {
									access_token: "oauth-token",
								},
								lastAuthenticatedAt: 123,
							},
						},
					},
				},
				null,
				2,
			)}\n`,
		);

		expect(loadServers()[0]?.oauth?.tokens?.access_token).toBe("oauth-token");

		clearServerOAuth("linear");

		const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as {
			mcpServers?: {
				linear?: {
					oauth?: unknown;
				};
			};
		};
		expect(parsed.mcpServers?.linear?.oauth).toBeUndefined();
	});

	it("preserves direct MCP server records written by Cursor install", async () => {
		const settingsPath = await useTempSettingsPath();

		addServerRecord("linear", {
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-linear"],
			type: "stdio",
			disabled: false,
		});

		const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as {
			mcpServers?: Record<string, unknown>;
		};
		expect(parsed.mcpServers?.linear).toEqual({
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-linear"],
			type: "stdio",
			disabled: false,
		});
		expect(loadServers()[0]?.transport).toMatchObject({
			command: "npx",
			type: "stdio",
		});
	});

	it("does not create an empty server when clearing OAuth for a missing name", async () => {
		const settingsPath = await useTempSettingsPath();
		await writeFile(
			settingsPath,
			`${JSON.stringify(
				{
					mcpServers: {
						linear: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.linear.app/mcp",
							},
						},
					},
				},
				null,
				2,
			)}\n`,
		);
		const before = await readFile(settingsPath, "utf8");

		clearServerOAuth("missing");

		await expect(readFile(settingsPath, "utf8")).resolves.toBe(before);
	});

	it("keeps invalid JSON settings unchanged when writing servers", async () => {
		const settingsPath = await useTempSettingsPath();
		const invalid = "{ not json";
		await writeFile(settingsPath, invalid);

		expect(loadServers()).toEqual([]);
		expect(() =>
			addServerRecord("linear", {
				command: "npx",
				args: ["-y", "@modelcontextprotocol/server-linear"],
				type: "stdio",
			}),
		).toThrow("contains invalid JSON");

		await expect(readFile(settingsPath, "utf8")).resolves.toBe(invalid);
	});

	it("keeps malformed mcpServers settings unchanged when writing servers", async () => {
		const settingsPath = await useTempSettingsPath();
		const malformed = `${JSON.stringify(
			{
				otherSetting: true,
				mcpServers: "not an object",
			},
			null,
			2,
		)}\n`;
		await writeFile(settingsPath, malformed);

		expect(loadServers()).toEqual([]);
		expect(() =>
			addServerRecord("linear", {
				command: "npx",
				args: ["-y", "@modelcontextprotocol/server-linear"],
				type: "stdio",
			}),
		).toThrow("mcpServers must be a JSON object");

		await expect(readFile(settingsPath, "utf8")).resolves.toBe(malformed);
	});

	it("keeps non-object root settings unchanged when writing servers", async () => {
		const settingsPath = await useTempSettingsPath();
		const malformed = "[]\n";
		await writeFile(settingsPath, malformed);

		expect(loadServers()).toEqual([]);
		expect(() =>
			addServerRecord("linear", {
				command: "npx",
				args: ["-y", "@modelcontextprotocol/server-linear"],
				type: "stdio",
			}),
		).toThrow("must contain a JSON object");

		await expect(readFile(settingsPath, "utf8")).resolves.toBe(malformed);
	});
});
