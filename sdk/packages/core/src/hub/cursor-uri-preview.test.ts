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
});
