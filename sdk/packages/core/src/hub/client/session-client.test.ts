import { afterEach, describe, expect, it, vi } from "vitest";
import { HubSessionClient } from "./session-client";

type SocketListener = (...args: unknown[]) => void;
type MockCommandFrame = {
	kind?: string;
	envelope?: {
		requestId?: string;
		command?: string;
		payload?: Record<string, unknown>;
	};
};

class MockWebSocket {
	static instances: MockWebSocket[] = [];
	static sentFrames: MockCommandFrame[] = [];
	static commandHandler:
		| ((frame: MockCommandFrame) => Record<string, unknown> | undefined)
		| undefined;

	readyState = 0;
	private readonly listeners = new Map<string, SocketListener[]>();

	constructor(_url: string) {
		MockWebSocket.instances.push(this);
		queueMicrotask(() => {
			this.readyState = 1;
			this.emit("open");
		});
	}

	static reset(): void {
		MockWebSocket.instances = [];
		MockWebSocket.sentFrames = [];
		MockWebSocket.commandHandler = undefined;
	}

	send(data: string): void {
		const frame = JSON.parse(data) as MockCommandFrame;
		MockWebSocket.sentFrames.push(frame);
		if (frame.kind !== "command" || !frame.envelope?.requestId) {
			return;
		}
		queueMicrotask(() => {
			const handled = MockWebSocket.commandHandler?.(frame);
			this.emitFrame({
				kind: "reply",
				envelope: {
					version: "v1",
					requestId: frame.envelope?.requestId,
					command: frame.envelope?.command,
					ok: true,
					payload: handled ?? {},
				},
			});
		});
	}

	close(): void {
		this.readyState = 3;
		this.emit("close", { code: 1000, reason: "" });
	}

	addEventListener(type: string, listener: SocketListener): void {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	emitFrame(frame: unknown): void {
		this.emit("message", { data: JSON.stringify(frame) });
	}

	private emit(type: string, ...args: unknown[]): void {
		for (const listener of this.listeners.get(type) ?? []) {
			listener(...args);
		}
	}
}

describe("HubSessionClient", () => {
	afterEach(() => {
		MockWebSocket.reset();
		vi.unstubAllGlobals();
	});

	it("advertises and handles runtime tool executor capabilities", async () => {
		vi.stubGlobal("WebSocket", MockWebSocket);
		const browserSnapshot = vi.fn(async () => ({
			url: "https://example.test/",
			title: "Example",
		}));
		const browserAction = vi.fn(async () => ({
			url: "https://example.test/",
			title: "Clicked",
		}));
		const browserScreenshot = vi.fn(async () => ({
			screenshot: "data:image/png;base64,abc",
		}));
		MockWebSocket.commandHandler = (frame) => {
			if (frame.envelope?.command !== "session.create") {
				return undefined;
			}
			const payload = frame.envelope.payload ?? {};
			const sessionConfig =
				payload.sessionConfig &&
				typeof payload.sessionConfig === "object" &&
				!Array.isArray(payload.sessionConfig)
					? (payload.sessionConfig as Record<string, unknown>)
					: {};
			return {
				session: {
					sessionId: String(sessionConfig.sessionId),
					metadata: {},
				},
			};
		};
		const client = new HubSessionClient({
			address: "ws://127.0.0.1:25463/hub",
			clientId: "client-1",
			capabilities: {
				toolExecutors: {
					browserSnapshot,
					browserAction,
					browserScreenshot,
				},
			} as never,
		});

		const started = await client.startRuntimeSession({
			workspaceRoot: "/tmp/project",
			cwd: "/tmp/project",
			provider: "cline",
			model: "test-model",
			enableTools: true,
		});
		const createFrameIndex = MockWebSocket.sentFrames.findIndex(
			(frame) => frame.envelope?.command === "session.create",
		);
		const subscribeFrameIndex = MockWebSocket.sentFrames.findIndex(
			(frame) => frame.kind === "stream.subscribe",
		);
		const createFrame = MockWebSocket.sentFrames[createFrameIndex];
		const createPayload = createFrame?.envelope?.payload as
			| { sessionConfig?: { sessionId?: unknown }; runtimeOptions?: unknown }
			| undefined;

		expect(subscribeFrameIndex).toBeGreaterThan(-1);
		expect(subscribeFrameIndex).toBeLessThan(createFrameIndex);
		expect(typeof createPayload?.sessionConfig?.sessionId).toBe("string");
		expect(started.sessionId).toBe(createPayload?.sessionConfig?.sessionId);
		expect(createPayload?.runtimeOptions).toMatchObject({
			clientContributions: [
				{
					kind: "toolExecutor",
					executor: "browserSnapshot",
					capabilityName: "tool_executor.browserSnapshot",
				},
				{
					kind: "toolExecutor",
					executor: "browserAction",
					capabilityName: "tool_executor.browserAction",
				},
				{
					kind: "toolExecutor",
					executor: "browserScreenshot",
					capabilityName: "tool_executor.browserScreenshot",
				},
			],
		});
		const socket = MockWebSocket.instances[0];
		if (!socket) {
			throw new Error("expected websocket");
		}

		socket.emitFrame({
			kind: "event",
			envelope: {
				version: "v1",
				eventId: "evt-capability",
				event: "capability.requested",
				timestamp: Date.now(),
				sessionId: started.sessionId,
				payload: {
					requestId: "capreq-1",
					targetClientId: "client-1",
					capabilityName: "tool_executor.browserSnapshot",
					payload: {
						args: [{ tab_id: "tab-1", include_logs: true }],
						context: {
							agentId: "agent-1",
							conversationId: "conv-1",
							iteration: 2,
							metadata: { source: "test" },
						},
					},
				},
			},
		});

		await vi.waitFor(() => {
			expect(browserSnapshot).toHaveBeenCalledOnce();
		});
		await vi.waitFor(() => {
			expect(
				MockWebSocket.sentFrames.some(
					(frame) => frame.envelope?.command === "capability.respond",
				),
			).toBe(true);
		});
		const respondFrame = MockWebSocket.sentFrames.find(
			(frame) => frame.envelope?.command === "capability.respond",
		);
		expect(browserSnapshot).toHaveBeenCalledWith(
			{ tab_id: "tab-1", include_logs: true },
			expect.objectContaining({
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 2,
				metadata: { source: "test" },
				signal: expect.any(Object),
			}),
		);
		expect(respondFrame?.envelope?.payload).toMatchObject({
			requestId: "capreq-1",
			ok: true,
			payload: {
				result: {
					url: "https://example.test/",
					title: "Example",
				},
			},
		});

		client.close();
	});

	it("advertises runtime tool executor capabilities when restoring sessions", async () => {
		vi.stubGlobal("WebSocket", MockWebSocket);
		const browserAction = vi.fn(async () => ({
			url: "https://example.test/",
			title: "Clicked",
		}));
		MockWebSocket.commandHandler = (frame) => {
			if (frame.envelope?.command !== "session.restore") {
				return undefined;
			}
			return {
				session: {
					sessionId: "session-restore",
					metadata: {},
				},
				checkpoint: {
					ref: "checkpoint-ref",
					createdAt: Date.now(),
					runCount: 3,
				},
			};
		};
		const client = new HubSessionClient({
			address: "ws://127.0.0.1:25463/hub",
			clientId: "client-1",
			capabilities: {
				toolExecutors: {
					browserAction,
				},
			} as never,
		});

		await client.restore({
			sessionId: "session-restore",
			checkpointRunCount: 3,
			restore: { messages: true },
			config: {
				workspaceRoot: "/tmp/project",
				cwd: "/tmp/project",
				provider: "cline",
				model: "test-model",
				enableTools: true,
				toolExecutors: ["browserAction"],
			},
		});

		const restoreFrameIndex = MockWebSocket.sentFrames.findIndex(
			(frame) => frame.envelope?.command === "session.restore",
		);
		const subscribeFrameIndex = MockWebSocket.sentFrames.findIndex(
			(frame) => frame.kind === "stream.subscribe",
		);
		const restoreFrame = MockWebSocket.sentFrames[restoreFrameIndex];
		const restorePayload = restoreFrame?.envelope?.payload as
			| { runtimeOptions?: unknown }
			| undefined;

		expect(subscribeFrameIndex).toBeGreaterThan(-1);
		expect(subscribeFrameIndex).toBeLessThan(restoreFrameIndex);
		expect(restorePayload?.runtimeOptions).toMatchObject({
			toolExecutors: ["browserAction"],
			clientContributions: [
				{
					kind: "toolExecutor",
					executor: "browserAction",
					capabilityName: "tool_executor.browserAction",
				},
			],
		});
		const socket = MockWebSocket.instances[0];
		if (!socket) {
			throw new Error("expected websocket");
		}

		socket.emitFrame({
			kind: "event",
			envelope: {
				version: "v1",
				eventId: "evt-capability",
				event: "capability.requested",
				timestamp: Date.now(),
				sessionId: "session-restore",
				payload: {
					requestId: "capreq-restore",
					targetClientId: "client-1",
					capabilityName: "tool_executor.browserAction",
					payload: {
						args: [{ action: "click", coordinate: "10,10" }],
						context: {
							agentId: "agent-1",
							conversationId: "conv-1",
							iteration: 2,
						},
					},
				},
			},
		});

		await vi.waitFor(() => {
			expect(browserAction).toHaveBeenCalledOnce();
		});
		expect(browserAction).toHaveBeenCalledWith(
			{ action: "click", coordinate: "10,10" },
			expect.objectContaining({
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 2,
				signal: expect.any(Object),
			}),
		);

		client.close();
	});

	it("advertises runtime tool executor capabilities when forking sessions", async () => {
		vi.stubGlobal("WebSocket", MockWebSocket);
		const browserAction = vi.fn(async () => ({
			url: "https://example.test/",
			title: "Forked",
		}));
		MockWebSocket.commandHandler = (frame) => {
			if (frame.envelope?.command !== "session.fork") {
				return undefined;
			}
			const payload = frame.envelope.payload ?? {};
			return {
				sourceSessionId: payload.sourceSessionId,
				messageCount: 2,
				session: {
					sessionId: String(payload.newSessionId),
					metadata: {
						parentSessionId: payload.sourceSessionId,
					},
				},
			};
		};
		const client = new HubSessionClient({
			address: "ws://127.0.0.1:25463/hub",
			clientId: "client-1",
			capabilities: {
				toolExecutors: {
					browserAction,
				},
			} as never,
		});

		const forked = await client.fork({
			sourceSessionId: "session-source",
			prompt: "continue here",
			config: {
				workspaceRoot: "/tmp/project",
				cwd: "/tmp/project",
				provider: "cline",
				model: "test-model",
				enableTools: true,
				toolExecutors: ["browserAction"],
			},
		});

		const forkFrameIndex = MockWebSocket.sentFrames.findIndex(
			(frame) => frame.envelope?.command === "session.fork",
		);
		const subscribeFrameIndex = MockWebSocket.sentFrames.findIndex(
			(frame) => frame.kind === "stream.subscribe",
		);
		const forkFrame = MockWebSocket.sentFrames[forkFrameIndex];
		const forkPayload = forkFrame?.envelope?.payload as
			| {
					sourceSessionId?: unknown;
					newSessionId?: unknown;
					prompt?: unknown;
					runtimeOptions?: unknown;
			  }
			| undefined;

		expect(subscribeFrameIndex).toBeGreaterThan(-1);
		expect(subscribeFrameIndex).toBeLessThan(forkFrameIndex);
		expect(forkPayload).toMatchObject({
			sourceSessionId: "session-source",
			prompt: "continue here",
		});
		expect(typeof forkPayload?.newSessionId).toBe("string");
		expect(forkPayload?.runtimeOptions).toMatchObject({
			toolExecutors: ["browserAction"],
			clientContributions: [
				{
					kind: "toolExecutor",
					executor: "browserAction",
					capabilityName: "tool_executor.browserAction",
				},
			],
		});
		expect(forked).toMatchObject({
			sourceSessionId: "session-source",
			messageCount: 2,
			session: {
				sessionId: forkPayload?.newSessionId,
			},
		});
		const forkedSessionId =
			typeof forkPayload?.newSessionId === "string"
				? forkPayload.newSessionId
				: "";
		const received: Array<{
			sessionId: string;
			eventType: string;
			payload: Record<string, unknown>;
		}> = [];
		const unsubscribe = client.streamEvents(
			{ sessionIds: [forkedSessionId] },
			{
				onEvent: (event) => {
					received.push(event);
				},
			},
		);
		const socket = MockWebSocket.instances[0];
		if (!socket) {
			throw new Error("expected websocket");
		}
		socket.emitFrame({
			kind: "event",
			envelope: {
				version: "v1",
				eventId: "evt-fork",
				event: "session.forked",
				timestamp: Date.now(),
				sessionId: forkedSessionId,
				payload: {
					sourceSessionId: "session-source",
					messageCount: 2,
				},
			},
		});
		expect(received).toEqual([
			{
				sessionId: forkedSessionId,
				eventType: "runtime.session.forked",
				payload: {
					sourceSessionId: "session-source",
					messageCount: 2,
				},
			},
		]);

		unsubscribe();
		client.close();
	});

	it("normalizes run.failed events to include a top-level error", async () => {
		vi.stubGlobal("WebSocket", MockWebSocket);
		const client = new HubSessionClient({
			address: "ws://127.0.0.1:25463/hub",
			clientId: "client-1",
		});
		await client.connect();
		const socket = MockWebSocket.instances[0];
		if (!socket) {
			throw new Error("expected websocket");
		}
		const received: Array<{
			sessionId: string;
			eventType: string;
			payload: Record<string, unknown>;
		}> = [];
		const unsubscribe = client.streamEvents(
			{ sessionIds: ["session-1"] },
			{
				onEvent: (event) => {
					received.push(event);
				},
			},
		);

		socket.emitFrame({
			kind: "event",
			envelope: {
				version: "v1",
				eventId: "evt-1",
				event: "run.failed",
				timestamp: Date.now(),
				sessionId: "session-1",
				payload: {
					reason: "error",
					result: {
						text: "Provider rejected the request",
						finishReason: "error",
					},
				},
			},
		});

		expect(received).toEqual([
			{
				sessionId: "session-1",
				eventType: "runtime.chat.failed",
				payload: {
					reason: "error",
					error: "Provider rejected the request",
					result: {
						text: "Provider rejected the request",
						finishReason: "error",
					},
				},
			},
		]);

		unsubscribe();
		client.close();
	});

	it("maps usage.updated events into runtime chat usage events", async () => {
		vi.stubGlobal("WebSocket", MockWebSocket);
		const client = new HubSessionClient({
			address: "ws://127.0.0.1:25463/hub",
			clientId: "client-1",
		});
		await client.connect();
		const socket = MockWebSocket.instances[0];
		if (!socket) {
			throw new Error("expected websocket");
		}
		const received: Array<{
			sessionId: string;
			eventType: string;
			payload: Record<string, unknown>;
		}> = [];
		const unsubscribe = client.streamEvents(
			{ sessionIds: ["session-1"] },
			{
				onEvent: (event) => {
					received.push(event);
				},
			},
		);

		socket.emitFrame({
			kind: "event",
			envelope: {
				version: "v1",
				eventId: "evt-usage",
				event: "usage.updated",
				timestamp: Date.now(),
				sessionId: "session-1",
				payload: {
					delta: { inputTokens: 7, outputTokens: 5, totalCost: 0.12 },
					aggregateUsage: { inputTokens: 17, outputTokens: 8, totalCost: 0.23 },
					agent: { kind: "teammate", teamAgentId: "investigator" },
				},
			},
		});

		expect(received).toEqual([
			{
				sessionId: "session-1",
				eventType: "runtime.chat.usage",
				payload: {
					delta: { inputTokens: 7, outputTokens: 5, totalCost: 0.12 },
					aggregateUsage: { inputTokens: 17, outputTokens: 8, totalCost: 0.23 },
					agent: { kind: "teammate", teamAgentId: "investigator" },
				},
			},
		]);

		unsubscribe();
		client.close();
	});

	it("maps schedule execution events without requiring an envelope session id", async () => {
		vi.stubGlobal("WebSocket", MockWebSocket);
		const client = new HubSessionClient({
			address: "ws://127.0.0.1:25463/hub",
			clientId: "client-1",
		});
		await client.connect();
		const socket = MockWebSocket.instances[0];
		if (!socket) {
			throw new Error("expected websocket");
		}
		const received: Array<{
			sessionId: string;
			eventType: string;
			payload: Record<string, unknown>;
		}> = [];
		const unsubscribe = client.streamEvents(
			{ clientId: "schedule-listener" },
			{
				onEvent: (event) => {
					received.push(event);
				},
			},
		);

		socket.emitFrame({
			kind: "event",
			envelope: {
				version: "v1",
				eventId: "evt-schedule",
				event: "schedule.execution_completed",
				timestamp: Date.now(),
				payload: {
					scheduleId: "sched_1",
					executionId: "run_1",
					sessionId: "session-1",
					status: "success",
				},
			},
		});

		expect(received).toEqual([
			{
				sessionId: "session-1",
				eventType: "schedule.execution.completed",
				payload: {
					scheduleId: "sched_1",
					executionId: "run_1",
					sessionId: "session-1",
					status: "success",
				},
			},
		]);

		unsubscribe();
		client.close();
	});

	it("maps failed schedule execution events", async () => {
		vi.stubGlobal("WebSocket", MockWebSocket);
		const client = new HubSessionClient({
			address: "ws://127.0.0.1:25463/hub",
			clientId: "client-1",
		});
		await client.connect();
		const socket = MockWebSocket.instances[0];
		if (!socket) {
			throw new Error("expected websocket");
		}
		const received: Array<{
			sessionId: string;
			eventType: string;
			payload: Record<string, unknown>;
		}> = [];
		const unsubscribe = client.streamEvents(
			{ clientId: "schedule-listener" },
			{
				onEvent: (event) => {
					received.push(event);
				},
			},
		);

		socket.emitFrame({
			kind: "event",
			envelope: {
				version: "v1",
				eventId: "evt-schedule-failed",
				event: "schedule.execution_failed",
				timestamp: Date.now(),
				payload: {
					scheduleId: "sched_1",
					executionId: "run_1",
					sessionId: "session-1",
					status: "failed",
					errorMessage: "runtime failed",
				},
			},
		});

		expect(received).toEqual([
			{
				sessionId: "session-1",
				eventType: "schedule.execution.failed",
				payload: {
					scheduleId: "sched_1",
					executionId: "run_1",
					sessionId: "session-1",
					status: "failed",
					errorMessage: "runtime failed",
				},
			},
		]);

		unsubscribe();
		client.close();
	});
});
