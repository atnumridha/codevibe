import type { AgentMessage } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenAICodexProvider } from "./ai-sdk";
import { createGatewayApiHandler, toGatewayRequestMessages } from "./compat";
import type { Message } from "./types";

const streamTextSpy = vi.fn();
const openaiFactorySpy = vi.fn();
const openaiResponsesSpy = vi.fn((modelId: string) => ({
	modelId,
	family: "openai",
}));
const openaiCompatibleFactorySpy = vi.fn();
const openaiCompatibleSpy = vi.fn((modelId: string) => ({
	modelId,
	family: "openai-compatible",
}));
const codexExecFactorySpy = vi.fn();
const codexExecSpy = vi.fn((modelId: string) => ({
	modelId,
	family: "openai-codex-cli",
}));

vi.mock("ai", () => ({
	jsonSchema: (schema: unknown, options: unknown) => ({
		jsonSchema: schema,
		...(options && typeof options === "object" ? options : {}),
	}),
	streamText: (input: unknown) => streamTextSpy(input),
	wrapLanguageModel: ({ model }: { model: unknown }) => model,
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
	createOpenAICompatible: (config: unknown) => {
		openaiCompatibleFactorySpy(config);
		return (modelId: string) => openaiCompatibleSpy(modelId);
	},
}));

vi.mock("@ai-sdk/openai", () => ({
	createOpenAI: (config: unknown) => {
		openaiFactorySpy(config);
		return {
			responses: (modelId: string) => openaiResponsesSpy(modelId),
		};
	},
}));

vi.mock("@ai-sdk/anthropic", () => ({
	createAnthropic: () => (modelId: string) => ({
		modelId,
		family: "anthropic",
	}),
}));

vi.mock("@ai-sdk/google", () => ({
	createGoogleGenerativeAI: () => (modelId: string) => ({
		modelId,
		family: "google",
	}),
}));

vi.mock("ai-sdk-provider-codex-cli", () => ({
	createCodexExec: (config: unknown) => {
		codexExecFactorySpy(config);
		return (modelId: string) => codexExecSpy(modelId);
	},
}));

async function* makeStreamParts(parts: unknown[]) {
	for (const part of parts) {
		yield part;
	}
}

const baseAgentMessages: AgentMessage[] = [
	{
		id: "user_1",
		role: "user",
		content: [{ type: "text", text: "Hello" }],
		createdAt: Date.now(),
	},
];

const baseCompatMessages: Message[] = [{ role: "user", content: "Hello" }];

describe("openai-codex runtime routing", () => {
	beforeEach(() => {
		streamTextSpy.mockReset();
		openaiFactorySpy.mockReset();
		openaiResponsesSpy.mockReset();
		openaiCompatibleFactorySpy.mockReset();
		openaiCompatibleSpy.mockReset();
		codexExecFactorySpy.mockReset();
		codexExecSpy.mockReset();
		openaiResponsesSpy.mockImplementation((modelId: string) => ({
			modelId,
			family: "openai",
		}));
	});

	it("keeps the legacy createOpenAICodexProvider export on ChatGPT Responses", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const provider = await createOpenAICodexProvider({
			providerId: "openai-codex",
			apiKey: "test-token",
		});

		for await (const _event of provider.stream(
			{
				providerId: "openai-codex",
				modelId: "gpt-5.4",
				messages: baseAgentMessages,
				systemPrompt: "System instructions",
			},
			{
				provider: { id: "openai-codex", capabilities: [] },
				model: { id: "gpt-5.4" },
			} as never,
		)) {
			// Drain the stream so the provider request is executed.
		}

		expect(codexExecFactorySpy).not.toHaveBeenCalled();
		expect(openaiFactorySpy).toHaveBeenCalledWith(
			expect.objectContaining({
				baseURL: "https://chatgpt.com/backend-api/codex",
				headers: expect.objectContaining({
					originator: "codie",
					session_id: expect.any(String),
					"User-Agent": expect.stringMatching(/^Codie\//),
				}),
			}),
		);
		expect(openaiResponsesSpy).toHaveBeenCalledWith("gpt-5.4");
	});

	it("ignores stale CLI routing overrides for public openai-codex configs", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const handler = createGatewayApiHandler({
			providerId: "openai-codex",
			routingProviderId: "openai-codex-cli",
			modelId: "gpt-5.4",
			apiKey: "test-token",
		});

		for await (const _chunk of handler.createMessage(
			"System instructions",
			baseCompatMessages,
		)) {
			// Drain the stream so the provider request is executed.
		}

		expect(codexExecFactorySpy).not.toHaveBeenCalled();
		expect(openaiFactorySpy).toHaveBeenCalledWith(
			expect.objectContaining({
				baseURL: "https://chatgpt.com/backend-api/codex",
			}),
		);
		expect(openaiResponsesSpy).toHaveBeenCalledWith("gpt-5.4");
	});

	it("keeps explicit openai-codex-cli configs on the CLI provider", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const handler = createGatewayApiHandler({
			providerId: "openai-codex-cli",
			modelId: "gpt-5.3-codex",
			apiKey: "test-token",
		});

		for await (const _chunk of handler.createMessage(
			"System instructions",
			baseCompatMessages,
		)) {
			// Drain the stream so the provider request is executed.
		}

		expect(openaiFactorySpy).not.toHaveBeenCalled();
		expect(codexExecFactorySpy).toHaveBeenCalled();
		expect(codexExecSpy).toHaveBeenCalledWith("gpt-5.3-codex");
	});
});

describe("createGatewayApiHandler.getMessages", () => {
	it("preserves structured tool_result content for gateway requests", () => {
		const handler = createGatewayApiHandler({
			providerId: "openai-compatible",
			clientType: "openai-compatible",
			modelId: "test-model",
			apiKey: "test-key",
		});

		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_1",
						name: "run_commands",
						input: { commands: ["echo hello"] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_1",
						content: [
							{
								query: "echo hello",
								result: "hello\n",
								success: true,
							},
						],
					},
				],
			},
		];

		const request = handler.getMessages("", messages) as {
			messages: Array<{
				role: string;
				content: Array<Record<string, unknown>>;
			}>;
		};

		expect(request.messages).toHaveLength(2);
		expect(request.messages[1]).toMatchObject({
			role: "user",
			content: [
				{
					type: "tool-result",
					toolCallId: "toolu_1",
					toolName: "run_commands",
					output: [
						{
							query: "echo hello",
							result: "hello\n",
							success: true,
						},
					],
					isError: false,
				},
			],
		});
	});

	it("normalizes mixed legacy blocks and structured tool results", () => {
		const handler = createGatewayApiHandler({
			providerId: "openai-compatible",
			clientType: "openai-compatible",
			modelId: "test-model",
			apiKey: "test-key",
		});

		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_2",
						name: "run_commands",
						input: { commands: ["pwd"] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_2",
						content: [
							{ type: "text", text: "Command output:" },
							{
								query: "pwd",
								result: "/tmp/project\n",
								success: true,
							},
							{ type: "file", path: "/tmp/log.txt", content: "log line" },
						],
					},
				],
			},
		];

		const request = handler.getMessages("", messages) as {
			messages: Array<{
				role: string;
				content: Array<Record<string, unknown>>;
			}>;
		};

		// `toGatewayRequestMessages` now forwards the raw `tool_result.content`
		// unchanged. Downstream `formatMessagesForAiSdk` /
		// `toAiSdkToolResultOutput` is responsible for any flattening or
		// image-extraction; this layer only translates Cline's `Message[]`
		// shape into AI-SDK formatter parts.
		expect(request.messages[1]).toMatchObject({
			role: "user",
			content: [
				{
					type: "tool-result",
					toolCallId: "toolu_2",
					toolName: "run_commands",
					output: [
						{ type: "text", text: "Command output:" },
						{
							query: "pwd",
							result: "/tmp/project\n",
							success: true,
						},
						{ type: "file", path: "/tmp/log.txt", content: "log line" },
					],
					isError: false,
				},
			],
		});
	});

	it("forwards nested images inside structured tool results to the AI SDK formatter", () => {
		const handler = createGatewayApiHandler({
			providerId: "openai-compatible",
			clientType: "openai-compatible",
			modelId: "test-model",
			apiKey: "test-key",
		});

		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_3",
						name: "read_files",
						input: { file_paths: ["/tmp/demo.png"] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_3",
						content: [
							{
								query: "/tmp/demo.png",
								success: true,
								result: [
									{ type: "text", text: "Successfully read image" },
									{
										type: "image",
										data: "YWJj",
										mediaType: "image/png",
									},
								],
							},
						],
					},
				],
			},
		];

		const request = handler.getMessages("", messages) as {
			messages: Array<{
				role: string;
				content: Array<Record<string, unknown>>;
			}>;
		};

		// The compat layer no longer detaches images into sibling user
		// messages — that responsibility moved into
		// `toAiSdkToolResultOutput`, which extracts every nested `image`
		// content block into native `image-data` content parts. The
		// gateway request therefore contains the original
		// `ToolOperationResult[]` content unchanged, with the image block
		// still embedded inside `result`.
		expect(request.messages[1]).toMatchObject({
			role: "user",
			content: [
				{
					type: "tool-result",
					toolCallId: "toolu_3",
					toolName: "read_files",
					output: [
						{
							query: "/tmp/demo.png",
							success: true,
							result: [
								{ type: "text", text: "Successfully read image" },
								{
									type: "image",
									data: "YWJj",
									mediaType: "image/png",
								},
							],
						},
					],
					isError: false,
				},
			],
		});
		expect(request.messages[1]?.content).toHaveLength(1);
	});

	it("preserves is_error for structured tool results", () => {
		const handler = createGatewayApiHandler({
			providerId: "openai-compatible",
			clientType: "openai-compatible",
			modelId: "test-model",
			apiKey: "test-key",
		});

		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_4",
						name: "run_commands",
						input: { commands: ["false"] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_4",
						is_error: true,
						content: [
							{
								query: "false",
								result: "",
								error: "Command failed: exit 1",
								success: false,
							},
						],
					},
				],
			},
		];

		const request = handler.getMessages("", messages) as {
			messages: Array<{
				role: string;
				content: Array<Record<string, unknown>>;
			}>;
		};

		expect(request.messages[1]).toMatchObject({
			role: "user",
			content: [
				{
					type: "tool-result",
					toolCallId: "toolu_4",
					toolName: "run_commands",
					output: [
						{
							query: "false",
							result: "",
							error: "Command failed: exit 1",
							success: false,
						},
					],
					isError: true,
				},
			],
		});
	});
});

describe("createGatewayApiHandler.createMessage", () => {
	beforeEach(() => {
		streamTextSpy.mockReset();
		openaiCompatibleFactorySpy.mockReset();
		openaiCompatibleSpy.mockClear();
	});

	it("does not convert catalog maxTokens into request maxOutputTokens", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: (async function* () {
				yield { type: "finish", finishReason: "stop" };
			})(),
			usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
		});

		const handler = createGatewayApiHandler({
			providerId: "openrouter",
			clientType: "openai-compatible",
			modelId: "z-ai/glm-5.1",
			apiKey: "test-key",
			knownModels: {
				"z-ai/glm-5.1": {
					id: "z-ai/glm-5.1",
					name: "GLM 5.1",
					contextWindow: 202_800,
					maxInputTokens: 202_800,
					maxTokens: 202_800,
					capabilities: ["tools"],
				},
			},
		});

		for await (const _chunk of handler.createMessage("", [
			{ role: "user", content: "Hello" },
		])) {
			// Drain the stream so the provider request is executed.
		}

		const call = streamTextSpy.mock.calls.at(-1)?.[0] as
			| { maxOutputTokens?: unknown }
			| undefined;
		expect(call).not.toHaveProperty("maxOutputTokens");
	});

	it("caps configured maxOutputTokens with the catalog model output limit", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: (async function* () {
				yield { type: "finish", finishReason: "stop" };
			})(),
			usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
		});

		const handler = createGatewayApiHandler({
			providerId: "openrouter",
			clientType: "openai-compatible",
			modelId: "small-output",
			apiKey: "test-key",
			maxOutputTokens: 16_000,
			knownModels: {
				"small-output": {
					id: "small-output",
					name: "Small Output",
					contextWindow: 202_800,
					maxInputTokens: 202_800,
					maxTokens: 8_192,
					capabilities: ["tools"],
				},
			},
		});

		for await (const _chunk of handler.createMessage("", [
			{ role: "user", content: "Hello" },
		])) {
			// Drain the stream so the provider request is executed.
		}

		expect(streamTextSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				maxOutputTokens: 8_192,
			}),
		);
	});
});

/**
 * Tests for compat.ts message conversion (LlmsProviders.Message → AgentMessage).
 *
 * Specifically guards the read_file image-passing path: the orchestrator's
 * `tool_result` block carries an array of {text, image} content blocks, and we
 * MUST forward that array as the AgentMessage `tool-result` `output` so the
 * downstream `toAiSdkToolResultOutput` formatter emits an AI SDK
 * `{type:"content", value:[{type:"media", ...}, {type:"text", ...}]}`. If we
 * collapse the array to a string here the image bytes are dropped and the
 * model hallucinates.
 */
describe("toGatewayRequestMessages — tool_result with images", () => {
	it("forwards text+image content arrays as the tool-result output", () => {
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "call_1",
						name: "read_file",
						input: { path: "/tmp/image.jpg" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call_1",
						content: [
							{ type: "text", text: "Successfully read image" },
							{
								type: "image",
								data: "BASE64DATA",
								mediaType: "image/jpeg",
							},
						],
						is_error: false,
					},
				],
			},
		];

		const [, userMessage] = toGatewayRequestMessages(messages);

		// The user message must contain ONE tool-result block (no orphan image siblings).
		expect(userMessage.content).toHaveLength(1);
		const toolResult = userMessage.content[0] as Record<string, unknown>;

		expect(toolResult.type).toBe("tool-result");
		expect(toolResult.toolCallId).toBe("call_1");
		expect(toolResult.toolName).toBe("read_file");
		expect(toolResult.isError).toBe(false);

		// `output` must be the full structured content-block array — including
		// the image — so toAiSdkToolResultOutput can emit `{type:"content"}`.
		const output = toolResult.output as Array<Record<string, unknown>>;
		expect(Array.isArray(output)).toBe(true);
		expect(output).toHaveLength(2);
		expect(output[0]).toEqual({
			type: "text",
			text: "Successfully read image",
		});
		expect(output[1]).toEqual({
			type: "image",
			data: "BASE64DATA",
			mediaType: "image/jpeg",
		});
	});

	it("forwards text-only tool_result content unchanged for downstream normalisation", () => {
		// The compat layer no longer collapses `[{type:'text', text}]` into
		// a bare string — the AI SDK formatter accepts the content-block
		// array directly and emits it as a `{type:'content'}` tool-result
		// output. (`toAiSdkToolResultOutput` then forwards the text part
		// through unchanged.)
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "call_2",
						name: "read_file",
						input: { path: "/tmp/notes.txt" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call_2",
						content: [{ type: "text", text: "hello world" }],
					},
				],
			},
		];

		const [, userMessage] = toGatewayRequestMessages(messages);
		expect(userMessage.content).toHaveLength(1);
		const toolResult = userMessage.content[0] as Record<string, unknown>;
		expect(toolResult.output).toEqual([{ type: "text", text: "hello world" }]);
	});

	it("passes plain string content through unchanged", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call_3",
						content: "raw string output",
					},
				],
			},
		];

		const [userMessage] = toGatewayRequestMessages(messages);
		const toolResult = userMessage.content[0] as Record<string, unknown>;
		expect(toolResult.output).toBe("raw string output");
	});
});
