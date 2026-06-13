import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderSettings } from "@cline/core";
import { afterEach, describe, expect, it } from "vitest";
import { isProviderSettingsUsable } from "./provider-readiness";

const ORIGINAL_CODEX_HOME = process.env.CODEX_HOME;
const tempRoots: string[] = [];

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
		`codevibe-cli-codex-home-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	tempRoots.push(root);
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

function createWorkspaceCodexAuth(): string {
	const root = join(
		tmpdir(),
		`codevibe-cli-codex-workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	tempRoots.push(root);
	mkdirSync(join(root, ".codex"), { recursive: true });
	const accessToken = makeJwt({
		exp: Math.floor(Date.now() / 1000) + 3600,
		email: "workspace-codex@example.com",
		"https://api.openai.com/auth": {
			chatgpt_account_id: "acct_workspace_codex",
		},
	});
	writeFileSync(
		join(root, ".codex", "auth.json"),
		JSON.stringify({
			tokens: {
				access_token: accessToken,
				refresh_token: "workspace-refresh-secret",
			},
		}),
		"utf8",
	);
	return root;
}

describe("provider readiness", () => {
	afterEach(() => {
		for (const tempRoot of tempRoots.splice(0)) {
			rmSync(tempRoot, { recursive: true, force: true });
		}
		if (ORIGINAL_CODEX_HOME === undefined) {
			delete process.env.CODEX_HOME;
		} else {
			process.env.CODEX_HOME = ORIGINAL_CODEX_HOME;
		}
	});

	it("rejects missing and mismatched provider settings", () => {
		expect(isProviderSettingsUsable("anthropic", undefined)).toBe(false);
		expect(
			isProviderSettingsUsable("anthropic", {
				provider: "openai-native",
				apiKey: "sk-test",
			} satisfies ProviderSettings),
		).toBe(false);
	});

	it("requires usable OAuth credentials for OAuth providers", () => {
		expect(
			isProviderSettingsUsable("cline", {
				provider: "cline",
				model: "claude-sonnet-4-6",
			} satisfies ProviderSettings),
		).toBe(false);
		expect(
			isProviderSettingsUsable("cline", {
				provider: "cline",
				auth: { accessToken: "token" },
			} satisfies ProviderSettings),
		).toBe(true);
	});

	it("accepts Codex Home auth for ChatGPT for Codie without saved provider settings", () => {
		process.env.CODEX_HOME = createCodexHomeAuth();

		expect(isProviderSettingsUsable("openai-codex", undefined)).toBe(true);
		expect(
			isProviderSettingsUsable("openai-codex", {
				provider: "openai-codex",
				model: "gpt-5.3-codex",
			} satisfies ProviderSettings),
		).toBe(true);
	});

	it("accepts workspace .codex auth for ChatGPT for Codie readiness", () => {
		const workspaceRoot = createWorkspaceCodexAuth();

		expect(
			isProviderSettingsUsable("openai-codex", undefined, undefined, {
				workspaceRoots: [workspaceRoot],
			}),
		).toBe(true);
		expect(
			isProviderSettingsUsable(
				"openai-codex",
				{
					provider: "openai-codex",
					model: "gpt-5.3-codex",
				} satisfies ProviderSettings,
				undefined,
				{ workspaceRoots: [workspaceRoot] },
			),
		).toBe(true);
	});

	it("ignores malformed Codex Home auth when checking provider readiness", () => {
		const root = join(tmpdir(), `codevibe-cli-codex-home-${Date.now()}-bad`);
		mkdirSync(root, { recursive: true });
		writeFileSync(join(root, "auth.json"), "{not json", "utf8");
		process.env.CODEX_HOME = root;

		expect(isProviderSettingsUsable("openai-codex", undefined)).toBe(false);
	});

	it("accepts manual API keys for API-key providers", () => {
		expect(
			isProviderSettingsUsable("anthropic", {
				provider: "anthropic",
				model: "claude-sonnet-4-6",
			} satisfies ProviderSettings),
		).toBe(false);
		expect(
			isProviderSettingsUsable("anthropic", {
				provider: "anthropic",
				apiKey: "sk-ant-test",
			} satisfies ProviderSettings),
		).toBe(true);
	});

	it("accepts saved local auth providers without an API key", () => {
		expect(
			isProviderSettingsUsable("openai-codex-cli", {
				provider: "openai-codex-cli",
			} satisfies ProviderSettings),
		).toBe(true);
	});

	it("accepts keyless local providers with a resolved endpoint and model", () => {
		expect(
			isProviderSettingsUsable(
				"ollama",
				{
					provider: "ollama",
					model: "llama3.2",
				} satisfies ProviderSettings,
				{
					baseUrl: "http://localhost:11434/v1",
					modelId: "llama3.2",
				},
			),
		).toBe(true);
	});

	it("rejects keyless local providers without a selected model", () => {
		expect(
			isProviderSettingsUsable(
				"ollama",
				{
					provider: "ollama",
				} satisfies ProviderSettings,
				{
					baseUrl: "http://localhost:11434/v1",
					modelId: "",
				},
			),
		).toBe(false);
	});

	it("accepts provider-specific cloud credentials", () => {
		expect(
			isProviderSettingsUsable("bedrock", {
				provider: "bedrock",
				aws: { profile: "default" },
			} satisfies ProviderSettings),
		).toBe(false);
		expect(
			isProviderSettingsUsable("bedrock", {
				provider: "bedrock",
				apiKey: "bedrock-api-key",
			} satisfies ProviderSettings),
		).toBe(false);
		expect(
			isProviderSettingsUsable("bedrock", {
				provider: "bedrock",
				apiKey: "bedrock-api-key",
				aws: { region: "us-east-1", authentication: "api-key" },
			} satisfies ProviderSettings),
		).toBe(true);
		expect(
			isProviderSettingsUsable("bedrock", {
				provider: "bedrock",
				aws: { profile: "default", region: "us-west-2" },
			} satisfies ProviderSettings),
		).toBe(true);
		expect(
			isProviderSettingsUsable("bedrock", {
				provider: "bedrock",
				aws: { authentication: "iam", region: "us-east-1" },
			} satisfies ProviderSettings),
		).toBe(true);
		expect(
			isProviderSettingsUsable("bedrock", {
				provider: "bedrock",
				region: "us-east-1",
				aws: { authentication: "iam" },
			} satisfies ProviderSettings),
		).toBe(true);
		expect(
			isProviderSettingsUsable("bedrock", {
				provider: "bedrock",
				aws: { authentication: "profile", region: "us-east-1" },
			} satisfies ProviderSettings),
		).toBe(true);
		expect(
			isProviderSettingsUsable("bedrock", {
				provider: "bedrock",
				aws: { accessKey: "access", secretKey: "secret", region: "us-east-1" },
			} satisfies ProviderSettings),
		).toBe(true);
		expect(
			isProviderSettingsUsable("vertex", {
				provider: "vertex",
				gcp: { projectId: "test-project" },
			} satisfies ProviderSettings),
		).toBe(true);
		expect(
			isProviderSettingsUsable("sapaicore", {
				provider: "sapaicore",
				baseUrl: "https://api.ai.example.invalid",
				sap: {
					clientId: "client",
					clientSecret: "secret",
					tokenUrl: "https://example.com/token",
				},
			} satisfies ProviderSettings),
		).toBe(true);
		expect(
			isProviderSettingsUsable("sapaicore", {
				provider: "sapaicore",
				sap: {
					clientId: "client",
					clientSecret: "secret",
					tokenUrl: "https://example.com/token",
				},
			} satisfies ProviderSettings),
		).toBe(false);
	});
});
