import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
});
