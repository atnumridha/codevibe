import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	runCursorMcpInstallCommand,
	runCursorUriCommand,
} from "./cursor-mcp";

describe("Cursor MCP install command", () => {
	const originalSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
	const originalGlobalSettingsPath = process.env.CLINE_GLOBAL_SETTINGS_PATH;
	const tempDirs: string[] = [];

	afterEach(async () => {
		process.env.CLINE_MCP_SETTINGS_PATH = originalSettingsPath;
		process.env.CLINE_GLOBAL_SETTINGS_PATH = originalGlobalSettingsPath;
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

	it("does not overwrite invalid MCP settings during confirmed installs", async () => {
		const settingsPath = await useTempSettingsPath();
		const invalid = "{ not json";
		await writeFile(settingsPath, invalid);
		const { out, io } = createIo();

		const code = await runCursorMcpInstallCommand({
			uri: "vscode://cline.cline/mcp/install?name=linear&package=%40modelcontextprotocol%2Fserver-linear",
			confirmed: true,
			json: true,
			io,
		});

		expect(code).toBe(1);
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			installed: false,
			error: expect.stringContaining("contains invalid JSON"),
		});
		await expect(readFile(settingsPath, "utf8")).resolves.toBe(invalid);
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

	it("dispatches generic URI installs and agent task route previews", async () => {
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

		const agentTask = createIo();
		await expect(
			runCursorUriCommand({
				uri: "vscode://cline.cline/createchat?prompt=hi",
				json: true,
				io: agentTask.io,
			}),
		).resolves.toBe(0);
		expect(JSON.parse(agentTask.out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "createchat",
			path: "/createchat",
			requiresAgent: true,
			prompt: "hi",
			taskPrompt: "hi",
		});
	});

	it("rejects unsupported generic URI routes", async () => {
		const unsupported = createIo();

		await expect(
			runCursorUriCommand({
				uri: "vscode://cline.cline/unknown?prompt=hi",
				json: true,
				io: unsupported.io,
			}),
		).resolves.toBe(1);
		expect(JSON.parse(unsupported.out[0] ?? "{}")).toMatchObject({
			handled: false,
			error: "Unsupported Cursor URI route for CLI: /unknown",
		});
	});

	it("reports Cursor settings routes against the local settings file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "cline-cursor-settings-"));
		tempDirs.push(dir);
		const settingsPath = join(dir, "global-settings.json");
		process.env.CLINE_GLOBAL_SETTINGS_PATH = settingsPath;
		const { out, io } = createIo();

		const code = await runCursorUriCommand({
			uri: "vscode://cline.cline/settings?query=%40id%3Acline.apiProvider",
			json: true,
			io,
		});

		expect(code).toBe(0);
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "settings",
			settingsPath,
			query: "@id:cline.apiProvider",
			sourceParam: "query",
		});
	});

	it("previews and creates safe Cursor rule files", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "cline-cursor-rule-"));
		tempDirs.push(workspace);
		const preview = createIo();

		await expect(
			runCursorUriCommand({
				uri: "vscode://cline.cline/rule?name=team-style",
				cwd: workspace,
				io: preview.io,
			}),
		).resolves.toBe(0);
		expect(preview.out.join("\n")).toContain("Re-run with --yes");

		const install = createIo();
		await expect(
			runCursorUriCommand({
				uri: "vscode://cline.cline/rule?name=team-style",
				cwd: workspace,
				confirmed: true,
				json: true,
				io: install.io,
			}),
		).resolves.toBe(0);

		const result = JSON.parse(install.out[0] ?? "{}") as {
			filePath?: string;
			created?: boolean;
		};
		expect(result).toMatchObject({
			handled: true,
			route: "rule",
			created: true,
			filename: "team-style.mdc",
		});
		await expect(readFile(result.filePath ?? "", "utf8")).resolves.toBe("");

		const reuse = createIo();
		await expect(
			runCursorUriCommand({
				uri: "vscode://cline.cline/rule?name=team-style",
				cwd: workspace,
				confirmed: true,
				json: true,
				io: reuse.io,
			}),
		).resolves.toBe(0);
		expect(JSON.parse(reuse.out[0] ?? "{}")).toMatchObject({
			created: false,
			filename: "team-style.mdc",
		});
	});

	it("does not write Cursor rule content payloads directly", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "cline-cursor-rule-"));
		tempDirs.push(workspace);
		const { out, io } = createIo();

		const code = await runCursorUriCommand({
			uri: "vscode://cline.cline/rule?name=team-style&content=Use%20short%20commits",
			cwd: workspace,
			confirmed: true,
			json: true,
			io,
		});

		expect(code).toBe(0);
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "rule",
			requiresReview: true,
			name: "team-style",
		});
		await expect(readFile(join(workspace, ".cursor", "rules", "team-style.mdc"), "utf8")).rejects.toThrow();
	});

	it("previews command deeplinks without executing them", async () => {
		const { out, io } = createIo();

		const code = await runCursorUriCommand({
			uri: `vscode://cline.cline/command?command=npm%20install&config=${encodeConfig({ token: "secret-value" })}`,
			json: true,
			io,
		});

		expect(code).toBe(0);
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "command",
			requiresAgent: true,
			taskPrompt: expect.stringContaining("Review it with the user before running it"),
			paramKeys: ["command", "config"],
		});
		expect(out[0]).not.toContain("secret-value");
	});

	it("previews PR review, plugin add, and glass deeplinks", async () => {
		for (const [uri, route] of [
			["vscode://cline.cline/pr-review?repo=owner%2Frepo&number=42", "pr-review"],
			["vscode://cline.cline/plugin/add?id=docs-helper", "plugin-add"],
			["vscode://cline.cline/glass", "glass"],
		]) {
			const { out, io } = createIo();

			const code = await runCursorUriCommand({
				uri,
				json: true,
				io,
			});

			expect(code).toBe(0);
			expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
				handled: true,
				route,
				requiresAgent: true,
				taskPrompt: expect.any(String),
			});
		}
	});

	it("previews git helper deeplinks without mutating git", async () => {
		for (const [uri, route] of [
			[
				"vscode://cline.cline/git/checkout?branch=feature%2Fcursor-parity",
				"git-checkout",
			],
			[
				"vscode://cline.cline/git/branch?name=feature%2Fsafe&baseBranch=main",
				"git-branch",
			],
			[
				"vscode://cline.cline/git/commit?message=fix%3A%20safe%20git%20helpers&staged=true",
				"git-commit",
			],
		]) {
			const { out, io } = createIo();

			const code = await runCursorUriCommand({
				uri,
				json: true,
				io,
			});

			expect(code).toBe(0);
			expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
				handled: true,
				route,
				requiresAgent: true,
				taskPrompt: expect.stringContaining("not permission"),
			});
		}
	});

	it("returns generic JSON errors for invalid URI dispatch", async () => {
		const { out, io } = createIo();

		const code = await runCursorUriCommand({
			uri: "not a uri",
			json: true,
			io,
		});

		expect(code).toBe(1);
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			handled: false,
			error: expect.any(String),
		});
	});

	it("returns generic JSON errors for unsafe Cursor rule paths", async () => {
		const { out, io } = createIo();

		const code = await runCursorUriCommand({
			uri: "vscode://cline.cline/rule?path=../bad.mdc",
			json: true,
			io,
		});

		expect(code).toBe(1);
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			handled: false,
			error: expect.stringContaining("safe name or path"),
		});
	});
});
