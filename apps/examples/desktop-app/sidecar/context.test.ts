import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeCapabilities } from "@cline/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SidecarContext } from "./types";

const createCoreMock = vi.hoisted(() => vi.fn());
const connectMock = vi.hoisted(() => vi.fn());
const subscribeMock = vi.hoisted(() => vi.fn());
const previewCursorUriMock = vi.hoisted(() => vi.fn());

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		ClineCore: {
			create: createCoreMock,
		},
		NodeHubClient: class {
			connect = connectMock;
			subscribe = subscribeMock;
			previewCursorUri = previewCursorUriMock;
			dispose = vi.fn();
		},
	};
});

function readEvents(ctx: SidecarContext): Array<{
	event: { name: string; payload: Record<string, unknown> };
}> {
	const [client] = ctx.wsClients;
	const send = client?.send;
	if (!send || typeof send !== "function" || !("mock" in send)) {
		return [];
	}
	return (send as ReturnType<typeof vi.fn>).mock.calls.map(([raw]) =>
		JSON.parse(String(raw)),
	);
}

function encodeCursorConfig(config: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(config), "utf8")
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function jwt(payload: Record<string, unknown>): string {
	const encode = (value: Record<string, unknown>) =>
		Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
	return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.`;
}

function runGit(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

async function createGitWorkspace(tempDirs: string[]): Promise<string> {
	const workspace = await mkdtemp(join(tmpdir(), "codevibe-git-action-"));
	tempDirs.push(workspace);
	runGit(workspace, ["init"]);
	runGit(workspace, ["checkout", "-B", "master"]);
	runGit(workspace, ["config", "user.email", "codevibe@example.invalid"]);
	runGit(workspace, ["config", "user.name", "CodeVibe Tests"]);
	await writeFile(join(workspace, "README.md"), "hello\n");
	runGit(workspace, ["add", "README.md"]);
	runGit(workspace, ["commit", "-m", "initial"]);
	return workspace;
}

describe("Code sidecar runtime capabilities", () => {
	const tempDirs: string[] = [];
	let previousMcpSettingsPath: string | undefined;
	let previousProviderSettingsPath: string | undefined;
	let previousCodexHome: string | undefined;

	beforeEach(() => {
		previousMcpSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
		previousProviderSettingsPath = process.env.CLINE_PROVIDER_SETTINGS_PATH;
		previousCodexHome = process.env.CODEX_HOME;
		delete process.env.CLINE_MCP_SETTINGS_PATH;
		createCoreMock.mockReset();
		connectMock.mockReset();
		subscribeMock.mockReset();
		previewCursorUriMock.mockReset();
		connectMock.mockResolvedValue(undefined);
		subscribeMock.mockReturnValue(() => {});
		previewCursorUriMock.mockResolvedValue({ handled: true, route: "settings" });
		createCoreMock.mockResolvedValue({
			runtimeAddress: "ws://127.0.0.1:25463/hub",
			subscribe: vi.fn(() => () => {}),
			dispose: vi.fn(),
		});
	});

	afterEach(async () => {
		if (previousMcpSettingsPath === undefined) {
			delete process.env.CLINE_MCP_SETTINGS_PATH;
		} else {
			process.env.CLINE_MCP_SETTINGS_PATH = previousMcpSettingsPath;
		}
		if (previousProviderSettingsPath === undefined) {
			delete process.env.CLINE_PROVIDER_SETTINGS_PATH;
		} else {
			process.env.CLINE_PROVIDER_SETTINGS_PATH = previousProviderSettingsPath;
		}
		if (previousCodexHome === undefined) {
			delete process.env.CODEX_HOME;
		} else {
			process.env.CODEX_HOME = previousCodexHome;
		}
		await Promise.all(
			tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
		);
		tempDirs.length = 0;
	});

	it("registers CodeVibe desktop capability factory with core", async () => {
		const { createSidecarContext, initializeSessionManager } = await import(
			"./context"
		);

		const ctx = createSidecarContext("/workspace/project");
		await initializeSessionManager(ctx);

		expect(createCoreMock).toHaveBeenCalledWith(
			expect.objectContaining({
				backendMode: "hub",
				capabilities: expect.objectContaining({
					toolExecutors: expect.objectContaining({
						askQuestion: expect.any(Function),
					}),
					requestToolApproval: expect.any(Function),
				}),
				hub: expect.objectContaining({
					clientType: "code-sidecar",
					displayName: "CodeVibe desktop sidecar",
				}),
			}),
		);
	});

	it("resolves askQuestion through the websocket request/response protocol", async () => {
		const { createSidecarContext, initializeSessionManager } = await import(
			"./context"
		);
		const { handleCommand } = await import("./commands");

		const ctx = createSidecarContext("/workspace/project");
		ctx.wsClients.add({ send: vi.fn() });

		await initializeSessionManager(ctx);

		const capabilities = createCoreMock.mock.calls[0][0]
			.capabilities as RuntimeCapabilities;
		const answer = capabilities.toolExecutors?.askQuestion?.(
			"Which branch?",
			["Keep current", "Create new"],
			{
				agentId: "agent-1",
				conversationId: "conversation-1",
				iteration: 3,
			},
		);

		expect(answer).toBeInstanceOf(Promise);
		const event = readEvents(ctx).find(
			(item) => item.event.name === "ask_question_requested",
		);
		expect(event?.event.payload).toMatchObject({
			question: "Which branch?",
			options: ["Keep current", "Create new"],
			context: {
				agentId: "agent-1",
				conversationId: "conversation-1",
				iteration: 3,
			},
		});
		const requestId = String(event?.event.payload.requestId ?? "");
		expect(requestId.length).toBeGreaterThan(0);

		await handleCommand(ctx, "respond_ask_question", {
			requestId,
			answer: "Create new",
		});

		await expect(answer).resolves.toBe("Create new");
		expect(ctx.pendingQuestions.size).toBe(0);
		expect(readEvents(ctx)).toContainEqual(
			expect.objectContaining({
				event: expect.objectContaining({
					name: "ask_question_answered",
					payload: { requestId },
				}),
			}),
		);
	});

	it("resolves approval through websocket state", async () => {
		const { createSidecarContext, initializeSessionManager } = await import(
			"./context"
		);
		const { handleCommand } = await import("./commands");

		const ctx = createSidecarContext("/workspace/project");
		ctx.wsClients.add({ send: vi.fn() });

		await initializeSessionManager(ctx);

		expect(createCoreMock).toHaveBeenCalledWith(
			expect.objectContaining({
				backendMode: "hub",
				capabilities: expect.objectContaining({
					requestToolApproval: expect.any(Function),
				}),
				hub: expect.objectContaining({
					clientType: "code-sidecar",
					displayName: "CodeVibe desktop sidecar",
				}),
			}),
		);

		const capabilities = createCoreMock.mock.calls[0][0]
			.capabilities as RuntimeCapabilities;
		const approval = capabilities.requestToolApproval?.({
			sessionId: "sess-1",
			agentId: "agent-1",
			conversationId: "conversation-1",
			iteration: 2,
			toolCallId: "tool-call-1",
			toolName: "run_commands",
			input: { commands: ["echo hi"] },
			policy: { autoApprove: false },
		});

		expect(approval).toBeInstanceOf(Promise);
		const pending = await handleCommand(ctx, "poll_tool_approvals", {
			sessionId: "sess-1",
		});
		expect(pending).toEqual([
			expect.objectContaining({
				sessionId: "sess-1",
				toolCallId: "tool-call-1",
				toolName: "run_commands",
				input: { commands: ["echo hi"] },
				agentId: "agent-1",
				conversationId: "conversation-1",
			}),
		]);
		expect(readEvents(ctx)).toContainEqual(
			expect.objectContaining({
				event: expect.objectContaining({
					name: "tool_approval_state",
					payload: expect.objectContaining({
						sessionId: "sess-1",
						items: expect.arrayContaining([
							expect.objectContaining({ toolCallId: "tool-call-1" }),
						]),
					}),
				}),
			}),
		);

		const [{ requestId }] = pending as Array<{ requestId: string }>;
		await handleCommand(ctx, "respond_tool_approval", {
			sessionId: "sess-1",
			requestId,
			approved: true,
		});

		await expect(approval).resolves.toEqual({ approved: true });
		expect(
			await handleCommand(ctx, "poll_tool_approvals", { sessionId: "sess-1" }),
		).toEqual([]);
	});

	it("reports Codex home auth status when provider settings are empty", async () => {
		const { handleCommand } = await import("./commands");

		const tempRoot = await mkdtemp(join(tmpdir(), "codevibe-codex-status-"));
		const codexHome = join(tempRoot, ".codex");
		tempDirs.push(tempRoot);
		process.env.CLINE_PROVIDER_SETTINGS_PATH = join(
			tempRoot,
			"providers.json",
		);
		process.env.CODEX_HOME = codexHome;
		await mkdir(codexHome, { recursive: true });
		await writeFile(
			join(codexHome, "auth.json"),
			JSON.stringify({
				tokens: {
					access_token: jwt({
						exp: 2_000_000_000,
						"https://api.openai.com/auth": {
							chatgpt_account_id: "acct_codex_home",
						},
					}),
					refresh_token: "codex-refresh-secret",
					id_token: jwt({ email: "codex@example.invalid" }),
				},
				auth_mode: "chatgpt",
			}),
		);
		await writeFile(join(codexHome, "installation_id"), "install_home\n");
		await writeFile(
			join(codexHome, "models_cache.json"),
			JSON.stringify({ client_version: "0.136.0-test" }),
		);

		const status = await handleCommand(
			{ workspaceRoot: tempRoot } as never,
			"openai_codex_auth_status",
		);

		expect(status).toMatchObject({
			provider: "openai-codex",
			connected: true,
			accessTokenPresent: true,
			refreshTokenPresent: true,
			apiKeyPresent: false,
			tokenSource: "codex-home",
			accountId: "acct_codex_home",
			installationIdPresent: true,
			clientVersion: "0.136.0-test",
			authMode: "chatgpt",
			codexHomePath: codexHome,
			lastUsed: false,
			updatedAt: undefined,
		});
		expect(JSON.stringify(status)).not.toContain("codex-refresh-secret");
	});

	it("previews Cursor deeplinks through the hub client", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const ctx = createSidecarContext("/workspace/project");
		ctx.hubClient = {
			previewCursorUri: previewCursorUriMock,
		} as never;

		const result = await handleCommand(ctx, "cursor_uri_preview", {
			uri: "vscode://cline.cline/settings?panel=codex",
			workspaceRoots: ["/workspace/one", "/workspace/two"],
			maxCommandFileBytes: 4096,
		});

		expect(previewCursorUriMock).toHaveBeenCalledWith({
			uri: "vscode://cline.cline/settings?panel=codex",
			workspaceRoot: "/workspace/project",
			workspaceRoots: ["/workspace/one", "/workspace/two"],
			maxCommandFileBytes: 4096,
		});
		expect(result).toEqual({ handled: true, route: "settings" });
	});

	it("searches workspace files through Cursor privacy ignore rules", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const workspace = await mkdtemp(join(tmpdir(), "codevibe-search-"));
		tempDirs.push(workspace);
		await mkdir(join(workspace, "src"), { recursive: true });
		await mkdir(join(workspace, "private"), { recursive: true });
		await writeFile(join(workspace, ".cursorignore"), "private/\n*.secret\n");
		await writeFile(join(workspace, "src", "secret-guide.md"), "visible\n");
		await writeFile(join(workspace, "src", "token.secret"), "hidden\n");
		await writeFile(join(workspace, "private", "secret.md"), "hidden\n");
		const ctx = createSidecarContext(workspace);

		const result = await handleCommand(ctx, "search_workspace_files", {
			query: "secret",
			limit: 10,
		});

		expect(result).toEqual(["src/secret-guide.md"]);
	});

	it("rejects workspace file search outside the active workspace", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const workspace = await mkdtemp(join(tmpdir(), "codevibe-search-root-"));
		const outside = await mkdtemp(join(tmpdir(), "codevibe-search-outside-"));
		tempDirs.push(workspace, outside);
		await writeFile(join(outside, "secret-guide.md"), "outside\n");
		const ctx = createSidecarContext(workspace);

		await expect(
			handleCommand(ctx, "search_workspace_files", {
				workspaceRoot: outside,
				query: "secret",
			}),
		).rejects.toThrow("inside the active workspace");
	});

	it("previews Cursor MCP installs without mutating settings", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const tempDir = await mkdtemp(join(tmpdir(), "codevibe-mcp-install-"));
		tempDirs.push(tempDir);
		const settingsPath = join(tempDir, "mcp.json");
		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		const ctx = createSidecarContext("/workspace/project");

		const result = await handleCommand(ctx, "cursor_mcp_install", {
			uri: `vscode://cline.cline/mcp/install?${new URLSearchParams({
				name: "docs",
				url: "https://mcp.example.com/context",
			}).toString()}`,
		});
		const stored = JSON.parse(
			await readFile(settingsPath, "utf8"),
		);

		expect(result).toMatchObject({
			handled: true,
			route: "mcp-install",
			confirmed: false,
			installed: false,
			serverName: "docs",
			source: "direct",
			transportType: "streamableHttp",
			urlOrigin: "https://mcp.example.com",
			replaced: false,
		});
		expect(stored).toEqual({ mcpServers: {} });
	});

	it("installs confirmed Cursor MCP configs with sanitized output", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const tempDir = await mkdtemp(join(tmpdir(), "codevibe-mcp-install-"));
		tempDirs.push(tempDir);
		const settingsPath = join(tempDir, "mcp.json");
		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		await writeFile(
			settingsPath,
			`${JSON.stringify({ mcpServers: { docs: { type: "stdio" } } })}\n`,
		);
		const config = encodeCursorConfig({
			mcpServers: {
				docs: {
					transport: {
						type: "streamable-http",
						url: "https://mcp.example.com/context",
						headers: {
							Authorization: "Bearer secret-value",
						},
					},
				},
			},
		});
		const ctx = createSidecarContext("/workspace/project");

		const result = await handleCommand(ctx, "cursor_mcp_install", {
			uri: `vscode://cline.cline/mcp/install?${new URLSearchParams({
				config,
			}).toString()}`,
			confirmed: true,
		});
		const storedText = await readFile(settingsPath, "utf8");
		const stored = JSON.parse(storedText);

		expect(result).toMatchObject({
			handled: true,
			route: "mcp-install",
			confirmed: true,
			installed: true,
			serverName: "docs",
			source: "config",
			transportType: "streamableHttp",
			urlOrigin: "https://mcp.example.com",
			headerKeys: ["Authorization"],
			replaced: true,
		});
		expect(JSON.stringify(result)).not.toContain("secret-value");
		expect(stored.mcpServers.docs).toMatchObject({
			type: "streamableHttp",
			url: "https://mcp.example.com/context",
			headers: {
				Authorization: "Bearer secret-value",
			},
		});
		expect(storedText).toContain("secret-value");
	});

	it("previews workspace Cursor MCP imports without mutating settings", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const tempDir = await mkdtemp(join(tmpdir(), "codevibe-cursor-mcp-"));
		const workspace = await mkdtemp(join(tmpdir(), "codevibe-cursor-mcp-ws-"));
		tempDirs.push(tempDir, workspace);
		const settingsPath = join(tempDir, "mcp.json");
		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		await mkdir(join(workspace, ".cursor"), { recursive: true });
		await writeFile(
			join(workspace, ".cursor", "mcp.json"),
			JSON.stringify({
				mcpServers: {
					docs: { type: "stdio", command: "node", args: ["server.js"] },
				},
			}),
		);
		const ctx = createSidecarContext(workspace);

		const result = await handleCommand(ctx, "import_cursor_mcp_servers");

		expect(result).toMatchObject({
			handled: true,
			route: "cursor-mcp-import",
			confirmed: false,
			imported: false,
			serverNames: ["docs"],
			importedCount: 0,
			settingsPath,
			hasSettingsFile: false,
			servers: [],
		});
		await expect(readFile(settingsPath, "utf8")).rejects.toThrow();
	});

	it("imports workspace Cursor MCP settings with normalized transports", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const tempDir = await mkdtemp(join(tmpdir(), "codevibe-cursor-mcp-"));
		const workspace = await mkdtemp(join(tmpdir(), "codevibe-cursor-mcp-ws-"));
		tempDirs.push(tempDir, workspace);
		const settingsPath = join(tempDir, "mcp.json");
		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		const previousHost = process.env.CURSOR_MCP_HOST;
		const previousToken = process.env.CURSOR_MCP_TOKEN;
		process.env.CURSOR_MCP_HOST = "mcp.example.com";
		process.env.CURSOR_MCP_TOKEN = "secret-token";
		await writeFile(
			settingsPath,
			JSON.stringify({
				mcpServers: {
					existing: { type: "stdio", command: "old-server" },
				},
			}),
		);
		await mkdir(join(workspace, ".cursor"), { recursive: true });
		await writeFile(
			join(workspace, ".cursor", "mcp.json"),
			JSON.stringify({
				mcpServers: {
					docs: {
						transport: {
							type: "http",
							url: "https://${env:CURSOR_MCP_HOST}/context",
							headers: {
								Authorization: "Bearer ${env:CURSOR_MCP_TOKEN}",
							},
						},
					},
				},
			}),
		);
		const ctx = createSidecarContext(workspace);

		try {
			const result = await handleCommand(ctx, "import_cursor_mcp_servers", {
				confirmed: true,
			});
			const stored = JSON.parse(await readFile(settingsPath, "utf8"));

			expect(result).toMatchObject({
				handled: true,
				route: "cursor-mcp-import",
				confirmed: true,
				imported: true,
				importedCount: 1,
				serverNames: ["docs"],
				replacedNames: [],
			});
			expect(stored.mcpServers.existing).toMatchObject({
				type: "stdio",
				command: "old-server",
			});
			expect(stored.mcpServers.docs).toMatchObject({
				type: "streamableHttp",
				url: "https://mcp.example.com/context",
				headers: {
					Authorization: "Bearer secret-token",
				},
				metadata: {
					cursor: {
						source: "workspace-mcp",
						path: ".cursor/mcp.json",
					},
				},
			});
		} finally {
			if (previousHost === undefined) {
				delete process.env.CURSOR_MCP_HOST;
			} else {
				process.env.CURSOR_MCP_HOST = previousHost;
			}
			if (previousToken === undefined) {
				delete process.env.CURSOR_MCP_TOKEN;
			} else {
				process.env.CURSOR_MCP_TOKEN = previousToken;
			}
		}
	});

	it("previews safe Cursor rule files without writing them", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const workspace = await mkdtemp(join(tmpdir(), "codevibe-rule-open-"));
		tempDirs.push(workspace);
		const targetPath = join(workspace, ".cursor", "rules", "team-style.mdc");
		const ctx = createSidecarContext(workspace);

		const result = await handleCommand(ctx, "cursor_rule_open", {
			uri: "vscode://cline.cline/rule?name=team-style",
		});

		expect(result).toMatchObject({
			handled: true,
			route: "rule",
			kind: "file",
			confirmed: false,
			actionable: true,
			created: false,
			opened: false,
			relativePath: ".cursor/rules/team-style.mdc",
			filePath: targetPath,
		});
		await expect(readFile(targetPath, "utf8")).rejects.toThrow();
	});

	it("creates confirmed safe Cursor rule files and exposes them in settings", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const workspace = await mkdtemp(join(tmpdir(), "codevibe-rule-open-"));
		tempDirs.push(workspace);
		const targetPath = join(workspace, ".cursor", "rules", "team-style.mdc");
		const ctx = createSidecarContext(workspace);

		const result = await handleCommand(ctx, "cursor_rule_open", {
			uri: "vscode://cline.cline/rule?name=team-style",
			confirmed: true,
			open: false,
		});
		const content = await readFile(targetPath, "utf8");
		const settings = (await handleCommand(
			ctx,
			"list_user_instruction_configs",
			{},
		)) as { rules: Array<{ name: string; path: string }> };

		expect(result).toMatchObject({
			confirmed: true,
			actionable: true,
			created: true,
			opened: false,
			filename: "team-style.mdc",
			relativePath: ".cursor/rules/team-style.mdc",
			filePath: targetPath,
		});
		expect(content).toContain("# Team Style");
		expect(content).toContain("alwaysApply: false");
		expect(settings.rules).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "team-style",
					path: targetPath,
				}),
			]),
		);
	});

	it("keeps Cursor rule payload routes review-only", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const workspace = await mkdtemp(join(tmpdir(), "codevibe-rule-open-"));
		tempDirs.push(workspace);
		const ctx = createSidecarContext(workspace);

		const result = await handleCommand(ctx, "cursor_rule_open", {
			uri: "vscode://cline.cline/rule?name=team-style&content=Use%20small%20commits",
			confirmed: true,
			open: false,
		});

		expect(result).toMatchObject({
			handled: true,
			route: "rule",
			kind: "review",
			confirmed: true,
			actionable: false,
			created: false,
			opened: false,
			name: "team-style",
		});
		expect(JSON.stringify(result)).not.toContain("Use small commits");
	});

	it("previews explicit Cursor plugin sources without installing them", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const workspace = await mkdtemp(join(tmpdir(), "codevibe-plugin-add-"));
		tempDirs.push(workspace);
		const pluginPath = join(workspace, "docs-plugin.js");
		await writeFile(pluginPath, "export default { name: 'docs-plugin' };\n");
		const ctx = createSidecarContext(workspace);

		const result = await handleCommand(ctx, "cursor_plugin_add", {
			uri: `vscode://cline.cline/plugin/add?${new URLSearchParams({
				name: "./docs-plugin.js",
			}).toString()}`,
		});

		expect(result).toMatchObject({
			handled: true,
			route: "plugin-add",
			confirmed: false,
			installed: false,
			actionable: true,
			requiresReview: false,
			sourceParam: "name",
			sourceLabel: "./docs-plugin.js",
			configKeys: [],
		});
	});

	it("redacts URL query details from Cursor plugin previews", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const workspace = await mkdtemp(join(tmpdir(), "codevibe-plugin-add-"));
		tempDirs.push(workspace);
		const ctx = createSidecarContext(workspace);

		const result = await handleCommand(ctx, "cursor_plugin_add", {
			uri: `vscode://cline.cline/plugin/add?${new URLSearchParams({
				url: "https://example.com/plugin.js?token=secret-value",
			}).toString()}`,
		});

		expect(result).toMatchObject({
			handled: true,
			route: "plugin-add",
			confirmed: false,
			installed: false,
			actionable: true,
			sourceParam: "url",
			sourceLabel: "https://example.com",
		});
		expect(JSON.stringify(result)).not.toContain("secret-value");
		expect(JSON.stringify(result)).not.toContain("plugin.js");
	});

	it("installs confirmed local Cursor plugin sources through the plugin installer", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const workspace = await mkdtemp(join(tmpdir(), "codevibe-plugin-add-"));
		tempDirs.push(workspace);
		const pluginPath = join(workspace, "docs-plugin.js");
		await writeFile(
			pluginPath,
			[
				"export default {",
				"  name: 'docs-plugin',",
				"  manifest: { capabilities: [] },",
				"  activate() {}",
				"};",
				"",
			].join("\n"),
		);
		const ctx = createSidecarContext(workspace);

		const result = (await handleCommand(ctx, "cursor_plugin_add", {
			uri: `vscode://cline.cline/plugin/add?${new URLSearchParams({
				name: "./docs-plugin.js",
			}).toString()}`,
			confirmed: true,
		})) as {
			installed: boolean;
			entryCount: number;
			entryPaths: string[];
			installPath: string;
		};
		const settings = (await handleCommand(
			ctx,
			"list_user_instruction_configs",
			{},
		)) as { plugins: Array<{ name: string; path: string; enabled: boolean }> };

		expect(result).toMatchObject({
			installed: true,
			entryCount: 1,
		});
		expect(result.installPath).toContain(join(workspace, ".cline", "plugins"));
		expect(result.entryPaths[0]).toContain("docs-plugin.js");
		await expect(readFile(result.entryPaths[0], "utf8")).resolves.toContain(
			"docs-plugin",
		);
		expect(settings.plugins).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					enabled: true,
					path: result.entryPaths[0],
				}),
			]),
		);
	});

	it("keeps Cursor plugin config-only payloads review-only", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const workspace = await mkdtemp(join(tmpdir(), "codevibe-plugin-add-"));
		tempDirs.push(workspace);
		const ctx = createSidecarContext(workspace);
		const config = encodeCursorConfig({
			source: "docs-plugin",
			token: "secret-value",
		});

		const result = await handleCommand(ctx, "cursor_plugin_add", {
			uri: `vscode://cline.cline/plugin/add?${new URLSearchParams({
				config,
			}).toString()}`,
			confirmed: true,
		});

		expect(result).toMatchObject({
			handled: true,
			route: "plugin-add",
			confirmed: true,
			installed: false,
			actionable: false,
			requiresReview: true,
			configKeys: ["source", "token"],
		});
		expect(JSON.stringify(result)).not.toContain("secret-value");
	});

	it("runs confirmed clean Cursor git checkout actions", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const workspace = await createGitWorkspace(tempDirs);
		runGit(workspace, ["branch", "feature"]);
		const ctx = createSidecarContext(workspace);

		const result = await handleCommand(ctx, "cursor_git_action", {
			uri: "vscode://cline.cline/git/checkout?branch=feature",
			confirmed: true,
		});

		expect(result).toMatchObject({
			handled: true,
			route: "git",
			kind: "git-checkout",
			confirmed: true,
			actionable: true,
			executed: true,
			target: "feature",
			currentBranch: "feature",
			dirty: false,
		});
		expect(runGit(workspace, ["branch", "--show-current"])).toBe("feature");
	});

	it("blocks Cursor git checkout actions when the worktree is dirty", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const workspace = await createGitWorkspace(tempDirs);
		runGit(workspace, ["branch", "feature"]);
		await writeFile(join(workspace, "README.md"), "dirty\n");
		const ctx = createSidecarContext(workspace);

		const result = await handleCommand(ctx, "cursor_git_action", {
			uri: "vscode://cline.cline/git/checkout?branch=feature",
			confirmed: true,
		});

		expect(result).toMatchObject({
			kind: "git-checkout",
			actionable: false,
			executed: false,
			target: "feature",
			currentBranch: "master",
			dirty: true,
		});
		expect(String((result as { reason?: string }).reason)).toContain(
			"uncommitted changes",
		);
		expect(runGit(workspace, ["branch", "--show-current"])).toBe("master");
	});

	it("runs confirmed Cursor git branch actions", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const workspace = await createGitWorkspace(tempDirs);
		const ctx = createSidecarContext(workspace);

		const result = await handleCommand(ctx, "cursor_git_action", {
			uri: "vscode://cline.cline/git/branch?name=work&checkout=true",
			confirmed: true,
		});

		expect(result).toMatchObject({
			kind: "git-branch",
			actionable: true,
			executed: true,
			branch: "work",
			checkout: true,
			currentBranch: "work",
		});
		expect(runGit(workspace, ["branch", "--show-current"])).toBe("work");
	});

	it("runs confirmed Cursor git commit actions without pushing", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const workspace = await createGitWorkspace(tempDirs);
		await writeFile(join(workspace, "README.md"), "updated\n");
		const ctx = createSidecarContext(workspace);

		const result = await handleCommand(ctx, "cursor_git_action", {
			uri: "vscode://cline.cline/git/commit?message=Update%20readme&all=true",
			confirmed: true,
		});

		expect(result).toMatchObject({
			kind: "git-commit",
			actionable: true,
			executed: true,
			message: "Update readme",
			dirty: true,
		});
		expect(typeof (result as { commitHash?: unknown }).commitHash).toBe("string");
		expect(runGit(workspace, ["log", "-1", "--pretty=%s"])).toBe(
			"Update readme",
		);
	});

	it("blocks direct push requests from Cursor git commit actions", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const workspace = await createGitWorkspace(tempDirs);
		const ctx = createSidecarContext(workspace);

		const result = await handleCommand(ctx, "cursor_git_action", {
			uri: "vscode://cline.cline/git/commit?message=Ship&push=true",
			confirmed: true,
		});

		expect(result).toMatchObject({
			kind: "git-commit",
			actionable: false,
			executed: false,
			message: "Ship",
		});
		expect(String((result as { reason?: string }).reason)).toContain(
			"separate manual confirmation",
		);
	});

	it("requires confirmation before launching Cursor deeplinks", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const ctx = createSidecarContext("/workspace/project");
		ctx.hubClient = {
			previewCursorUri: previewCursorUriMock,
		} as never;

		await expect(
			handleCommand(ctx, "cursor_uri_launch", {
				uri: "vscode://cline.cline/createchat?prompt=Review%20the%20diff",
			}),
		).rejects.toThrow("confirmed=true");
		expect(previewCursorUriMock).not.toHaveBeenCalled();
	});

	it("launches confirmed Cursor task deeplinks as queued desktop sessions", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const workspace = await mkdtemp(join(tmpdir(), "codevibe-cursor-uri-"));
		tempDirs.push(workspace);
		previewCursorUriMock.mockResolvedValueOnce({
			handled: true,
			route: "createchat",
			path: "/createchat",
			requiresConfirmation: true,
			taskPrompt: "Review the new diff and make a plan.",
		});
		const startMock = vi.fn(async () => ({ sessionId: "session-cursor" }));
		const sendMock = vi.fn(async () => ({}));
		const pendingListMock = vi.fn(async () => []);
		const ctx = createSidecarContext(workspace);
		ctx.hubClient = {
			previewCursorUri: previewCursorUriMock,
		} as never;
		ctx.sessionManager = {
			start: startMock,
			send: sendMock,
			pendingPrompts: { list: pendingListMock },
		} as never;

		const result = await handleCommand(ctx, "cursor_uri_launch", {
			uri: "vscode://cline.cline/createchat?prompt=Review%20the%20diff",
			confirmed: true,
			mode: "act",
			cwd: "/tmp/outside-workspace",
		});

		expect(previewCursorUriMock).toHaveBeenCalledWith({
			uri: "vscode://cline.cline/createchat?prompt=Review%20the%20diff",
			workspaceRoot: workspace,
		});
		expect(startMock).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					providerId: "openai-codex",
					modelId: "gpt-5.5",
					mode: "plan",
					workspaceRoot: workspace,
					cwd: workspace,
					enableTools: true,
					enableSpawnAgent: false,
					enableAgentTeams: false,
				}),
				interactive: true,
				toolPolicies: {
					"*": { enabled: false, autoApprove: false },
					read_files: { enabled: true, autoApprove: true },
					search_codebase: { enabled: true, autoApprove: true },
				},
			}),
		);
		expect(sendMock).toHaveBeenCalledWith({
			sessionId: "session-cursor",
			prompt: "Review the new diff and make a plan.",
			delivery: "queue",
			userImages: undefined,
		});
		expect(pendingListMock).toHaveBeenCalledWith({
			sessionId: "session-cursor",
		});
		expect(result).toMatchObject({
			handled: true,
			launched: true,
			route: "createchat",
			path: "/createchat",
			sessionId: "session-cursor",
			provider: "openai-codex",
			model: "gpt-5.5",
			mode: "plan",
			queued: true,
		});
	});

	it("marks background-agent Cursor launches in session metadata", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const workspace = await mkdtemp(join(tmpdir(), "codevibe-cursor-bg-"));
		tempDirs.push(workspace);
		const config = encodeCursorConfig({
			remoteName: "prod",
			token: "secret-value",
		});
		previewCursorUriMock.mockResolvedValueOnce({
			handled: true,
			route: "background-agent",
			path: "/background-agent",
			requiresConfirmation: true,
			taskPrompt: "Run the background investigation.",
		});
		const startMock = vi.fn(async () => ({ sessionId: "session-bg" }));
		const sendMock = vi.fn(async () => ({}));
		const pendingListMock = vi.fn(async () => []);
		const ctx = createSidecarContext(workspace);
		ctx.hubClient = {
			previewCursorUri: previewCursorUriMock,
		} as never;
		ctx.sessionManager = {
			start: startMock,
			send: sendMock,
			pendingPrompts: { list: pendingListMock },
		} as never;

		const result = await handleCommand(ctx, "cursor_uri_launch", {
			uri: `vscode://cline.cline/background-agent?prompt=Run%20the%20background%20investigation&repo=owner%2Frepo&branch=feature%2Fsafe&baseBranch=main&config=${config}`,
			confirmed: true,
		});

		expect(startMock).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionMetadata: expect.objectContaining({
					backgroundAgent: true,
					cursor: expect.objectContaining({
						source: "cursor-uri",
						route: "background-agent",
						path: "/background-agent",
						background: true,
						paramKeys: ["baseBranch", "branch", "config", "prompt", "repo"],
						configKeys: ["remoteName", "token"],
					}),
					backgroundAgentDetails: expect.objectContaining({
						repository: "owner/repo",
						requestedBranch: "feature/safe",
						requestedBaseBranch: "main",
						configKeys: ["remoteName", "token"],
					}),
				}),
			}),
		);
		expect(ctx.liveSessions.get("session-bg")?.config.sessionMetadata).toMatchObject(
			{
				backgroundAgent: true,
				cursor: expect.objectContaining({
					route: "background-agent",
					background: true,
				}),
			},
		);
		expect(sendMock).toHaveBeenCalledWith({
			sessionId: "session-bg",
			prompt: "Run the background investigation.",
			delivery: "queue",
			userImages: undefined,
		});
		expect(result).toMatchObject({
			handled: true,
			launched: true,
			route: "background-agent",
			path: "/background-agent",
			backgroundAgent: true,
			sessionId: "session-bg",
			backgroundAgentDetails: expect.objectContaining({
				repository: "owner/repo",
				requestedBranch: "feature/safe",
				requestedBaseBranch: "main",
			}),
			metadata: expect.objectContaining({
				backgroundAgent: true,
				backgroundAgentDetails: expect.objectContaining({
					repository: "owner/repo",
					requestedBranch: "feature/safe",
					requestedBaseBranch: "main",
					configKeys: ["remoteName", "token"],
				}),
				cursor: expect.objectContaining({
					route: "background-agent",
					background: true,
				}),
			}),
		});
		expect(JSON.stringify((result as { metadata: unknown }).metadata)).not.toContain(
			"Run the background investigation",
		);
		expect(JSON.stringify((result as { metadata: unknown }).metadata)).not.toContain(
			"secret-value",
		);
	});

	it("does not launch preview-only Cursor routes", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const startMock = vi.fn(async () => ({ sessionId: "session-cursor" }));
		const ctx = createSidecarContext("/workspace/project");
		ctx.hubClient = {
			previewCursorUri: previewCursorUriMock,
		} as never;
		ctx.sessionManager = {
			start: startMock,
		} as never;

		await expect(
			handleCommand(ctx, "cursor_uri_launch", {
				uri: "vscode://cline.cline/settings?query=codex",
				confirmed: true,
			}),
		).rejects.toThrow("not launchable");
		expect(startMock).not.toHaveBeenCalled();
	});

	it("does not launch automation previews even when they include task prompts", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		previewCursorUriMock.mockResolvedValueOnce({
			handled: true,
			route: "automation-ingest",
			path: "/automation/ingest",
			requiresConfirmation: true,
			taskPrompt: "Ingest this automation payload.",
		});
		const startMock = vi.fn(async () => ({ sessionId: "session-cursor" }));
		const ctx = createSidecarContext("/workspace/project");
		ctx.hubClient = {
			previewCursorUri: previewCursorUriMock,
		} as never;
		ctx.sessionManager = {
			start: startMock,
		} as never;

		await expect(
			handleCommand(ctx, "cursor_uri_launch", {
				uri: "vscode://cline.cline/automation/ingest?ndjson=%7B%7D",
				confirmed: true,
			}),
		).rejects.toThrow("not launchable");
		expect(startMock).not.toHaveBeenCalled();
	});

	it("previews desktop Cursor automation ingest without storing events", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const ctx = createSidecarContext("/workspace/project");
		const ndjson = JSON.stringify({
			eventId: "evt-1",
			eventType: "ci.completed",
			source: "cursor",
		});
		const result = await handleCommand(ctx, "cursor_automation_ingest", {
			uri: `vscode://cline.cline/automation/ingest?${new URLSearchParams({
				ndjson,
			}).toString()}`,
		});

		expect(createCoreMock).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			handled: true,
			route: "automation-ingest",
			confirmed: false,
			ingested: false,
			valid: true,
			eventCount: 1,
			rejectedCount: 0,
			workspaceRoot: "/workspace/project",
		});
	});

	it("blocks confirmed desktop Cursor automation ingest in strict mode when lines are rejected", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const ctx = createSidecarContext("/workspace/project");
		const ndjson = [
			JSON.stringify({
				eventId: "evt-1",
				eventType: "ci.completed",
				source: "cursor",
			}),
			"{broken",
		].join("\n");
		const result = await handleCommand(ctx, "cursor_automation_ingest", {
			uri: `vscode://cline.cline/automation/ingest?${new URLSearchParams({
				ndjson,
				strict: "true",
			}).toString()}`,
			confirmed: true,
		});

		expect(createCoreMock).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			confirmed: true,
			ingested: false,
			valid: false,
			strict: true,
			strictFailed: true,
			eventCount: 1,
			rejectedCount: 1,
		});
	});

	it("ingests confirmed desktop Cursor automation events through ClineCore", async () => {
		const { createSidecarContext } = await import("./context");
		const { handleCommand } = await import("./commands");

		const ingestNdjsonMock = vi.fn(() => ({
			events: [],
			rejected: [],
			results: [
				{
					event: { eventId: "evt-1" },
					duplicate: false,
					matchedSpecIds: ["spec-review", "spec-ci"],
					queuedRuns: [{ runId: "run-1" }, { runId: "run-2" }],
					suppressions: [],
				},
				{
					event: { eventId: "evt-2" },
					duplicate: true,
					matchedSpecIds: ["spec-ci"],
					queuedRuns: [],
					suppressions: [],
				},
			],
		}));
		const disposeMock = vi.fn(async () => {});
		createCoreMock.mockResolvedValueOnce({
			automation: {
				ingestNdjson: ingestNdjsonMock,
			},
			dispose: disposeMock,
		});
		const ctx = createSidecarContext("/workspace/project");
		const ndjson = JSON.stringify({
			eventId: "evt-1",
			eventType: "ci.completed",
			source: "cursor",
			payload: { token: "do-not-return" },
		});
		const result = await handleCommand(ctx, "cursor_automation_ingest", {
			uri: `vscode://cline.cline/automation/ingest?${new URLSearchParams({
				ndjson,
				defaultSource: "cursor",
			}).toString()}`,
			confirmed: true,
		});

		expect(createCoreMock).toHaveBeenCalledWith(
			expect.objectContaining({
				clientName: "code-desktop-cursor-automation-ingest",
				backendMode: "local",
				automation: {
					workspaceRoot: "/workspace/project",
				},
			}),
		);
		expect(ingestNdjsonMock).toHaveBeenCalledWith(
			ndjson,
			expect.objectContaining({
				defaultSource: "cursor",
			}),
		);
		expect(disposeMock).toHaveBeenCalledWith(
			"cursor_automation_ingest_done",
		);
		expect(result).toMatchObject({
			confirmed: true,
			ingested: true,
			valid: true,
			eventCount: 1,
			rejectedCount: 0,
			queuedRunCount: 2,
			duplicateCount: 1,
			matchedSpecIds: ["spec-ci", "spec-review"],
		});
		expect(JSON.stringify(result)).not.toContain("do-not-return");
	});
});
