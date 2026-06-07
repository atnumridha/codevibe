import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	runCursorMcpImportCommand,
	runCursorMcpInstallCommand,
	runCursorUriCommand,
} from "./cursor-mcp";

function encodeConfig(config: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(config), "utf8")
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

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

	async function useBackgroundAgentRecordsPath(): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), "cline-bg-agent-records-"));
		tempDirs.push(dir);
		return join(dir, "background-agent-records.json");
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

	it("previews native Cursor MCP extension install aliases", async () => {
		await useTempSettingsPath();
		const { out, err, io } = createIo();

		const code = await runCursorUriCommand({
			uri: "cursor://anysphere.cursor-mcp/install?name=docs&url=https%3A%2F%2Fmcp.example.com",
			json: true,
			io,
		});

		expect(code).toBe(0);
		expect(err).toEqual([]);
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "mcp-install",
			installed: false,
			requiresConfirmation: true,
			serverName: "docs",
		});
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

	it("previews workspace .cursor/mcp.json imports without writing settings", async () => {
		const settingsPath = await useTempSettingsPath();
		const workspaceRoot = await mkdtemp(join(tmpdir(), "cline-cursor-mcp-ws-"));
		tempDirs.push(workspaceRoot);
		await mkdir(join(workspaceRoot, ".cursor"), { recursive: true });
		await writeFile(
			join(workspaceRoot, ".cursor", "mcp.json"),
			JSON.stringify({
				mcpServers: {
					docs: {
						type: "http",
						url: "https://mcp.example.com/context",
					},
				},
			}),
			"utf8",
		);
		const { out, io } = createIo();

		const code = runCursorMcpImportCommand({
			uri: "cursor://mcp/import",
			cwd: workspaceRoot,
			json: true,
			io,
		});

		expect(code).toBe(0);
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "cursor-mcp-import",
			confirmed: false,
			imported: false,
			requiresConfirmation: true,
			sourcePath: join(workspaceRoot, ".cursor", "mcp.json"),
			settingsPath,
			serverNames: ["docs"],
			importedCount: 0,
			replacedNames: [],
		});
		await expect(readFile(settingsPath, "utf8")).rejects.toThrow();
	});

	it("imports workspace .cursor/mcp.json with Cursor variables and replacement metadata", async () => {
		const settingsPath = await useTempSettingsPath();
		await writeFile(
			settingsPath,
			JSON.stringify({
				mcpServers: {
					beta: {
						transport: {
							type: "stdio",
							command: "old-beta",
						},
					},
				},
			}),
			"utf8",
		);
		const workspaceRoot = await mkdtemp(join(tmpdir(), "cline-cursor-mcp-ws-"));
		tempDirs.push(workspaceRoot);
		await mkdir(join(workspaceRoot, ".cursor"), { recursive: true });
		await writeFile(
			join(workspaceRoot, ".cursor", "mcp.json"),
			JSON.stringify({
				mcpServers: {
					alpha: {
						command: "node",
						args: ["${workspaceFolder}/server.js"],
						env: {
							ROOT_NAME: "${workspaceFolderBasename}",
						},
					},
					beta: {
						type: "http",
						url: "https://mcp.example.com/api",
						headers: {
							Authorization: "Bearer secret-value",
						},
						metadata: {
							team: "platform",
						},
					},
				},
			}),
			"utf8",
		);
		const { out, io } = createIo();

		const code = runCursorMcpImportCommand({
			uri: "cursor://mcp/import",
			cwd: workspaceRoot,
			confirmed: true,
			json: true,
			io,
		});

		expect(code).toBe(0);
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "cursor-mcp-import",
			confirmed: true,
			imported: true,
			serverNames: ["alpha", "beta"],
			importedCount: 2,
			replacedNames: ["beta"],
		});
		expect(out[0]).not.toContain("secret-value");
		const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as {
			mcpServers?: Record<string, Record<string, unknown>>;
		};
		expect(parsed.mcpServers?.alpha).toMatchObject({
			transport: {
				type: "stdio",
				command: "node",
				args: [join(workspaceRoot, "server.js")],
				env: {
					ROOT_NAME: basename(workspaceRoot),
				},
			},
			metadata: {
				cursor: {
					source: "workspace-mcp",
					path: ".cursor/mcp.json",
				},
			},
		});
		expect(parsed.mcpServers?.beta).toMatchObject({
			transport: {
				type: "streamableHttp",
				url: "https://mcp.example.com/api",
				headers: {
					Authorization: "Bearer secret-value",
				},
			},
			metadata: {
				team: "platform",
				cursor: {
					source: "workspace-mcp",
					path: ".cursor/mcp.json",
				},
			},
		});
		expect(
			(parsed.mcpServers?.alpha?.metadata as { cursor?: { importedAt?: string } })
				.cursor?.importedAt,
		).toEqual(expect.any(String));
	});

	it("imports global ~/.cursor/mcp.json without requiring a workspace Cursor file", async () => {
		const settingsPath = await useTempSettingsPath();
		const cursorHome = await mkdtemp(join(tmpdir(), "cline-cursor-home-"));
		tempDirs.push(cursorHome);
		await mkdir(join(cursorHome, ".cursor"), { recursive: true });
		await writeFile(
			join(cursorHome, ".cursor", "mcp.json"),
			JSON.stringify({
				mcpServers: {
					globalDocs: {
						command: "node",
						args: ["${userHome}/global-server.js"],
						env: {
							TOKEN: "secret-value",
						},
					},
				},
			}),
			"utf8",
		);
		const { out, io } = createIo();

		const code = runCursorMcpImportCommand({
			uri: "cursor://mcp/import",
			cursorMcpSource: "global",
			cursorMcpHome: cursorHome,
			confirmed: true,
			json: true,
			io,
		});

		expect(code).toBe(0);
		expect(out[0]).not.toContain("secret-value");
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "cursor-mcp-import",
			confirmed: true,
			imported: true,
			sourcePath: join(cursorHome, ".cursor", "mcp.json"),
			serverNames: ["globalDocs"],
			importedCount: 1,
			replacedNames: [],
		});
		const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as {
			mcpServers?: Record<string, Record<string, unknown>>;
		};
		expect(parsed.mcpServers?.globalDocs).toMatchObject({
			transport: {
				type: "stdio",
				command: "node",
				args: [join(cursorHome, "global-server.js")],
				env: {
					TOKEN: "secret-value",
				},
			},
			metadata: {
				cursor: {
					source: "global-cursor-mcp",
					path: "~/.cursor/mcp.json",
				},
			},
		});
	});

	it("dispatches native CodeVibe route-host deeplinks through the CLI", async () => {
		const settingsPath = await useTempSettingsPath();
		const install = createIo();

		await expect(
			runCursorUriCommand({
				uri: "codevibe://mcp/install?name=codevibe-docs&url=https%3A%2F%2Fmcp.example.com",
				confirmed: true,
				io: install.io,
			}),
		).resolves.toBe(0);

		await expect(readFile(settingsPath, "utf8")).resolves.toContain(
			"codevibe-docs",
		);

		const settings = createIo();
		await expect(
			runCursorUriCommand({
				uri: "codevibe://settings?query=%40id%3Acline.apiProvider",
				json: true,
				io: settings.io,
			}),
		).resolves.toBe(0);
		expect(JSON.parse(settings.out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "settings",
			query: "@id:cline.apiProvider",
		});

		const workspaceRoot = await mkdtemp(join(tmpdir(), "cline-codevibe-uri-"));
		tempDirs.push(workspaceRoot);
		const rule = createIo();
		await expect(
			runCursorUriCommand({
				uri: "codevibe://rule?name=team-style",
				cwd: workspaceRoot,
				json: true,
				io: rule.io,
			}),
		).resolves.toBe(0);
		expect(JSON.parse(rule.out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "rule",
			requiresConfirmation: true,
			filename: "team-style.mdc",
		});

		const agentTask = createIo();
		await expect(
			runCursorUriCommand({
				uri: "codevibe://createchat?prompt=review%20the%20new%20diff",
				json: true,
				io: agentTask.io,
			}),
		).resolves.toBe(0);
		expect(JSON.parse(agentTask.out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "createchat",
			path: "/createchat",
			requiresAgent: true,
			prompt: "review the new diff",
			taskPrompt: "review the new diff",
		});
	});

	it("previews Cursor background-agent deeplinks without starting hub sessions", async () => {
		const { out, io } = createIo();
		const ensureBackgroundAgentHub = vi.fn(async () => ({
			url: "ws://127.0.0.1:25463",
			authToken: "hub-token",
		}));

		const code = await runCursorUriCommand({
			uri: "vscode://cline.cline/background-agent?prompt=fix%20the%20bug&repo=owner%2Frepo",
			json: true,
			ensureBackgroundAgentHub,
			io,
		});

		expect(code).toBe(0);
		expect(ensureBackgroundAgentHub).not.toHaveBeenCalled();
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "background-agent",
			path: "/background-agent",
			requiresAgent: true,
			prompt: "fix the bug",
			taskPrompt: expect.stringContaining("fix the bug"),
			backgroundAgent: {
				launchMode: "hub-session-queued",
				agentMode: "plan",
				confirmationRequired: true,
				autoApprovalProfile: "read-only-plan-confirmation-required",
				worktreePolicy: "confirm-before-create",
				repository: "owner/repo",
				toolPolicy: {
					default: "disabled",
					enabled: ["read_files", "search_codebase"],
					autoApproved: ["read_files", "search_codebase"],
				},
			},
		});
	});

	it("previews background-agent worktree requests without creating worktrees", async () => {
		const { out, io } = createIo();
		const createBackgroundAgentWorktree = vi.fn(async () => ({
			success: true,
			message: "created",
			path: "/tmp/unused-worktree",
		}));

		const code = await runCursorUriCommand({
			uri: "vscode://cline.cline/background-agent?prompt=fix%20the%20bug",
			json: true,
			worktree: true,
			createBackgroundAgentWorktree,
			io,
		});

		expect(code).toBe(0);
		expect(createBackgroundAgentWorktree).not.toHaveBeenCalled();
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "background-agent",
			worktree: {
				requested: true,
				created: false,
			},
		});
	});

	it("starts confirmed Cursor background-agent deeplinks as safe hub sessions", async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), "cline-bg-agent-"));
		tempDirs.push(workspaceRoot);
		const recordsPath = await useBackgroundAgentRecordsPath();
		const { out, io } = createIo();
		const ensureBackgroundAgentHub = vi.fn(async () => ({
			url: "ws://127.0.0.1:25463",
			authToken: "hub-token",
		}));
		const sessionClient = {
			connect: vi.fn(async () => {}),
			startRuntimeSession: vi.fn(async () => ({ sessionId: "session-bg" })),
			sendRuntimeSession: vi.fn(async () => ({})),
			dispose: vi.fn(async () => {}),
		};
		const createBackgroundAgentSessionClient = vi.fn(() => sessionClient);

		const code = await runCursorUriCommand({
			uri: "vscode://cline.cline/background-agent?prompt=fix%20the%20bug&repo=owner%2Frepo&branch=feature%2Fsafe",
			cwd: workspaceRoot,
			confirmed: true,
			json: true,
			providerId: "openai-codex",
			modelId: "gpt-5.5",
			apiKey: "api-key",
			ensureBackgroundAgentHub,
			createBackgroundAgentSessionClient,
			backgroundAgentRecordsPath: recordsPath,
			io,
		});

		expect(code).toBe(0);
		expect(ensureBackgroundAgentHub).toHaveBeenCalledWith(workspaceRoot);
		expect(createBackgroundAgentSessionClient).toHaveBeenCalledWith({
			address: "ws://127.0.0.1:25463",
			authToken: "hub-token",
			workspaceRoot,
			cwd: workspaceRoot,
		});
		expect(sessionClient.startRuntimeSession).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceRoot,
				cwd: workspaceRoot,
				provider: "openai-codex",
				model: "gpt-5.5",
				apiKey: "api-key",
				mode: "plan",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				autoApproveTools: false,
				source: "cline-cli-cursor-background-agent",
				interactive: false,
				toolPolicies: {
					"*": { enabled: false, autoApprove: false },
					read_files: { enabled: true, autoApprove: true },
					search_codebase: { enabled: true, autoApprove: true },
				},
			}),
		);
		expect(sessionClient.sendRuntimeSession).toHaveBeenCalledWith(
			"session-bg",
			expect.objectContaining({
				prompt: expect.stringContaining(
					"Cursor-compatible background-agent launch prepared.",
				),
				delivery: "queue",
				config: expect.objectContaining({ mode: "plan" }),
			}),
			{ timeoutMs: 5000 },
		);
		const sentPrompt = sessionClient.sendRuntimeSession.mock.calls[0]?.[1]
			?.prompt as string;
		expect(sentPrompt).toContain("fix the bug");
		expect(sentPrompt).toContain("fallback reason: Worktrees are disabled");
		expect(sessionClient.dispose).toHaveBeenCalled();
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "background-agent",
			started: true,
			sessionId: "session-bg",
			workspaceRoot,
			cwd: workspaceRoot,
			provider: "openai-codex",
			model: "gpt-5.5",
			delivery: "queue",
			paramKeys: ["branch", "prompt", "repo"],
			backgroundAgent: {
				status: "running",
				launchMode: "controller-record",
				agentMode: "plan",
				confirmationRequired: true,
				autoApprovalProfile: "read-only-plan-confirmation-required",
				worktreePolicy: "confirm-before-create",
				repository: "owner/repo",
				requestedBranch: "feature/safe",
				fallbackReason: "Worktrees are disabled",
				taskId: "session-bg",
			},
		});
		const records = JSON.parse(await readFile(recordsPath, "utf8"));
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			status: "running",
			taskId: "session-bg",
			fallbackReason: "Worktrees are disabled",
		});
	});

	it("creates a worktree before confirmed Cursor background-agent sessions when requested", async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), "cline-bg-agent-src-"));
		const worktreeRoot = await mkdtemp(join(tmpdir(), "cline-bg-agent-worktree-"));
		tempDirs.push(workspaceRoot, worktreeRoot);
		const recordsPath = await useBackgroundAgentRecordsPath();
		const { out, io } = createIo();
		const ensureBackgroundAgentHub = vi.fn(async () => ({
			url: "ws://127.0.0.1:25463",
			authToken: "hub-token",
		}));
		const createBackgroundAgentWorktree = vi.fn(async () => ({
			success: true,
			message: `Worktree created at ${worktreeRoot}`,
			path: worktreeRoot,
			taskId: "abc12",
			repoRoot: workspaceRoot,
		}));
		const sessionClient = {
			connect: vi.fn(async () => {}),
			startRuntimeSession: vi.fn(async () => ({ sessionId: "session-bg-worktree" })),
			sendRuntimeSession: vi.fn(async () => ({})),
			dispose: vi.fn(async () => {}),
		};
		const createBackgroundAgentSessionClient = vi.fn(() => sessionClient);

		const code = await runCursorUriCommand({
			uri: "vscode://cline.cline/background-agent?prompt=fix%20the%20bug&branch=feature%2Fsafe",
			cwd: workspaceRoot,
			confirmed: true,
			json: true,
			worktree: true,
			ensureBackgroundAgentHub,
			createBackgroundAgentWorktree,
			createBackgroundAgentSessionClient,
			backgroundAgentRecordsPath: recordsPath,
			io,
		});

		expect(code).toBe(0);
		expect(createBackgroundAgentWorktree).toHaveBeenCalledWith({ cwd: workspaceRoot });
		expect(ensureBackgroundAgentHub).toHaveBeenCalledWith(worktreeRoot);
		expect(createBackgroundAgentSessionClient).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceRoot: worktreeRoot,
				cwd: worktreeRoot,
			}),
		);
		expect(sessionClient.startRuntimeSession).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceRoot: worktreeRoot,
				cwd: worktreeRoot,
				source: "cline-cli-cursor-background-agent",
			}),
		);
		expect(sessionClient.sendRuntimeSession).toHaveBeenCalledWith(
			"session-bg-worktree",
			expect.objectContaining({
				prompt: expect.stringContaining("Prepared isolated worktree"),
			}),
			{ timeoutMs: 5000 },
		);
		const payload = JSON.parse(out[0] ?? "{}");
		expect(payload).toMatchObject({
			handled: true,
			route: "background-agent",
			started: true,
			sessionId: "session-bg-worktree",
			workspaceRoot: worktreeRoot,
			cwd: worktreeRoot,
			backgroundAgent: {
				status: "running",
				launchMode: "worktree",
				worktreePath: worktreeRoot,
				worktreeBaseRef: "feature/safe",
				taskId: "session-bg-worktree",
			},
			worktree: {
				created: true,
				sourceWorkspaceRoot: workspaceRoot,
				path: worktreeRoot,
				baseRef: "feature/safe",
			},
		});
		const records = JSON.parse(await readFile(recordsPath, "utf8"));
		expect(records[0]).toMatchObject({
			status: "running",
			launchMode: "worktree",
			worktreePath: worktreeRoot,
			worktreeBaseRef: "feature/safe",
			taskId: "session-bg-worktree",
		});
	});

	it("falls back to a controller-record launch when requested worktree creation fails", async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), "cline-bg-agent-src-"));
		tempDirs.push(workspaceRoot);
		const recordsPath = await useBackgroundAgentRecordsPath();
		const { out, io } = createIo();
		const ensureBackgroundAgentHub = vi.fn(async () => ({
			url: "ws://127.0.0.1:25463",
			authToken: "hub-token",
		}));
		const createBackgroundAgentWorktree = vi.fn(async () => ({
			success: false,
			message: "Not a git repository",
		}));
		const sessionClient = {
			connect: vi.fn(async () => {}),
			startRuntimeSession: vi.fn(async () => ({ sessionId: "session-bg-fallback" })),
			sendRuntimeSession: vi.fn(async () => ({})),
			dispose: vi.fn(async () => {}),
		};
		const createBackgroundAgentSessionClient = vi.fn(() => sessionClient);

		const code = await runCursorUriCommand({
			uri: "vscode://cline.cline/background-agent?prompt=fix%20the%20bug",
			cwd: workspaceRoot,
			confirmed: true,
			json: true,
			worktree: true,
			ensureBackgroundAgentHub,
			createBackgroundAgentWorktree,
			createBackgroundAgentSessionClient,
			backgroundAgentRecordsPath: recordsPath,
			io,
		});

		expect(code).toBe(0);
		expect(ensureBackgroundAgentHub).toHaveBeenCalledWith(workspaceRoot);
		expect(createBackgroundAgentSessionClient).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceRoot,
				cwd: workspaceRoot,
			}),
		);
		const sentPrompt = sessionClient.sendRuntimeSession.mock.calls[0]?.[1]
			?.prompt as string;
		expect(sentPrompt).toContain("fallback reason: Not a git repository");
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "background-agent",
			started: true,
			sessionId: "session-bg-fallback",
			backgroundAgent: {
				status: "running",
				launchMode: "controller-record",
				fallbackReason: "Not a git repository",
				taskId: "session-bg-fallback",
			},
		});
		const records = JSON.parse(await readFile(recordsPath, "utf8"));
		expect(records[0]).toMatchObject({
			status: "running",
			launchMode: "controller-record",
			fallbackReason: "Not a git repository",
			taskId: "session-bg-fallback",
		});
	});

	it("starts confirmed Cursor agent-task deeplinks as queued plan sessions", async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), "cline-agent-task-"));
		tempDirs.push(workspaceRoot);
		const { out, io } = createIo();
		const ensureBackgroundAgentHub = vi.fn(async () => ({
			url: "ws://127.0.0.1:25463",
			authToken: "hub-token",
		}));
		const sessionClient = {
			connect: vi.fn(async () => {}),
			startRuntimeSession: vi.fn(async () => ({ sessionId: "session-task" })),
			sendRuntimeSession: vi.fn(async () => ({})),
			dispose: vi.fn(async () => {}),
		};
		const createBackgroundAgentSessionClient = vi.fn(() => sessionClient);

		const code = await runCursorUriCommand({
			uri: "vscode://cline.cline/createchat?prompt=review%20the%20new%20diff",
			cwd: workspaceRoot,
			confirmed: true,
			json: true,
			providerId: "openai-codex",
			modelId: "gpt-5.5",
			ensureBackgroundAgentHub,
			createBackgroundAgentSessionClient,
			io,
		});

		expect(code).toBe(0);
		expect(ensureBackgroundAgentHub).toHaveBeenCalledWith(workspaceRoot);
		const startRequest = sessionClient.startRuntimeSession.mock.calls[0]?.[0];
		expect(startRequest).toMatchObject({
			workspaceRoot,
			cwd: workspaceRoot,
			provider: "openai-codex",
			model: "gpt-5.5",
			mode: "plan",
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
			autoApproveTools: false,
			source: "cline-cli-cursor-agent-task",
			interactive: false,
			toolPolicies: {
				"*": { enabled: false, autoApprove: false },
				read_files: { enabled: true, autoApprove: true },
				search_codebase: { enabled: true, autoApprove: true },
			},
		});
		expect(sessionClient.sendRuntimeSession).toHaveBeenCalledWith(
			"session-task",
			expect.objectContaining({
				prompt: "review the new diff",
				delivery: "queue",
				config: expect.objectContaining({ mode: "plan" }),
			}),
			{ timeoutMs: 5000 },
		);
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "createchat",
			path: "/createchat",
			started: true,
			sessionId: "session-task",
			provider: "openai-codex",
			model: "gpt-5.5",
			delivery: "queue",
			paramKeys: ["prompt"],
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

	it("previews plugin add deeplinks without starting an agent task", async () => {
		const { out, io } = createIo();

		const code = await runCursorUriCommand({
			uri: `vscode://cline.cline/plugin/add?id=docs-helper&config=${encodeConfig({ token: "secret-value" })}`,
			json: true,
			io,
		});

		expect(code).toBe(0);
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "plugin-add",
			installed: false,
			requiresConfirmation: true,
			source: "docs-helper",
			sourceParam: "id",
			detail: expect.stringContaining("Config keys: token"),
		});
		expect(out[0]).not.toContain("secret-value");
		expect(out[0]).not.toContain("requiresAgent");
	});

	it("previews config-source plugin add deeplinks as installable after confirmation", async () => {
		const { out, io } = createIo();

		const code = await runCursorUriCommand({
			uri: `vscode://cline.cline/plugin/add?config=${encodeConfig({
				source: "docs-helper",
				token: "secret-value",
			})}`,
			json: true,
			io,
		});

		expect(code).toBe(0);
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "plugin-add",
			installed: false,
			requiresConfirmation: true,
			source: "docs-helper",
			sourceParam: "config",
			sourceConfigKey: "source",
			detail: expect.stringContaining("Source parameter: config.source"),
		});
		expect(out[0]).not.toContain("secret-value");
		expect(out[0]).not.toContain("requiresAgent");
	});

	it("installs confirmed config-source local Cursor plugin deeplinks", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "cline-cursor-plugin-"));
		tempDirs.push(workspace);
		await writeFile(
			join(workspace, "docs-plugin.js"),
			[
				"export default {",
				"  name: 'docs-plugin',",
				"  manifest: { capabilities: [] },",
				"  activate() {}",
				"};",
				"",
			].join("\n"),
		);
		const { out, io } = createIo();

		const code = await runCursorUriCommand({
			uri: `vscode://cline.cline/plugin/add?config=${encodeConfig({
				source: "./docs-plugin.js",
				token: "secret-value",
			})}`,
			cwd: workspace,
			confirmed: true,
			json: true,
			io,
		});
		const payload = JSON.parse(out[0] ?? "{}") as {
			entryPaths?: string[];
			installPath?: string;
		};

		expect(code).toBe(0);
		expect(payload).toMatchObject({
			handled: true,
			route: "plugin-add",
			installed: true,
			source: "./docs-plugin.js",
			sourceParam: "config",
			sourceConfigKey: "source",
		});
		expect(payload.installPath).toContain(join(workspace, ".cline", "plugins"));
		expect(payload.entryPaths?.[0]).toContain("docs-plugin.js");
		await expect(readFile(payload.entryPaths?.[0] ?? "", "utf8")).resolves.toContain(
			"docs-plugin",
		);
		expect(out[0]).not.toContain("secret-value");
	});

	it("previews Cursor automation ingest URI events without storing payload values", async () => {
		const { out, io } = createIo();
		const ndjson = encodeURIComponent(
			JSON.stringify({
				eventId: "evt-1",
				eventType: "git.commit.created",
				source: "cursor",
				occurredAt: "2026-06-06T00:00:00.000Z",
				payload: { token: "secret-value", branch: "main" },
			}),
		);

		const code = await runCursorUriCommand({
			uri: `vscode://cline.cline/automation/ingest?ndjson=${ndjson}&strict=true`,
			json: true,
			io,
		});

		expect(code).toBe(0);
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "automation-ingest",
			ingested: false,
			requiresConfirmation: true,
			strict: true,
			valid: true,
			eventCount: 1,
			rejectedCount: 0,
			events: [
				expect.objectContaining({
					eventId: "evt-1",
					eventType: "git.commit.created",
					source: "cursor",
					payloadKeys: ["branch", "token"],
				}),
			],
		});
		expect(out[0]).not.toContain("secret-value");
	});

	it("blocks confirmed Cursor automation ingest when strict validation rejects a line", async () => {
		const { out, io } = createIo();
		const ndjson = encodeURIComponent(
			[
				JSON.stringify({
					eventId: "evt-1",
					eventType: "git.commit.created",
					source: "cursor",
				}),
				"{ bad json",
			].join("\n"),
		);
		const createAutomationIngestCore = vi.fn();

		const code = await runCursorUriCommand({
			uri: `vscode://cline.cline/automation/ingest?ndjson=${ndjson}&strict=true`,
			confirmed: true,
			json: true,
			createAutomationIngestCore,
			io,
		});

		expect(code).toBe(1);
		expect(createAutomationIngestCore).not.toHaveBeenCalled();
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "automation-ingest",
			ingested: false,
			strict: true,
			strictFailed: true,
			valid: false,
			eventCount: 1,
			rejectedCount: 1,
		});
	});

	it("ingests confirmed Cursor automation URI events through ClineCore automation", async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), "cline-cursor-automation-"));
		tempDirs.push(workspaceRoot);
		const { out, io } = createIo();
		const event = {
			eventId: "evt-1",
			eventType: "git.commit.created",
			source: "cursor",
			occurredAt: "2026-06-06T00:00:00.000Z",
			payload: { branch: "main" },
		};
		const ingestNdjson = vi.fn(() => ({
			events: [event],
			rejected: [],
			results: [
				{
					event: { eventId: "evt-1" },
					duplicate: false,
					matchedSpecIds: ["spec-1"],
					queuedRuns: [{ runId: "run-1" }],
					suppressions: [],
				},
			],
		}));
		const dispose = vi.fn(async () => {});
		const createAutomationIngestCore = vi.fn(async () => ({
			automation: { ingestNdjson },
			dispose,
		}));

		const code = await runCursorUriCommand({
			uri: `vscode://cline.cline/automation/ingest?config=${encodeConfig({
				ndjson: JSON.stringify(event),
				defaultSource: "cursor",
			})}`,
			cwd: workspaceRoot,
			confirmed: true,
			json: true,
			createAutomationIngestCore,
			io,
		});

		expect(code).toBe(0);
		expect(createAutomationIngestCore).toHaveBeenCalledWith({
			workspaceRoot,
			cwd: workspaceRoot,
		});
		expect(ingestNdjson).toHaveBeenCalledWith(JSON.stringify(event), {
			defaultSource: "cursor",
		});
		expect(dispose).toHaveBeenCalledWith("cursor_automation_ingest_done");
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "automation-ingest",
			ingested: true,
			valid: true,
			eventCount: 1,
			rejectedCount: 0,
			resultCount: 1,
			duplicateCount: 0,
			queuedRunCount: 1,
			defaultSource: "cursor",
			configKeys: ["defaultSource", "ndjson"],
		});
	});

	it("installs plugin add deeplinks only when confirmed", async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), "cline-cursor-plugin-"));
		tempDirs.push(workspaceRoot);
		const pluginPath = join(workspaceRoot, "cursor-plugin.ts");
		await writeFile(
			pluginPath,
			"export default { name: 'cursor-plugin', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);
		const { out, io } = createIo();

		const code = await runCursorUriCommand({
			uri: `vscode://cline.cline/plugin/add?name=${encodeURIComponent(pluginPath)}`,
			cwd: workspaceRoot,
			confirmed: true,
			json: true,
			io,
		});

		expect(code).toBe(0);
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "plugin-add",
			installed: true,
			source: pluginPath,
			installPath: expect.stringContaining(join(".cline", "plugins")),
			entryPaths: [expect.stringContaining("cursor-plugin")],
		});
	});

	it("previews Cursor command files for standalone agent task routes", async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), "cline-cursor-command-"));
		tempDirs.push(workspaceRoot);
		const commandsDir = join(workspaceRoot, ".cursor", "commands");
		await mkdir(commandsDir, { recursive: true });
		await writeFile(
			join(commandsDir, "review-code.md"),
			"Review the staged diff and call out risky changes.",
			"utf8",
		);
		const { out, io } = createIo();

		const code = await runCursorUriCommand({
			uri: "vscode://cline.cline/command?name=review-code",
			cwd: workspaceRoot,
			json: true,
			io,
		});

		expect(code).toBe(0);
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "command-file",
			path: "/command",
			requiresAgent: true,
			commandFile: {
				commandName: "review-code",
				filename: "review-code.md",
				relativePath: ".cursor/commands/review-code.md",
			},
			taskPrompt: expect.stringContaining(
				"Review the staged diff and call out risky changes.",
			),
		});
		expect(out[0]).not.toContain(workspaceRoot);
	});

	it("starts confirmed Cursor command files without leaking absolute paths", async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), "cline-cursor-command-"));
		tempDirs.push(workspaceRoot);
		const commandsDir = join(workspaceRoot, ".cursor", "commands");
		await mkdir(commandsDir, { recursive: true });
		await writeFile(
			join(commandsDir, "review-code.md"),
			"Review the staged diff and call out risky changes.",
			"utf8",
		);
		const { out, io } = createIo();
		const ensureBackgroundAgentHub = vi.fn(async () => ({
			url: "ws://127.0.0.1:25463",
			authToken: "hub-token",
		}));
		const sessionClient = {
			connect: vi.fn(async () => {}),
			startRuntimeSession: vi.fn(async () => ({ sessionId: "session-command" })),
			sendRuntimeSession: vi.fn(async () => ({})),
			dispose: vi.fn(async () => {}),
		};

		const code = await runCursorUriCommand({
			uri: "vscode://cline.cline/command?name=review-code",
			cwd: workspaceRoot,
			confirmed: true,
			json: true,
			ensureBackgroundAgentHub,
			createBackgroundAgentSessionClient: vi.fn(() => sessionClient),
			io,
		});

		expect(code).toBe(0);
		expect(sessionClient.sendRuntimeSession).toHaveBeenCalledWith(
			"session-command",
			expect.objectContaining({
				prompt: expect.stringContaining(
					"Review the staged diff and call out risky changes.",
				),
				delivery: "queue",
			}),
			{ timeoutMs: 5000 },
		);
		const sentTurn = sessionClient.sendRuntimeSession.mock.calls[0]?.[1] as
			| { prompt?: string }
			| undefined;
		expect(sentTurn?.prompt).not.toContain(workspaceRoot);
		expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
			handled: true,
			route: "command-file",
			path: "/command",
			started: true,
			sessionId: "session-command",
			commandFile: {
				commandName: "review-code",
				filename: "review-code.md",
				relativePath: ".cursor/commands/review-code.md",
			},
		});
		expect(out[0]).not.toContain(workspaceRoot);
	});

	it("previews PR review and glass deeplinks", async () => {
		for (const [uri, route] of [
			["vscode://cline.cline/pr-review?repo=owner%2Frepo&number=42", "pr-review"],
			["vscode://cline.cline/glass?text=Continue%20here", "glass"],
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
			if (route === "glass") {
				expect(JSON.parse(out[0] ?? "{}")).toMatchObject({
					glass: {
						glass: true,
						mode: "overlay",
						hasPrompt: true,
						paramKeys: ["text"],
					},
				});
			}
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
