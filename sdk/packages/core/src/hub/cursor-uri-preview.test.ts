import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createLocalHubScheduleRuntimeHandlers } from "./daemon/runtime-handlers";
import { HubServerTransport } from "./server";

function encodeConfig(config: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(config), "utf8")
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function createTransport(): HubServerTransport {
	return new HubServerTransport({
		runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
	});
}

function createLaunchTransport(): {
	transport: HubServerTransport;
	startSession: ReturnType<typeof vi.fn>;
	runTurn: ReturnType<typeof vi.fn>;
} {
	let sessionRecord: Record<string, unknown> | undefined;
	const startSession = vi.fn(async (input: Record<string, unknown>) => {
		const config = input.config as Record<string, unknown>;
		const sessionId = String(config.sessionId ?? "session-launch");
		const metadata =
			input.sessionMetadata && typeof input.sessionMetadata === "object"
				? (input.sessionMetadata as Record<string, unknown>)
				: {};
		sessionRecord = {
			sessionId,
			status: "running",
			startedAt: new Date(0).toISOString(),
			updatedAt: new Date(0).toISOString(),
			workspaceRoot: String(config.workspaceRoot ?? "/workspace/repo"),
			cwd: String(config.cwd ?? config.workspaceRoot ?? "/workspace/repo"),
			source: input.source,
			provider: config.providerId,
			model: config.modelId,
			prompt: metadata.prompt,
			metadata,
			enableTools: config.enableTools,
			enableSpawn: config.enableSpawnAgent,
			enableTeams: config.enableAgentTeams,
		};
		return {
			sessionId,
			manifestPath: "",
			messagesPath: "",
		};
	});
	const runTurn = vi.fn(async () => undefined);
	const transport = new HubServerTransport({
		runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		scheduleOptions: { dbPath: ":memory:" },
		sessionHost: {
			subscribe: vi.fn(),
			startSession,
			runTurn,
			stopSession: vi.fn(),
			abort: vi.fn(),
			dispose: vi.fn(),
			getSession: vi.fn(async () => sessionRecord),
			getAccumulatedUsage: vi.fn(async () => undefined),
			listSessions: vi.fn(async () => []),
			deleteSession: vi.fn(),
			updateSession: vi.fn(),
			dispatchHookEvent: vi.fn(),
			readSessionMessages: vi.fn(async () => []),
		} as never,
	});
	return { transport, startSession, runTurn };
}

describe("hub Cursor URI preview command", () => {
	it("previews native cursor:// route-host deeplinks", async () => {
		const transport = createTransport();

		const reply = await transport.handleCommand({
			version: "v1",
			command: "cursor.uri.preview",
			requestId: "req-native",
			clientId: "client-one",
			payload: {
				uri: "cursor://mcp/install?name=docs&url=https%3A%2F%2Fmcp.example.com%2Fcontext",
			},
		});

		expect(reply).toMatchObject({
			ok: true,
			payload: {
				handled: true,
				route: "mcp-install",
				requiresConfirmation: true,
				serverName: "docs",
				urlOrigin: "https://mcp.example.com",
			},
		});

		const aliasReply = await transport.handleCommand({
			version: "v1",
			command: "cursor.uri.preview",
			requestId: "req-native-mcp-alias",
			clientId: "client-one",
			payload: {
				uri: "cursor://anysphere.cursor-mcp/install?name=docs&url=https%3A%2F%2Fmcp.example.com%2Fcontext",
			},
		});

		expect(aliasReply).toMatchObject({
			ok: true,
			payload: {
				handled: true,
				route: "mcp-install",
				requiresConfirmation: true,
				serverName: "docs",
				urlOrigin: "https://mcp.example.com",
			},
		});
	});

	it("previews native codevibe:// route-host deeplinks", async () => {
		const transport = createTransport();

		const reply = await transport.handleCommand({
			version: "v1",
			command: "cursor.uri.preview",
			requestId: "req-codevibe-native",
			clientId: "client-one",
			payload: {
				uri: "codevibe://createchat?prompt=Review%20the%20diff",
			},
		});

		expect(reply).toMatchObject({
			ok: true,
			payload: {
				handled: true,
				route: "createchat",
				path: "/createchat",
				requiresConfirmation: true,
				taskPrompt: "Review the diff",
			},
		});
	});

	it("previews background-agent launch intent without leaking config values", async () => {
		const transport = createTransport();
		const config = encodeConfig({
			token: "secret-value",
			browser: { enabled: true },
		});

		const reply = await transport.handleCommand({
			version: "v1",
			command: "cursor.uri.preview",
			requestId: "req-background-agent",
			clientId: "client-one",
			payload: {
				uri: `vscode://cline.cline/background-agent?task=Fix%20the%20queue&repo=owner%2Frepo&branch=feature%2Fsafe&baseBranch=main&config=${config}`,
			},
		});

		expect(reply).toMatchObject({
			ok: true,
			payload: {
				handled: true,
				route: "background-agent",
				path: "/background-agent",
				requiresConfirmation: true,
				hasPrompt: true,
				paramKeys: ["baseBranch", "branch", "config", "repo", "task"],
				configKeys: ["browser", "token"],
				backgroundAgent: {
					launchMode: "deferred",
					agentMode: "plan",
					confirmationRequired: true,
					worktreePolicy: "confirm-before-create",
					repository: "owner/repo",
					requestedBranch: "feature/safe",
					requestedBaseBranch: "main",
				},
			},
		});
		expect(JSON.stringify(reply)).not.toContain("secret-value");
	});

	it("previews Cursor Glass routes with dedicated metadata", async () => {
		const transport = createTransport();
		const config = encodeConfig({ placement: "top", token: "secret-value" });

		const reply = await transport.handleCommand({
			version: "v1",
			command: "cursor.uri.preview",
			requestId: "req-glass",
			clientId: "client-one",
			payload: {
				uri: `vscode://cline.cline/glass?text=Continue%20here&config=${config}`,
			},
		});

		expect(reply).toMatchObject({
			ok: true,
			payload: {
				handled: true,
				route: "glass",
				path: "/glass",
				requiresConfirmation: true,
				hasPrompt: true,
				glass: {
					glass: true,
					mode: "overlay",
					hasPrompt: true,
					paramKeys: ["config", "text"],
					configKeys: ["placement", "token"],
				},
			},
		});
		expect(JSON.stringify(reply)).not.toContain("secret-value");
	});

	it("validates automation ingest deeplinks without echoing raw event payloads", async () => {
		const transport = createTransport();
		const ndjson = encodeURIComponent(
			[
				JSON.stringify({
					eventId: "evt-1",
					eventType: "git.commit.created",
					source: "cursor",
					payload: { token: "secret-value", branch: "main" },
				}),
				"{bad-secret",
			].join("\n"),
		);

		const reply = await transport.handleCommand({
			version: "v1",
			command: "cursor.uri.preview",
			requestId: "req-1",
			clientId: "client-one",
			payload: {
				uri: `vscode://cline.cline/automation/ingest?ndjson=${ndjson}&strict=true`,
			},
		});

		expect(reply).toMatchObject({
			ok: true,
			payload: {
				handled: true,
				route: "automation-ingest",
				requiresConfirmation: false,
				strict: true,
				valid: false,
				eventCount: 1,
				rejectedCount: 1,
				validation: {
					events: [
						{
							eventId: "evt-1",
							eventType: "git.commit.created",
							source: "cursor",
							payloadKeys: ["branch", "token"],
						},
					],
					rejected: [
						{
							lineNumber: 2,
							reason: "invalid_json",
							lineLength: 11,
						},
					],
				},
			},
		});
		expect(JSON.stringify(reply)).not.toContain("secret-value");
		expect(JSON.stringify(reply)).not.toContain("{bad-secret");
	});

	it("summarizes MCP install deeplinks without exposing URL query, env, or header values", async () => {
		const transport = createTransport();
		const config = encodeConfig({
			mcpServers: {
				docs: {
					transport: {
						type: "streamable-http",
						url: "https://mcp.example.com/context?token=secret-value",
						headers: {
							Authorization: "Bearer secret-value",
						},
					},
					env: {
						DOCS_TOKEN: "secret-value",
					},
				},
			},
		});

		const reply = await transport.handleCommand({
			version: "v1",
			command: "cursor.uri.preview",
			requestId: "req-2",
			clientId: "client-one",
			payload: {
				uri: `vscode://cline.cline/mcp/install?name=docs&config=${config}`,
			},
		});

		expect(reply).toMatchObject({
			ok: true,
			payload: {
				handled: true,
				route: "mcp-install",
				requiresConfirmation: true,
				serverName: "docs",
				source: "config",
				transportType: "streamableHttp",
				urlOrigin: "https://mcp.example.com",
				headerKeys: ["Authorization"],
			},
		});
		expect(JSON.stringify(reply)).not.toContain("secret-value");
		expect(JSON.stringify(reply)).not.toContain("context");
		expect(JSON.stringify(reply)).not.toContain("Bearer");
	});

	it("previews Cursor plugin config sources without leaking config values", async () => {
		const transport = createTransport();
		const config = encodeConfig({
			url: "https://example.com/plugin.js?token=secret-value",
			token: "secret-value",
		});

		const reply = await transport.handleCommand({
			version: "v1",
			command: "cursor.uri.preview",
			requestId: "req-plugin-config-source",
			clientId: "client-one",
			payload: {
				uri: `vscode://cline.cline/plugin/add?config=${config}`,
			},
		});

		expect(reply).toMatchObject({
			ok: true,
			payload: {
				handled: true,
				route: "plugin-add",
				requiresConfirmation: true,
				requiresReview: false,
				sourceParam: "config",
				sourceConfigKey: "url",
				source: "https://example.com",
				configKeys: ["token", "url"],
			},
		});
		expect(JSON.stringify(reply)).not.toContain("secret-value");
		expect(JSON.stringify(reply)).not.toContain("plugin.js");
	});

	it("returns validation errors for unsupported Cursor routes", async () => {
		const transport = createTransport();

		const reply = await transport.handleCommand({
			version: "v1",
			command: "cursor.uri.preview",
			requestId: "req-3",
			clientId: "client-one",
			payload: {
				uri: "vscode://cline.cline/unknown?prompt=hello",
			},
		});

		expect(reply).toMatchObject({
			ok: false,
			error: {
				code: "cursor_uri_invalid",
				message: "Unsupported Cursor URI route: /unknown",
			},
		});
	});

	it("returns validation errors for malformed URI strings", async () => {
		const transport = createTransport();

		const reply = await transport.handleCommand({
			version: "v1",
			command: "cursor.uri.preview",
			requestId: "req-4",
			clientId: "client-one",
			payload: {
				uri: "not a uri",
			},
		});

		expect(reply).toMatchObject({
			ok: false,
			error: {
				code: "cursor_uri_invalid",
				message: "Invalid Cursor URI",
			},
		});
	});

	it("resolves safe Cursor command files when a workspace root is provided", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-hub-cursor-command-"));
		try {
			const commandsDir = join(root, ".cursor", "commands");
			mkdirSync(commandsDir, { recursive: true });
			writeFileSync(
				join(commandsDir, "review-code.md"),
				"Review the staged diff and call out risky changes.",
				"utf8",
			);
			const transport = createTransport();

			const reply = await transport.handleCommand({
				version: "v1",
				command: "cursor.uri.preview",
				requestId: "req-5",
				clientId: "client-one",
				payload: {
					uri: "vscode://cline.cline/command?name=review-code",
					workspaceRoot: root,
				},
			});

			expect(reply).toMatchObject({
				ok: true,
				payload: {
					handled: true,
					route: "command-file",
					path: "/command",
					requiresConfirmation: true,
					hasPrompt: false,
					commandFile: {
						commandName: "review-code",
						filename: "review-code.md",
						relativePath: ".cursor/commands/review-code.md",
					},
				},
			});
			expect(String(reply.payload?.taskPrompt)).toContain(
				"Review the staged diff and call out risky changes.",
			);
			expect(JSON.stringify(reply)).not.toContain(commandsDir);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("resolves safe Cursor command files from later workspace roots", async () => {
		const firstRoot = mkdtempSync(join(tmpdir(), "cline-hub-cursor-command-first-"));
		const secondRoot = mkdtempSync(join(tmpdir(), "cline-hub-cursor-command-second-"));
		try {
			const commandsDir = join(secondRoot, ".cursor", "commands");
			mkdirSync(commandsDir, { recursive: true });
			writeFileSync(
				join(commandsDir, "review-code.md"),
				"Review the second workspace diff.",
				"utf8",
			);
			const transport = createTransport();

			const reply = await transport.handleCommand({
				version: "v1",
				command: "cursor.uri.preview",
				requestId: "req-5b",
				clientId: "client-one",
				payload: {
					uri: "vscode://cline.cline/command?name=review-code",
					workspaceRoots: [firstRoot, secondRoot],
				},
			});

			expect(reply).toMatchObject({
				ok: true,
				payload: {
					handled: true,
					route: "command-file",
					commandFile: {
						commandName: "review-code",
						relativePath: ".cursor/commands/review-code.md",
					},
				},
			});
			expect(String(reply.payload?.taskPrompt)).toContain(
				"Review the second workspace diff.",
			);
			expect(JSON.stringify(reply)).not.toContain(firstRoot);
			expect(JSON.stringify(reply)).not.toContain(secondRoot);
		} finally {
			rmSync(firstRoot, { recursive: true, force: true });
			rmSync(secondRoot, { recursive: true, force: true });
		}
	});

	it("falls back to command preview when the command file exceeds the preview limit", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-hub-cursor-command-"));
		try {
			const commandsDir = join(root, ".cursor", "commands");
			mkdirSync(commandsDir, { recursive: true });
			writeFileSync(join(commandsDir, "large.md"), "0123456789", "utf8");
			const transport = createTransport();

			const reply = await transport.handleCommand({
				version: "v1",
				command: "cursor.uri.preview",
				requestId: "req-6",
				clientId: "client-one",
				payload: {
					uri: "vscode://cline.cline/command?name=large",
					workspaceRoot: root,
					maxCommandFileBytes: 5,
				},
			});

			expect(reply).toMatchObject({
				ok: true,
				payload: {
					handled: true,
					route: "command",
					path: "/command",
					requiresConfirmation: true,
					hasPrompt: false,
				},
			});
			expect(reply.payload).not.toHaveProperty("commandFile");
			expect(JSON.stringify(reply)).not.toContain("0123456789");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("summarizes existing Cursor rule files without leaking absolute paths or content", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-hub-cursor-rule-"));
		try {
			const rulesDir = join(root, ".cursor", "rules");
			mkdirSync(rulesDir, { recursive: true });
			writeFileSync(
				join(rulesDir, "team-style.mdc"),
				"Use small commits\nPrefer focused tests",
				"utf8",
			);
			const transport = createTransport();

			const reply = await transport.handleCommand({
				version: "v1",
				command: "cursor.uri.preview",
				requestId: "req-rule-existing",
				clientId: "client-one",
				payload: {
					uri: "vscode://cline.cline/rule?name=team-style",
					workspaceRoot: root,
				},
			});

			expect(reply).toMatchObject({
				ok: true,
				payload: {
					handled: true,
					route: "rule",
					kind: "file",
					requiresConfirmation: true,
					filename: "team-style.mdc",
					relativePath: ".cursor/rules/team-style.mdc",
					ruleFile: {
						filename: "team-style.mdc",
						relativePath: ".cursor/rules/team-style.mdc",
						exists: true,
						lineCount: 2,
					},
				},
			});
			expect(JSON.stringify(reply)).not.toContain(root);
			expect(JSON.stringify(reply)).not.toContain("Use small commits");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("summarizes missing and oversized Cursor rule previews safely", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-hub-cursor-rule-"));
		try {
			const transport = createTransport();
			const missing = await transport.handleCommand({
				version: "v1",
				command: "cursor.uri.preview",
				requestId: "req-rule-missing",
				clientId: "client-one",
				payload: {
					uri: "vscode://cline.cline/rule?path=.cursorrules",
					workspaceRoot: root,
				},
			});
			expect(missing).toMatchObject({
				ok: true,
				payload: {
					ruleFile: {
						filename: ".cursorrules",
						relativePath: ".cursorrules",
						exists: false,
					},
				},
			});

			const rulesDir = join(root, ".cursor", "rules");
			mkdirSync(rulesDir, { recursive: true });
			writeFileSync(join(rulesDir, "large.mdc"), "0123456789", "utf8");
			const oversized = await transport.handleCommand({
				version: "v1",
				command: "cursor.uri.preview",
				requestId: "req-rule-large",
				clientId: "client-one",
				payload: {
					uri: "vscode://cline.cline/rule?name=large",
					workspaceRoot: root,
					maxRuleFileBytes: 5,
				},
			});
			expect(oversized).toMatchObject({
				ok: true,
				payload: {
					ruleFile: {
						filename: "large.mdc",
						relativePath: ".cursor/rules/large.mdc",
						exists: true,
						byteLength: 10,
						tooLarge: true,
					},
				},
			});
			expect(JSON.stringify(oversized)).not.toContain("0123456789");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("hub Cursor URI launch command", () => {
	it("launches confirmed background-agent deeplinks as safe queued sessions", async () => {
		const { transport, startSession, runTurn } = createLaunchTransport();
		const config = encodeConfig({
			token: "secret-value",
			browser: { enabled: true },
		});

		const reply = await transport.handleCommand({
			version: "v1",
			command: "cursor.uri.launch",
			requestId: "req-launch-background-agent",
			clientId: "client-one",
			payload: {
				uri: `vscode://cline.cline/background-agent?task=Fix%20the%20queue&repo=owner%2Frepo&branch=feature%2Fsafe&baseBranch=main&config=${config}`,
				workspaceRoot: "/workspace/repo",
				confirmed: true,
				mode: "act",
				enableTools: false,
				enableSpawn: true,
				enableTeams: true,
				autoApproveTools: true,
				delivery: "steer",
				timeoutMs: 5_000,
			},
		});

		expect(reply).toMatchObject({
			ok: true,
			payload: {
				handled: true,
				launched: true,
				route: "background-agent",
				path: "/background-agent",
				provider: "openai-codex",
				model: "gpt-5.5",
				mode: "plan",
				queued: true,
				backgroundAgent: true,
				backgroundAgentDetails: {
					launchMode: "deferred",
					agentMode: "plan",
					confirmationRequired: true,
					worktreePolicy: "confirm-before-create",
					repository: "owner/repo",
					requestedBranch: "feature/safe",
					requestedBaseBranch: "main",
					configKeys: ["browser", "token"],
					taskId: expect.any(String),
				},
			},
		});
		expect(JSON.stringify(reply)).not.toContain("secret-value");
		expect(startSession).toHaveBeenCalledTimes(1);
		expect(runTurn).toHaveBeenCalledTimes(1);

		const startInput = startSession.mock.calls[0]?.[0] as Record<string, unknown>;
		const startConfig = startInput.config as Record<string, unknown>;
		const startMetadata = startInput.sessionMetadata as Record<string, unknown>;
		const toolPolicies = startInput.toolPolicies as Record<string, unknown>;
		expect(startInput.source).toBe("cursor-uri");
		expect(startConfig).toMatchObject({
			providerId: "openai-codex",
			modelId: "gpt-5.5",
			mode: "plan",
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			workspaceRoot: "/workspace/repo",
			cwd: "/workspace/repo",
		});
		expect(startMetadata).toMatchObject({
			backgroundAgent: true,
			source: "cursor-uri",
			provider: "openai-codex",
			model: "gpt-5.5",
			prompt: expect.stringContaining("Fix the queue"),
		});
		expect(startMetadata.backgroundAgentDetails).toMatchObject({
			taskId: startConfig.sessionId,
			repository: "owner/repo",
			requestedBranch: "feature/safe",
		});
		expect(toolPolicies).toMatchObject({
			"*": { enabled: false, autoApprove: false },
			read_files: { enabled: true, autoApprove: true },
			search_codebase: { enabled: true, autoApprove: true },
		});

		expect(runTurn).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: startConfig.sessionId,
				prompt: expect.stringContaining("Fix the queue"),
				mode: "plan",
				delivery: "queue",
				timeoutMs: 5_000,
			}),
		);
	});

	it("launches confirmed task deeplinks with explicit act steering options", async () => {
		const { transport, startSession, runTurn } = createLaunchTransport();

		const reply = await transport.handleCommand({
			version: "v1",
			command: "cursor.uri.launch",
			requestId: "req-launch-createchat-act",
			clientId: "client-one",
			payload: {
				uri: "vscode://cline.cline/createchat?prompt=Run%20the%20edit",
				workspaceRoot: "/workspace/repo",
				confirmed: true,
				mode: "act",
				enableTools: false,
				enableSpawn: true,
				enableTeams: true,
				autoApproveTools: true,
				delivery: "steer",
				timeoutMs: 7_500,
			},
		});

		expect(reply).toMatchObject({
			ok: true,
			payload: {
				handled: true,
				launched: true,
				route: "createchat",
				path: "/createchat",
				mode: "act",
				queued: false,
				backgroundAgent: false,
			},
		});
		expect(startSession).toHaveBeenCalledTimes(1);
		expect(runTurn).toHaveBeenCalledTimes(1);

		const startInput = startSession.mock.calls[0]?.[0] as Record<string, unknown>;
		const startConfig = startInput.config as Record<string, unknown>;
		expect(startConfig).toMatchObject({
			mode: "act",
			enableTools: false,
			enableSpawnAgent: true,
			enableAgentTeams: true,
			workspaceRoot: "/workspace/repo",
			cwd: "/workspace/repo",
		});
		expect(startInput.toolPolicies).toBeUndefined();
		expect(runTurn).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: startConfig.sessionId,
				prompt: "Run the edit",
				mode: "act",
				delivery: "steer",
				timeoutMs: 7_500,
			}),
		);
	});

	it("requires explicit confirmation before launching Cursor deeplinks", async () => {
		const { transport, startSession, runTurn } = createLaunchTransport();

		const reply = await transport.handleCommand({
			version: "v1",
			command: "cursor.uri.launch",
			requestId: "req-launch-unconfirmed",
			clientId: "client-one",
			payload: {
				uri: "vscode://cline.cline/createchat?prompt=Review%20the%20diff",
				workspaceRoot: "/workspace/repo",
			},
		});

		expect(reply).toMatchObject({
			ok: false,
			error: {
				message: "cursor.uri.launch requires confirmed=true.",
			},
		});
		expect(startSession).not.toHaveBeenCalled();
		expect(runTurn).not.toHaveBeenCalled();
	});
});
