import { describe, expect, it, vi } from "vitest";
import type { CoreSettingsService } from "../settings";
import { createLocalHubScheduleRuntimeHandlers } from "./daemon/runtime-handlers";
import { HubServerTransport } from "./server";

describe("hub settings commands", () => {
	it("returns a single settings item with its snapshot", async () => {
		const snapshot = {
			workflows: [],
			rules: [],
			skills: [],
			tools: [],
			mcp: [
				{
					id: "docs",
					name: "docs",
					path: "/tmp/cline_mcp_settings.json",
					kind: "mcp" as const,
					source: "workspace" as const,
					enabled: true,
					toggleable: true,
				},
			],
		};
		const settingsService = {
			get: vi.fn().mockResolvedValue({
				type: "mcp",
				item: snapshot.mcp[0],
				snapshot,
			}),
		} as unknown as CoreSettingsService;
		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			settingsService,
		});

		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "settings.get",
				requestId: "req-1",
				clientId: "client-one",
				payload: {
					type: "mcp",
					name: "docs",
				},
			});

			expect(reply).toMatchObject({
				ok: true,
				payload: {
					type: "mcp",
					item: snapshot.mcp[0],
					snapshot,
				},
			});
			expect(settingsService.get).toHaveBeenCalledWith({
				type: "mcp",
				name: "docs",
			});
		} finally {
			await transport.stop();
		}
	});

	it("returns an updated snapshot and publishes settings.changed after toggle", async () => {
		const snapshot = {
			workflows: [],
			rules: [],
			skills: [
				{
					id: "skill-one",
					name: "skill-one",
					path: "/tmp/SKILL.md",
					kind: "skill" as const,
					source: "workspace" as const,
					enabled: false,
					toggleable: true,
				},
			],
			tools: [],
			mcp: [],
		};
		const settingsService = {
			toggle: vi.fn().mockResolvedValue({
				snapshot,
				changedTypes: ["skills"],
			}),
		} as unknown as CoreSettingsService;
		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			settingsService,
		});
		const events: string[] = [];
		const unsubscribe = transport.subscribe("client-one", (event) => {
			if (event.event === "settings.changed") {
				events.push(JSON.stringify(event.payload));
			}
		});

		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "settings.toggle",
				requestId: "req-1",
				clientId: "client-one",
				payload: {
					type: "skills",
					id: "skill-one",
					enabled: false,
				},
			});

			expect(reply).toMatchObject({
				ok: true,
				payload: {
					snapshot,
					changedTypes: ["skills"],
				},
			});
			expect(settingsService.toggle).toHaveBeenCalledWith({
				type: "skills",
				id: "skill-one",
				enabled: false,
			});
			expect(events).toHaveLength(1);
			expect(JSON.parse(events[0] ?? "{}")).toMatchObject({
				types: ["skills"],
				snapshot,
			});
		} finally {
			unsubscribe();
			await transport.stop();
		}
	});

	it("patches settings enabled state and publishes settings.changed", async () => {
		const snapshot = {
			workflows: [],
			rules: [],
			skills: [],
			tools: [],
			mcp: [
				{
					id: "docs",
					name: "docs",
					path: "/tmp/cline_mcp_settings.json",
					kind: "mcp" as const,
					source: "workspace" as const,
					enabled: false,
					toggleable: true,
				},
			],
		};
		const settingsService = {
			patch: vi.fn().mockResolvedValue({
				snapshot,
				changedTypes: ["mcp"],
			}),
		} as unknown as CoreSettingsService;
		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			settingsService,
		});
		const events: string[] = [];
		const unsubscribe = transport.subscribe("client-one", (event) => {
			if (event.event === "settings.changed") {
				events.push(JSON.stringify(event.payload));
			}
		});

		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "settings.patch",
				requestId: "req-1",
				clientId: "client-one",
				payload: {
					type: "mcp",
					name: "docs",
					enabled: false,
				},
			});

			expect(reply).toMatchObject({
				ok: true,
				payload: {
					snapshot,
					changedTypes: ["mcp"],
				},
			});
			expect(settingsService.patch).toHaveBeenCalledWith({
				type: "mcp",
				name: "docs",
				enabled: false,
			});
			expect(events).toHaveLength(1);
			expect(JSON.parse(events[0] ?? "{}")).toMatchObject({
				types: ["mcp"],
				snapshot,
			});
		} finally {
			unsubscribe();
			await transport.stop();
		}
	});

	it("rejects malformed settings.toggle payloads before calling settings", async () => {
		const settingsService = {
			toggle: vi.fn(),
		} as unknown as CoreSettingsService;
		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			settingsService,
		});

		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "settings.toggle",
				requestId: "req-1",
				clientId: "client-one",
				payload: {
					type: "skillz",
				},
			});

			expect(reply).toMatchObject({
				ok: false,
				error: {
					code: "settings_toggle_failed",
				},
			});
			expect(reply.error?.message).toContain("settings.toggle payload 'type'");
			expect(settingsService.toggle).not.toHaveBeenCalled();
		} finally {
			await transport.stop();
		}
	});

	it("rejects malformed settings.list payloads before calling settings", async () => {
		const settingsService = {
			list: vi.fn(),
		} as unknown as CoreSettingsService;
		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			settingsService,
		});

		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "settings.list",
				requestId: "req-1",
				clientId: "client-one",
				payload: {
					workspaceRoot: false,
				},
			});

			expect(reply).toMatchObject({
				ok: false,
				error: {
					code: "settings_list_failed",
				},
			});
			expect(reply.error?.message).toContain("workspaceRoot");
			expect(settingsService.list).not.toHaveBeenCalled();
		} finally {
			await transport.stop();
		}
	});

	it("rejects malformed settings.get payloads before calling settings", async () => {
		const settingsService = {
			get: vi.fn(),
		} as unknown as CoreSettingsService;
		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			settingsService,
		});

		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "settings.get",
				requestId: "req-1",
				clientId: "client-one",
				payload: {
					type: "mcp",
				},
			});

			expect(reply).toMatchObject({
				ok: false,
				error: {
					code: "settings_get_failed",
				},
			});
			expect(reply.error?.message).toContain("requires id, path, or name");
			expect(settingsService.get).not.toHaveBeenCalled();
		} finally {
			await transport.stop();
		}
	});

	it("rejects malformed settings.patch payloads before calling settings", async () => {
		const settingsService = {
			patch: vi.fn(),
		} as unknown as CoreSettingsService;
		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			settingsService,
		});

		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "settings.patch",
				requestId: "req-1",
				clientId: "client-one",
				payload: {
					type: "mcp",
					name: "docs",
				},
			});

			expect(reply).toMatchObject({
				ok: false,
				error: {
					code: "settings_patch_failed",
				},
			});
			expect(reply.error?.message).toContain("'enabled'");
			expect(settingsService.patch).not.toHaveBeenCalled();
		} finally {
			await transport.stop();
		}
	});
});
