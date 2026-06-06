import { afterEach, describe, expect, it, vi } from "vitest";

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

import { buildConnectorStartRequest } from "./session-runtime";

describe("buildConnectorStartRequest", () => {
	afterEach(() => {
		vi.clearAllMocks();
		delete process.env.OPENROUTER_API_KEY;
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

	it("defaults connector sessions to OpenAI Codex when no provider was selected", async () => {
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
		expect(request.model).toBe("gpt-5.5");
		expect(request.apiKey).toBe("");
	});
});
