import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalHubScheduleRuntimeHandlers } from "./daemon/runtime-handlers";
import { HubServerTransport } from "./server";

describe("hub prompt command commands", () => {
	it("lists and executes workspace workflow and skill prompt commands", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-hub-prompt-commands-"));
		const workflowsDir = join(root, ".cline", "workflows");
		const skillDir = join(root, ".cline", "skills", "debug");
		mkdirSync(workflowsDir, { recursive: true });
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(workflowsDir, "release.md"),
			`---
name: release
---
Run the release workflow.`,
			"utf8",
		);
		writeFileSync(
			join(skillDir, "SKILL.md"),
			`---
name: debug
description: Debug issues
---
Use the debugging skill.`,
			"utf8",
		);

		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: join(root, "schedule.db") },
		});

		try {
			const listReply = await transport.handleCommand({
				version: "v1",
				command: "prompt_commands.list",
				requestId: "req-prompt-list",
				clientId: "client-one",
				payload: {
					workspaceRoot: root,
				},
			});

			expect(listReply).toMatchObject({
				ok: true,
				payload: {
					workspaceRoot: root,
					count: 2,
					commands: [
						{
							name: "debug",
							kind: "skill",
							description: "Debug issues",
						},
						{
							name: "release",
							kind: "workflow",
						},
					],
				},
			});

			const filteredReply = await transport.handleCommand({
				version: "v1",
				command: "prompt_commands.list",
				requestId: "req-prompt-filter",
				clientId: "client-one",
				payload: {
					workspaceRoot: root,
					query: "rel",
				},
			});
			expect(filteredReply).toMatchObject({
				ok: true,
				payload: {
					query: "rel",
					count: 1,
					commands: [
						{
							name: "release",
							kind: "workflow",
						},
					],
				},
			});

			const executeReply = await transport.handleCommand({
				version: "v1",
				command: "prompt_commands.execute",
				requestId: "req-prompt-execute",
				clientId: "client-one",
				payload: {
					workspaceRoot: root,
					name: "/release",
					input: "now",
				},
			});

			expect(executeReply).toMatchObject({
				ok: true,
				payload: {
					name: "release",
					kind: "workflow",
					prompt: "Run the release workflow.\n\nnow",
				},
			});
		} finally {
			await transport.stop();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("uses registered client workspace context for prompt commands", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-hub-prompt-context-"));
		const workflowsDir = join(root, ".cline", "workflows");
		mkdirSync(workflowsDir, { recursive: true });
		writeFileSync(
			join(workflowsDir, "review.md"),
			`---
name: review
---
Review the changes.`,
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
				requestId: "req-register",
				clientId: "client-one",
				payload: {
					clientType: "test-client",
					transport: "native",
					workspaceContext: { workspaceRoot: root },
				},
			});
			const executeReply = await transport.handleCommand({
				version: "v1",
				command: "prompt_commands.execute",
				requestId: "req-prompt-context",
				clientId: "client-one",
				payload: {
					name: "review",
				},
			});

			expect(executeReply).toMatchObject({
				ok: true,
				payload: {
					name: "review",
					prompt: "Review the changes.",
				},
			});
		} finally {
			await transport.stop();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects missing prompt commands without expanding arbitrary input", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-hub-prompt-missing-"));
		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: join(root, "schedule.db") },
		});

		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "prompt_commands.execute",
				requestId: "req-prompt-missing",
				clientId: "client-one",
				payload: {
					workspaceRoot: root,
					name: "does-not-exist",
				},
			});
			expect(reply).toMatchObject({
				ok: false,
				error: {
					code: "prompt_commands_execute_failed",
				},
			});
		} finally {
			await transport.stop();
			rmSync(root, { recursive: true, force: true });
		}
	});
});
