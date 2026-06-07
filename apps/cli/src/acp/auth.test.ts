import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderSettings, ProviderSettingsManager } from "@cline/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	authenticateAcpProvider,
	restoreOpenAICodexHomeAcpAuth,
} from "./auth";

vi.mock("../utils/output", () => ({
	writeDiagnostic: vi.fn(),
}));

const ORIGINAL_CODEX_HOME = process.env.CODEX_HOME;

function makeJwt(payload: Record<string, unknown>): string {
	return [
		Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
		Buffer.from(JSON.stringify(payload)).toString("base64url"),
		"signature",
	].join(".");
}

function createCodexHomeAuth(): string {
	const root = join(
		tmpdir(),
		`codevibe-cli-acp-codex-home-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(root, { recursive: true });
	const accessToken = makeJwt({
		exp: Math.floor(Date.now() / 1000) + 3600,
		email: "codex@example.com",
		"https://api.openai.com/auth": {
			chatgpt_account_id: "acct_codex_home",
		},
	});
	writeFileSync(
		join(root, "auth.json"),
		JSON.stringify({
			tokens: {
				access_token: accessToken,
				refresh_token: "refresh-secret",
			},
		}),
		"utf8",
	);
	writeFileSync(join(root, "installation_id"), "install_acp\n", "utf8");
	return root;
}

function createProviderSettingsManager(): ProviderSettingsManager & {
	getProviderSettings: ReturnType<typeof vi.fn>;
	saveProviderSettings: ReturnType<typeof vi.fn>;
	saved?: ProviderSettings;
} {
	const manager = {
		saved: undefined as ProviderSettings | undefined,
		getProviderSettings: vi.fn(() => manager.saved),
		saveProviderSettings: vi.fn((settings: ProviderSettings) => {
			manager.saved = settings;
		}),
	};
	return manager as unknown as ProviderSettingsManager & {
		getProviderSettings: ReturnType<typeof vi.fn>;
		saveProviderSettings: ReturnType<typeof vi.fn>;
		saved?: ProviderSettings;
	};
}

describe("ACP auth", () => {
	afterEach(() => {
		if (process.env.CODEX_HOME?.includes("codevibe-cli-acp-codex-home-")) {
			rmSync(process.env.CODEX_HOME, { recursive: true, force: true });
		}
		if (ORIGINAL_CODEX_HOME === undefined) {
			delete process.env.CODEX_HOME;
		} else {
			process.env.CODEX_HOME = ORIGINAL_CODEX_HOME;
		}
	});

	it("restores OpenAI Codex auth from Codex Home and preserves metadata", () => {
		process.env.CODEX_HOME = createCodexHomeAuth();
		const manager = createProviderSettingsManager();

		const result = restoreOpenAICodexHomeAcpAuth(manager);

		expect(result).toMatchObject({
			providerId: "openai-codex",
			apiKey: expect.any(String),
		});
		expect(manager.saveProviderSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "openai-codex",
				auth: expect.objectContaining({
					accessToken: result?.apiKey,
					refreshToken: "refresh-secret",
					accountId: "acct_codex_home",
					installationId: "install_acp",
					tokenSource: "codex-home",
				}),
			}),
			{ tokenSource: "oauth" },
		);
	});

	it("uses Codex Home credentials before opening OAuth in ACP auth", async () => {
		process.env.CODEX_HOME = createCodexHomeAuth();
		const manager = createProviderSettingsManager();

		const result = await authenticateAcpProvider("openai-codex", manager);

		expect(result.providerId).toBe("openai-codex");
		expect(manager.saveProviderSettings).toHaveBeenCalledTimes(1);
	});
});
