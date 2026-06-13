import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderSettings } from "@cline/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockGetLastUsedProviderSettings,
	mockGetProviderSettings,
	mockResolveSystemPrompt,
	mockGetProviderCollection,
} = vi.hoisted(() => ({
	mockGetLastUsedProviderSettings: vi.fn(),
	mockGetProviderSettings: vi.fn(),
	mockResolveSystemPrompt: vi.fn(),
	mockGetProviderCollection: vi.fn(),
}));

vi.mock("@cline/core", async () => {
	const actual =
		await vi.importActual<typeof import("@cline/core")>("@cline/core");
	return {
		...actual,
		ProviderSettingsManager: class {
			getLastUsedProviderSettings() {
				return mockGetLastUsedProviderSettings();
			}

			getProviderSettings(providerId: string) {
				return mockGetProviderSettings(providerId);
			}
		},
		CoreSessionService: class {},
		SqliteSessionStore: class {},
		Llms: {
			...actual.Llms,
			getProviderCollection: mockGetProviderCollection,
		},
	};
});

vi.mock("../runtime/prompt", () => ({
	resolveSystemPrompt: mockResolveSystemPrompt,
}));

vi.mock("../utils/helpers", () => ({
	resolveWorkspaceRoot: vi.fn((cwd: string) => cwd),
}));

vi.mock("../commands/auth", async () => {
	const actual =
		await vi.importActual<typeof import("../commands/auth")>(
			"../commands/auth",
		);
	return {
		...actual,
		ensureOAuthProviderApiKey: vi.fn(),
	};
});

import { ensureOAuthProviderApiKey } from "../commands/auth";
import { buildConnectorStartRequest } from "./session-runtime";

const ORIGINAL_CODEX_HOME = process.env.CODEX_HOME;
const mockEnsureOAuthProviderApiKey = vi.mocked(ensureOAuthProviderApiKey);

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
		`codevibe-cli-connector-codex-home-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
	return root;
}

function createMalformedCodexHomeAuth(): string {
	const root = join(
		tmpdir(),
		`codevibe-cli-connector-codex-home-${Date.now()}-bad`,
	);
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, "auth.json"), "{not json", "utf8");
	return root;
}

describe("buildConnectorStartRequest", () => {
	beforeEach(() => {
		mockEnsureOAuthProviderApiKey.mockResolvedValue({
			apiKey: "",
			selectedProviderSettings: undefined,
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
		delete process.env.OPENROUTER_API_KEY;
		if (
			process.env.CODEX_HOME?.includes("codevibe-cli-connector-codex-home-")
		) {
			rmSync(process.env.CODEX_HOME, { recursive: true, force: true });
		}
		if (ORIGINAL_CODEX_HOME === undefined) {
			delete process.env.CODEX_HOME;
		} else {
			process.env.CODEX_HOME = ORIGINAL_CODEX_HOME;
		}
	});

	it("falls back to provider env vars when explicit provider settings have no api key", async () => {
		mockGetProviderSettings.mockReturnValue({
			provider: "openrouter",
			model: "anthropic/claude-sonnet-4.6",
		});
		mockGetProviderCollection.mockReturnValue({
			provider: { env: ["OPENROUTER_API_KEY"] },
		});
		mockResolveSystemPrompt.mockResolvedValue("system");
		process.env.OPENROUTER_API_KEY = "env-openrouter-key";

		const request = await buildConnectorStartRequest({
			options: {
				cwd: "/tmp/work",
				provider: "openrouter",
				mode: "act",
				enableTools: false,
			},
			io: { writeln: vi.fn(), writeErr: vi.fn() },
			loggerConfig: { enabled: false, level: "info", destination: "stdout" },
			systemRules: "Rules",
		});

		expect(request.provider).toBe("openrouter");
		expect(request.apiKey).toBe("env-openrouter-key");
		expect(request.model).toBe("anthropic/claude-sonnet-4.6");
	});

	it("ignores last-used provider when connector provider is omitted", async () => {
		mockGetLastUsedProviderSettings.mockReturnValue({ provider: "openrouter" });
		mockGetProviderSettings.mockReturnValue(undefined);
		mockGetProviderCollection.mockReturnValue({
			provider: { env: [] },
		});
		mockResolveSystemPrompt.mockResolvedValue("system");

		const request = await buildConnectorStartRequest({
			options: {
				cwd: "/tmp/work",
				mode: "act",
				enableTools: false,
			},
			io: { writeln: vi.fn(), writeErr: vi.fn() },
			loggerConfig: { enabled: false, level: "info", destination: "stdout" },
			systemRules: "Rules",
		});

		expect(mockGetProviderSettings).toHaveBeenCalledWith("openai-codex");
		expect(mockGetProviderSettings).not.toHaveBeenCalledWith("openrouter");
		expect(request.provider).toBe("openai-codex");
	});

	it("defaults connector sessions to ChatGPT for Codie when no provider was selected", async () => {
		mockGetLastUsedProviderSettings.mockReturnValue(undefined);
		mockGetProviderSettings.mockReturnValue(undefined);
		mockGetProviderCollection.mockReturnValue({
			provider: { env: [] },
		});
		mockResolveSystemPrompt.mockResolvedValue("system");

		const request = await buildConnectorStartRequest({
			options: {
				cwd: "/tmp/work",
				mode: "plan",
				enableTools: true,
			},
			io: { writeln: vi.fn(), writeErr: vi.fn() },
			loggerConfig: { enabled: false, level: "info", destination: "stdout" },
			systemRules: "Rules",
		});

		expect(mockGetProviderSettings).toHaveBeenCalledWith("openai-codex");
		expect(mockResolveSystemPrompt).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "openai-codex",
			}),
		);
		expect(request.provider).toBe("openai-codex");
		expect(request.model).toBe("gpt-5.5-pro");
		expect(request.apiKey).toBe("");
	});

	it("lets core load Codex Home auth instead of starting OAuth for connector sessions", async () => {
		process.env.CODEX_HOME = createCodexHomeAuth();
		mockGetLastUsedProviderSettings.mockReturnValue(undefined);
		mockGetProviderSettings.mockReturnValue(undefined);
		mockGetProviderCollection.mockReturnValue({
			provider: { env: [] },
		});
		mockResolveSystemPrompt.mockResolvedValue("system");

		const request = await buildConnectorStartRequest({
			options: {
				cwd: "/tmp/work",
				provider: "codex",
				mode: "act",
				enableTools: true,
			},
			io: { writeln: vi.fn(), writeErr: vi.fn() },
			loggerConfig: { enabled: false, level: "info", destination: "stdout" },
			systemRules: "Rules",
		});

		expect(mockEnsureOAuthProviderApiKey).not.toHaveBeenCalled();
		expect(request.provider).toBe("openai-codex");
		expect(request.apiKey).toBe("");
	});

	it("falls back to OAuth when Codex Home auth is malformed", async () => {
		process.env.CODEX_HOME = createMalformedCodexHomeAuth();
		const oauthSettings = {
			provider: "openai-codex",
			model: "gpt-codex-oauth",
		} satisfies ProviderSettings;
		mockEnsureOAuthProviderApiKey.mockResolvedValue({
			apiKey: "oauth-access-token",
			selectedProviderSettings: oauthSettings,
		});
		mockGetLastUsedProviderSettings.mockReturnValue(undefined);
		mockGetProviderSettings.mockReturnValue(undefined);
		mockGetProviderCollection.mockReturnValue({
			provider: { env: [] },
		});
		mockResolveSystemPrompt.mockResolvedValue("system");

		const request = await buildConnectorStartRequest({
			options: {
				cwd: "/tmp/work",
				provider: "openai-codex",
				mode: "act",
				enableTools: true,
			},
			io: { writeln: vi.fn(), writeErr: vi.fn() },
			loggerConfig: { enabled: false, level: "info", destination: "stdout" },
			systemRules: "Rules",
		});

		expect(mockEnsureOAuthProviderApiKey).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "openai-codex",
			}),
		);
		expect(request.model).toBe("gpt-codex-oauth");
		expect(request.apiKey).toBe("oauth-access-token");
	});
});
