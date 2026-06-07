import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderSettingsManager } from "../services/storage/provider-settings-manager";
import { createLocalHubScheduleRuntimeHandlers } from "./daemon/runtime-handlers";
import { HubServerTransport } from "./server";

function toBase64Url(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}

function createJwt(payload: Record<string, unknown>): string {
	return `${toBase64Url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${toBase64Url(JSON.stringify(payload))}.sig`;
}

describe("hub current account command", () => {
	const tempDirs: string[] = [];
	const previousCodexHome = process.env.CODEX_HOME;
	const previousProviderSettingsPath = process.env.CLINE_PROVIDER_SETTINGS_PATH;

	afterEach(() => {
		if (previousCodexHome === undefined) {
			delete process.env.CODEX_HOME;
		} else {
			process.env.CODEX_HOME = previousCodexHome;
		}
		if (previousProviderSettingsPath === undefined) {
			delete process.env.CLINE_PROVIDER_SETTINGS_PATH;
		} else {
			process.env.CLINE_PROVIDER_SETTINGS_PATH = previousProviderSettingsPath;
		}
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reports Codex-home auth metadata without exposing tokens", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-hub-account-"));
		tempDirs.push(root);
		const codexHome = join(root, ".codex");
		mkdirSync(codexHome, { recursive: true });
		process.env.CODEX_HOME = codexHome;
		const providerSettingsPath = join(root, "provider-settings.json");
		process.env.CLINE_PROVIDER_SETTINGS_PATH = providerSettingsPath;

		const accessToken = createJwt({
			exp: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
			"https://api.openai.com/auth": { chatgpt_account_id: "acct_home" },
		});
		const idToken = createJwt({
			email: "codex@example.com",
			"https://api.openai.com/auth": { chatgpt_account_id: "acct_home" },
		});
		writeFileSync(
			join(codexHome, "auth.json"),
			JSON.stringify(
				{
					tokens: {
						access_token: accessToken,
						refresh_token: "refresh-secret",
						id_token: idToken,
					},
					auth_mode: "chatgpt",
				},
				null,
				2,
			),
			"utf8",
		);
		writeFileSync(join(codexHome, "installation_id"), "install_home\n", "utf8");
		writeFileSync(
			join(codexHome, "models_cache.json"),
			JSON.stringify({ client_version: "0.136.0-home" }),
			"utf8",
		);

		new ProviderSettingsManager({ filePath: providerSettingsPath }).saveProviderSettings(
			{
				provider: "openai-codex",
				model: "gpt-5.4",
				apiKey: "stored-access-secret",
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
				command: "cline.account.get_current",
				requestId: "req-account",
				clientId: "client-one",
				payload: {},
			});

			expect(reply).toMatchObject({
				ok: true,
				payload: {
					providerId: "openai-codex",
					modelId: "gpt-5.4",
					providerSource: "provider-settings",
					codex: {
						authSource: "codex-home",
						authenticated: true,
						tokenSource: "codex-home",
						accountId: "acct_home",
						email: "codex@example.com",
						expired: false,
						installationId: "install_home",
						clientVersion: "0.136.0-home",
						authMode: "chatgpt",
					},
				},
			});
			expect(JSON.stringify(reply)).not.toContain(accessToken);
			expect(JSON.stringify(reply)).not.toContain("refresh-secret");
			expect(JSON.stringify(reply)).not.toContain(idToken);
			expect(JSON.stringify(reply)).not.toContain("stored-access-secret");
		} finally {
			await transport.stop();
		}
	});

	it("falls back to the Codex default when no account files exist", async () => {
		const root = mkdtempSync(join(tmpdir(), "cline-hub-account-empty-"));
		tempDirs.push(root);
		process.env.CODEX_HOME = join(root, ".codex");
		process.env.CLINE_PROVIDER_SETTINGS_PATH = join(root, "provider-settings.json");

		const transport = new HubServerTransport({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
			scheduleOptions: { dbPath: join(root, "schedule.db") },
		});

		try {
			const reply = await transport.handleCommand({
				version: "v1",
				command: "cline.account.get_current",
				requestId: "req-account-empty",
				clientId: "client-one",
				payload: {},
			});

			expect(reply).toMatchObject({
				ok: true,
				payload: {
					providerId: "openai-codex",
					providerSource: "default",
					codex: {
						authSource: "codex-home",
						authenticated: false,
					},
				},
			});
			expect(
				(reply.payload as { modelId?: unknown } | undefined)?.modelId,
			).toEqual(expect.any(String));
		} finally {
			await transport.stop();
		}
	});
});
