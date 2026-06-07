import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	OAuthReauthRequiredError,
	RuntimeOAuthTokenManager,
} from "./runtime-oauth-token-manager";

const {
	getValidOpenAICodexCredentials,
	loadOpenAICodexHomeCredentialsSync,
	getValidClineCredentials,
	getValidOcaCredentials,
} = vi.hoisted(() => ({
	getValidOpenAICodexCredentials: vi.fn(),
	loadOpenAICodexHomeCredentialsSync: vi.fn(),
	getValidClineCredentials: vi.fn(),
	getValidOcaCredentials: vi.fn(),
}));

vi.mock("../../auth/codex", () => ({
	getValidOpenAICodexCredentials,
	loadOpenAICodexHomeCredentialsSync,
}));

vi.mock("../../auth/cline", () => ({
	getValidClineCredentials,
}));

vi.mock("../../auth/oca", () => ({
	getValidOcaCredentials,
}));

describe("RuntimeOAuthTokenManager", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("refreshes and persists OpenAI Codex OAuth credentials", async () => {
		const getProviderSettings = vi.fn().mockReturnValue({
			provider: "openai-codex",
			auth: {
				accessToken: "access-old",
				refreshToken: "refresh-old",
				expiresAt: Date.now() - 1_000,
				accountId: "acct-old",
			},
		});
		const saveProviderSettings = vi.fn();

		getValidOpenAICodexCredentials.mockResolvedValueOnce({
			access: "access-new",
			refresh: "refresh-new",
			expires: 4_000_000_000_000,
			accountId: "acct-new",
		});

		const manager = new RuntimeOAuthTokenManager({
			providerSettingsManager: {
				getProviderSettings,
				saveProviderSettings,
			} as never,
		});

		const result = await manager.resolveProviderApiKey({
			providerId: "openai-codex",
		});

		expect(result).toMatchObject({
			providerId: "openai-codex",
			apiKey: "access-new",
			accountId: "acct-new",
			refreshed: true,
		});
		expect(saveProviderSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				auth: expect.objectContaining({
					accessToken: "access-new",
					refreshToken: "refresh-new",
					accountId: "acct-new",
					expiresAt: 4_000_000_000_000,
				}),
			}),
			{ setLastUsed: false, tokenSource: "oauth" },
		);
	});

	it("refreshes saved Codex-home credentials without dropping local metadata", async () => {
		const getProviderSettings = vi.fn().mockReturnValue({
			provider: "openai-codex",
			auth: {
				accessToken: "access-home-old",
				refreshToken: "refresh-home-old",
				expiresAt: Date.now() - 1_000,
				accountId: "acct-home",
				installationId: "install_home",
				clientVersion: "0.136.0-test",
				tokenSource: "codex-home",
				authMode: "chatgpt",
			},
		});
		const saveProviderSettings = vi.fn();

		getValidOpenAICodexCredentials.mockResolvedValueOnce({
			access: "access-home-new",
			refresh: "refresh-home-new",
			expires: 4_000_000_000_000,
			accountId: "acct-home",
		});

		const manager = new RuntimeOAuthTokenManager({
			providerSettingsManager: {
				getProviderSettings,
				saveProviderSettings,
			} as never,
		});

		const result = await manager.resolveProviderApiKey({
			providerId: "openai-codex",
		});

		expect(result).toMatchObject({
			providerId: "openai-codex",
			apiKey: "access-home-new",
			accountId: "acct-home",
			codex: {
				accountId: "acct-home",
				installationId: "install_home",
				clientVersion: "0.136.0-test",
				tokenSource: "codex-home",
				authMode: "chatgpt",
			},
			refreshed: true,
		});
		expect(getValidOpenAICodexCredentials).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({
					installationId: "install_home",
					clientVersion: "0.136.0-test",
					tokenSource: "codex-home",
					authMode: "chatgpt",
				}),
			}),
			expect.any(Object),
		);
		expect(saveProviderSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				auth: expect.objectContaining({
					accessToken: "access-home-new",
					refreshToken: "refresh-home-new",
					accountId: "acct-home",
					expiresAt: 4_000_000_000_000,
					installationId: "install_home",
					clientVersion: "0.136.0-test",
					tokenSource: "codex-home",
					authMode: "chatgpt",
				}),
			}),
			{ setLastUsed: false, tokenSource: "oauth" },
		);
	});

	it("imports Codex Home credentials when no OpenAI Codex settings exist", async () => {
		const getProviderSettings = vi.fn().mockReturnValue(undefined);
		const saveProviderSettings = vi.fn();
		loadOpenAICodexHomeCredentialsSync.mockReturnValueOnce({
			access: "access-home",
			refresh: "refresh-home",
			expires: 4_000_000_000_000,
			accountId: "acct-home",
			metadata: {
				provider: "openai-codex",
				installationId: "install_home",
				clientVersion: "0.136.0-test",
				tokenSource: "codex-home",
				authMode: "chatgpt",
			},
		});
		getValidOpenAICodexCredentials.mockImplementationOnce(
			async (credentials) => credentials,
		);

		const manager = new RuntimeOAuthTokenManager({
			providerSettingsManager: {
				getProviderSettings,
				saveProviderSettings,
			} as never,
		});

		const result = await manager.resolveProviderApiKey({
			providerId: "openai-codex",
		});

		expect(result).toMatchObject({
			providerId: "openai-codex",
			apiKey: "access-home",
			accountId: "acct-home",
			codex: {
				accountId: "acct-home",
				installationId: "install_home",
				clientVersion: "0.136.0-test",
				tokenSource: "codex-home",
				authMode: "chatgpt",
			},
			refreshed: false,
		});
		expect(saveProviderSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "openai-codex",
				auth: expect.objectContaining({
					accessToken: "access-home",
					refreshToken: "refresh-home",
					accountId: "acct-home",
					expiresAt: 4_000_000_000_000,
					installationId: "install_home",
					clientVersion: "0.136.0-test",
					tokenSource: "codex-home",
					authMode: "chatgpt",
				}),
			}),
			{ setLastUsed: false, tokenSource: "oauth" },
		);
	});

	it("throws re-auth required when refresh returns null", async () => {
		getValidOpenAICodexCredentials.mockResolvedValueOnce(null);
		const manager = new RuntimeOAuthTokenManager({
			providerSettingsManager: {
				getProviderSettings: vi.fn().mockReturnValue({
					provider: "openai-codex",
					auth: {
						accessToken: "access-old",
						refreshToken: "refresh-old",
						expiresAt: Date.now() - 1_000,
					},
				}),
				saveProviderSettings: vi.fn(),
			} as never,
		});

		await expect(
			manager.resolveProviderApiKey({ providerId: "openai-codex" }),
		).rejects.toBeInstanceOf(OAuthReauthRequiredError);
	});

	it("de-duplicates concurrent refresh calls per provider", async () => {
		const refreshBarrier = Promise.resolve().then(() => ({
			access: "access-new",
			refresh: "refresh-new",
			expires: Date.now() + 60_000,
		}));
		getValidOpenAICodexCredentials.mockImplementationOnce(
			async () => refreshBarrier,
		);

		const manager = new RuntimeOAuthTokenManager({
			providerSettingsManager: {
				getProviderSettings: vi.fn().mockReturnValue({
					provider: "openai-codex",
					auth: {
						accessToken: "access-old",
						refreshToken: "refresh-old",
						expiresAt: Date.now() - 1_000,
					},
				}),
				saveProviderSettings: vi.fn(),
			} as never,
		});

		const [first, second] = await Promise.all([
			manager.resolveProviderApiKey({ providerId: "openai-codex" }),
			manager.resolveProviderApiKey({ providerId: "openai-codex" }),
		]);

		expect(first?.apiKey).toBe("access-new");
		expect(second?.apiKey).toBe("access-new");
		expect(getValidOpenAICodexCredentials).toHaveBeenCalledTimes(1);
	});
});
