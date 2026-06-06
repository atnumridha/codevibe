import { mkdtemp, rm } from "node:fs/promises";
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

describe("Code sidecar runtime capabilities", () => {
	const tempDirs: string[] = [];

	beforeEach(() => {
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
});
