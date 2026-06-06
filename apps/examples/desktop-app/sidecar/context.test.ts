import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

describe("Code sidecar runtime capabilities", () => {
	const tempDirs: string[] = [];
	let previousMcpSettingsPath: string | undefined;

	beforeEach(() => {
		previousMcpSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
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
		await Promise.all(
			tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
		);
		tempDirs.length = 0;
	});

	it("registers Code App capability factory with core", async () => {
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
					displayName: "Code App sidecar",
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
					displayName: "Code App sidecar",
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
