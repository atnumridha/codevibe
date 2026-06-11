import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalHubScheduleRuntimeHandlers } from "./daemon/runtime-handlers";
import { HubServerTransport } from "./server";

describe("hub mention_files.search command", () => {
	it("searches indexed workspace files without exposing Cursor-ignored paths", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-hub-mention-files-"));
		mkdirSync(join(root, "src"), { recursive: true });
		mkdirSync(join(root, "private"), { recursive: true });
		writeFileSync(join(root, "src", "app.ts"), "export const app = 1\n", "utf8");
		writeFileSync(
			join(root, "src", "app.test.ts"),
			"export const test = 1\n",
			"utf8",
		);
		writeFileSync(
			join(root, "private", "app-secret.ts"),
			"secret\n",
			"utf8",
		);
		writeFileSync(join(root, ".cursorignore"), "private/\n", "utf8");

		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: join(root, "schedule.db") },
		});

		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "mention_files.search",
				requestId: "req-mention",
				clientId: "client-one",
				payload: {
					workspaceRoot: root,
					query: "app",
					limit: 10,
					ttlMs: 0,
				},
			});

			expect(reply).toMatchObject({
				ok: true,
				payload: {
					query: "app",
					workspaceRoot: root,
					truncated: false,
				},
			});
			const results = (reply.payload as { results?: Array<{ path: string }> })
				.results;
			expect(results?.map((entry) => entry.path)).toEqual([
				"src/app.ts",
				"src/app.test.ts",
			]);
			expect(JSON.stringify(reply)).not.toContain("private/app-secret.ts");
		} finally {
			await transport.stop();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("uses the registered client workspace context when payload omits cwd", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-hub-mention-context-"));
		mkdirSync(join(root, "docs"), { recursive: true });
		writeFileSync(join(root, "docs", "guide.md"), "# Guide\n", "utf8");

		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: join(root, "schedule.db") },
		});

		try {
			await transport.handleCommand({
				version: "v1",
				command: "client.register",
				requestId: "req-register",
				clientId: "client-one",
				payload: {
					clientType: "test-client",
					transport: "native",
					workspaceContext: { workspaceRoot: root },
				},
			});
			const reply = await transport.handleCommand({
				version: "v1",
				command: "mention_files.search",
				requestId: "req-mention-context",
				clientId: "client-one",
				payload: {
					query: "guide",
					ttlMs: 0,
				},
			});

			expect(reply).toMatchObject({
				ok: true,
				payload: {
					workspaceRoot: root,
					results: [
						{
							path: "docs/guide.md",
							basename: "guide.md",
							directory: "docs",
						},
					],
				},
			});
		} finally {
			await transport.stop();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps terminal Cursor indexing globstar matches out of hub mention search", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-hub-mention-globstar-"));
		mkdirSync(join(root, "secrets"), { recursive: true });
		writeFileSync(join(root, ".cursorindexingignore"), "secrets/**\n", "utf8");
		writeFileSync(
			join(root, "secrets", "token.ts"),
			"export const token = 1\n",
			"utf8",
		);

		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: join(root, "schedule.db") },
		});

		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "mention_files.search",
				requestId: "req-mention-globstar",
				clientId: "client-one",
				payload: {
					workspaceRoot: root,
					query: "token",
					limit: 10,
					ttlMs: 0,
				},
			});

			expect(reply).toMatchObject({
				ok: true,
				payload: {
					query: "token",
					results: [],
				},
			});
			expect(JSON.stringify(reply)).not.toContain("secrets/token.ts");
		} finally {
			await transport.stop();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("can include Cursor-ignored paths when a client disables the privacy gate", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-hub-mention-legacy-"));
		mkdirSync(join(root, "private"), { recursive: true });
		writeFileSync(join(root, ".cursorignore"), "private/\n", "utf8");
		writeFileSync(
			join(root, "private", "secret.ts"),
			"export const secret = 1\n",
			"utf8",
		);

		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: join(root, "schedule.db") },
		});

		try {
			await transport.handleCommand({
				version: "v1",
				command: "client.register",
				requestId: "req-register-legacy",
				clientId: "client-one",
				payload: {
					clientType: "test-client",
					transport: "native",
					workspaceContext: {
						workspaceRoot: root,
						cursorRetrievalIndexingPrivacyGate: false,
					},
				},
			});
			const reply = await transport.handleCommand({
				version: "v1",
				command: "mention_files.search",
				requestId: "req-mention-legacy",
				clientId: "client-one",
				payload: {
					query: "secret",
					ttlMs: 0,
				},
			});

			expect(reply).toMatchObject({
				ok: true,
				payload: {
					workspaceRoot: root,
					results: [
						{
							path: "private/secret.ts",
							basename: "secret.ts",
							directory: "private",
						},
					],
				},
			});
		} finally {
			await transport.stop();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects requests without a workspace root", async () => {
		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: ":memory:" },
		});

		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "mention_files.search",
				requestId: "req-mention-missing-root",
				clientId: "client-one",
				payload: {
					query: "app",
				},
			});
			expect(reply).toMatchObject({
				ok: false,
				error: {
					code: "mention_files_search_failed",
				},
			});
		} finally {
			await transport.stop();
		}
	});
});
