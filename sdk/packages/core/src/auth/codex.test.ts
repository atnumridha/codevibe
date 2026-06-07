import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createAuthorizationFlow,
	getValidOpenAICodexCredentials,
	loadOpenAICodexHomeCredentialsSync,
	normalizeOpenAICodexCredentials,
	refreshOpenAICodexToken,
} from "./codex";
import type { OAuthCredentials } from "./types";

function toBase64Url(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}

function createJwt(payload: Record<string, unknown>): string {
	return `${toBase64Url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${toBase64Url(JSON.stringify(payload))}.sig`;
}

function createCredentials(
	overrides: Partial<OAuthCredentials> = {},
): OAuthCredentials {
	return {
		access: "access-old",
		refresh: "refresh-old",
		expires: 0,
		accountId: "acct-old",
		email: "old@example.com",
		metadata: { provider: "openai-codex" },
		...overrides,
	};
}

describe("auth/codex token lifecycle", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("uses the Cline Codex originator in authorization URLs by default", async () => {
		const flow = await createAuthorizationFlow();
		const url = new URL(flow.url);

		expect(url.searchParams.get("originator")).toBe("cline");
		expect(url.searchParams.get("codex_cli_simplified_flow")).toBe("true");
		expect(url.searchParams.get("id_token_add_organizations")).toBe("true");
	});

	it("returns current credentials when not expired", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
		const current = createCredentials({ expires: 400_000 });
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const result = await getValidOpenAICodexCredentials(current);
		expect(result).toBe(current);
		expect(fetchMock).not.toHaveBeenCalled();
		nowSpy.mockRestore();
	});

	it("refreshes expired credentials and preserves provider metadata", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		const idToken = createJwt({
			"https://api.openai.com/auth": { chatgpt_account_id: "acct-new" },
			email: "new@example.com",
		});
		const accessToken = createJwt({
			"https://api.openai.com/auth": { chatgpt_account_id: "acct-new" },
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							access_token: accessToken,
							refresh_token: "refresh-new",
							expires_in: 3600,
							email: "new@example.com",
							id_token: idToken,
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					),
			),
		);

		const current = createCredentials({ expires: 110_000 });
		const result = await getValidOpenAICodexCredentials(current);
		expect(result).toMatchObject({
			access: accessToken,
			refresh: "refresh-new",
			accountId: "acct-new",
			email: "new@example.com",
			metadata: { provider: "openai-codex" },
		});
		nowSpy.mockRestore();
	});

	it("returns null on invalid_grant refresh errors", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							error: "invalid_grant",
							error_description: "token revoked",
						}),
						{
							status: 400,
							headers: { "Content-Type": "application/json" },
						},
					),
			),
		);

		const result = await getValidOpenAICodexCredentials(
			createCredentials({ expires: 120_000 }),
		);
		expect(result).toBeNull();
		nowSpy.mockRestore();
	});

	it("redacts refresh tokens from refresh error messages", async () => {
		const refreshToken = "secret-refresh-token";
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							error: "server_error",
							error_description: `upstream echoed ${refreshToken}`,
						}),
						{
							status: 500,
							headers: { "Content-Type": "application/json" },
						},
					),
			),
		);

		try {
			await refreshOpenAICodexToken(refreshToken);
			throw new Error("Expected refreshOpenAICodexToken to fail");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			expect(message).toContain("[REDACTED]");
			expect(message).not.toContain(refreshToken);
			expect(message).not.toContain("error_description");
		}
	});

	it("keeps current credentials on non-invalid transient refresh failures when still valid", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							error: "server_error",
							error_description: "try again",
						}),
						{
							status: 500,
							headers: { "Content-Type": "application/json" },
						},
					),
			),
		);

		const current = createCredentials({ expires: 150_000 });
		const result = await getValidOpenAICodexCredentials(current, {
			refreshBufferMs: 60_000,
			retryableTokenGraceMs: 30_000,
		});
		expect(result).toBe(current);
		nowSpy.mockRestore();
	});

	it("normalizes credentials by deriving accountId from access token", () => {
		const accessToken = createJwt({
			"https://api.openai.com/auth": { chatgpt_account_id: "acct-derived" },
		});
		const normalized = normalizeOpenAICodexCredentials({
			access: accessToken,
			refresh: "refresh",
			expires: 1,
		});
		expect(normalized.accountId).toBe("acct-derived");
		expect(normalized.metadata).toMatchObject({ provider: "openai-codex" });
	});

	it("prefers access-token ChatGPT account claims over id-token organizations", () => {
		const accessToken = createJwt({
			"https://api.openai.com/auth": { chatgpt_account_id: "acct-access" },
		});
		const idToken = createJwt({
			organizations: [{ id: "org-from-id-token" }],
		});

		const normalized = normalizeOpenAICodexCredentials({
			access: accessToken,
			refresh: "refresh",
			expires: 1,
			metadata: { idToken },
		});

		expect(normalized.accountId).toBe("acct-access");
		expect(normalized.metadata).not.toHaveProperty("idToken");
	});

	it("loads Codex home credentials with installation and client metadata", () => {
		const codexHome = mkdtempSync(join(tmpdir(), "cline-codex-home-"));
		tempDirs.push(codexHome);
		const accessToken = createJwt({
			exp: 2_000,
			email: "codex@example.com",
			"https://api.openai.com/auth": { chatgpt_account_id: "acct-home" },
		});
		const idToken = createJwt({
			email: "id@example.com",
			organizations: [{ id: "org-id" }],
		});
		writeFileSync(
			join(codexHome, "auth.json"),
			JSON.stringify({
				auth_mode: "chatgpt",
				tokens: {
					access_token: accessToken,
					refresh_token: "refresh-home",
					id_token: idToken,
				},
			}),
			"utf8",
		);
		writeFileSync(join(codexHome, "installation_id"), "install_123\n", "utf8");
		writeFileSync(
			join(codexHome, "models_cache.json"),
			JSON.stringify({ client_version: "0.136.0-test" }),
			"utf8",
		);

		const credentials = loadOpenAICodexHomeCredentialsSync({ codexHome });

		expect(credentials).toMatchObject({
			access: accessToken,
			refresh: "refresh-home",
			expires: 2_000_000,
			accountId: "acct-home",
			email: "id@example.com",
			metadata: {
				provider: "openai-codex",
				tokenSource: "codex-home",
				installationId: "install_123",
				clientVersion: "0.136.0-test",
				authMode: "chatgpt",
			},
		});
		expect(credentials?.metadata).not.toHaveProperty("idToken");
	});

	it("loads Codex home credentials when optional models cache is malformed", () => {
		const codexHome = mkdtempSync(join(tmpdir(), "cline-codex-home-"));
		tempDirs.push(codexHome);
		const accessToken = createJwt({
			exp: 2_000,
			email: "codex@example.com",
		});
		writeFileSync(
			join(codexHome, "auth.json"),
			JSON.stringify({
				tokens: {
					access_token: accessToken,
					refresh_token: "refresh-home",
				},
			}),
			"utf8",
		);
		writeFileSync(join(codexHome, "models_cache.json"), "{not json", "utf8");

		const credentials = loadOpenAICodexHomeCredentialsSync({ codexHome });

		expect(credentials).toMatchObject({
			access: accessToken,
			refresh: "refresh-home",
			metadata: {
				provider: "openai-codex",
				tokenSource: "codex-home",
			},
		});
		expect(credentials?.metadata).not.toHaveProperty("clientVersion");
	});

	it("uses Codex home token account_id before id-token organization fallbacks", () => {
		const codexHome = mkdtempSync(join(tmpdir(), "cline-codex-home-"));
		tempDirs.push(codexHome);
		const accessToken = createJwt({
			exp: 2_000,
			email: "codex@example.com",
		});
		const idToken = createJwt({
			organizations: [{ id: "org-from-id-token" }],
		});
		writeFileSync(
			join(codexHome, "auth.json"),
			JSON.stringify({
				tokens: {
					access_token: accessToken,
					refresh_token: "refresh-home",
					id_token: idToken,
					account_id: "acct-from-file",
				},
			}),
			"utf8",
		);

		const credentials = loadOpenAICodexHomeCredentialsSync({ codexHome });

		expect(credentials).toMatchObject({
			accountId: "acct-from-file",
			metadata: {
				provider: "openai-codex",
				tokenSource: "codex-home",
			},
		});
	});

	it("refreshOpenAICodexToken throws when response is structurally invalid", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ access_token: "only-access" }), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					}),
			),
		);

		await expect(refreshOpenAICodexToken("refresh")).rejects.toThrow(
			"Failed to refresh OpenAI Codex token",
		);
	});
});
