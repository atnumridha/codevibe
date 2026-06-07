import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderSettingsManager } from "../services/storage/provider-settings-manager";
import { createLocalHubScheduleRuntimeHandlers } from "./daemon/runtime-handlers";
import { HubServerTransport } from "./server";

describe("hub catalog.list command", () => {
	const tempDirs: string[] = [];
	const previousProviderSettingsPath = process.env.CLINE_PROVIDER_SETTINGS_PATH;

	afterEach(() => {
		if (previousProviderSettingsPath === undefined) {
			delete process.env.CLINE_PROVIDER_SETTINGS_PATH;
		} else {
			process.env.CLINE_PROVIDER_SETTINGS_PATH = previousProviderSettingsPath;
		}
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns an offline model catalog with Codex as the default provider", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-hub-catalog-"));
		tempDirs.push(root);
		const providerSettingsPath = join(root, "provider-settings.json");
		process.env.CLINE_PROVIDER_SETTINGS_PATH = providerSettingsPath;
		new ProviderSettingsManager({ filePath: providerSettingsPath }).saveProviderSettings(
			{
				provider: "openai-codex",
				model: "gpt-5.4",
				apiKey: "catalog-secret",
			},
			{ tokenSource: "oauth" },
		);

		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: join(root, "schedule.db") },
		});

		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "catalog.list",
				requestId: "req-catalog",
				clientId: "client-one",
				payload: {},
			});
			expect(reply).toMatchObject({
				ok: true,
				payload: {
					catalog: {
						defaultSelection: {
							providerId: "openai-codex",
							modelId: "gpt-5.4",
						},
					},
				},
			});
			const catalog = (reply.payload as { catalog?: Record<string, unknown> })
				.catalog;
			const providers = catalog?.providers as
				| Array<Record<string, unknown>>
				| undefined;
			const codexProvider = providers?.find(
				(provider) => provider.id === "openai-codex",
			);
			expect(codexProvider).toMatchObject({
				id: "openai-codex",
				enabled: true,
				defaultModelId: "gpt-5.4",
			});
			const modelsByProvider = catalog?.modelsByProvider as
				| Record<string, Array<Record<string, unknown>>>
				| undefined;
			expect(
				modelsByProvider?.["openai-codex"]?.some(
					(model) => model.id === "gpt-5.4",
				),
			).toBe(true);
			expect(JSON.stringify(reply)).not.toContain("catalog-secret");
		} finally {
			await transport.stop();
		}
	});

	it("uses Codex defaults when no provider settings exist", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-hub-catalog-empty-"));
		tempDirs.push(root);
		process.env.CLINE_PROVIDER_SETTINGS_PATH = join(root, "provider-settings.json");

		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: join(root, "schedule.db") },
		});

		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "catalog.list",
				requestId: "req-catalog-empty",
				clientId: "client-one",
				payload: {},
			});
			expect(reply).toMatchObject({
				ok: true,
				payload: {
					catalog: {
						defaultSelection: {
							providerId: "openai-codex",
						},
					},
				},
			});
			expect(
				(
					(reply.payload as {
						catalog?: { defaultSelection?: { modelId?: unknown } };
					}).catalog?.defaultSelection?.modelId
				),
			).toEqual(expect.any(String));
		} finally {
			await transport.stop();
		}
	});
});
