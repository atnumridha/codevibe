import { describe, expect, it } from "vitest";
import { safeParseSettings, toProviderConfig } from "./provider-settings";

describe("provider settings", () => {
	it("accepts the Bedrock apikey authentication alias", () => {
		const result = safeParseSettings({
			provider: "bedrock",
			model: "anthropic.claude-sonnet-4-5-20250929-v1:0",
			aws: {
				authentication: "apikey",
				region: "us-east-1",
			},
		});

		expect(result.success).toBe(true);
		if (!result.success) {
			throw new Error("expected Bedrock apikey settings to parse");
		}

		expect(toProviderConfig(result.data).aws).toEqual(
			expect.objectContaining({
				authentication: "apikey",
			}),
		);
	});

	it("maps OpenAI Codex auth clientVersion into provider options", () => {
		const result = safeParseSettings({
			provider: "openai-codex",
			model: "gpt-5.5",
			auth: {
				accessToken: "access-token",
				refreshToken: "refresh-token",
				accountId: "acct_123",
				installationId: "install_123",
				clientVersion: "0.136.0-test",
				tokenSource: "codex-home",
				authMode: "chatgpt",
			},
		});

		expect(result.success).toBe(true);
		if (!result.success) {
			throw new Error("expected OpenAI Codex settings to parse");
		}

		expect(toProviderConfig(result.data)).toMatchObject({
			providerId: "openai-codex",
			modelId: "gpt-5.5",
			codex: {
				clientVersion: "0.136.0-test",
				accountId: "acct_123",
				installationId: "install_123",
				tokenSource: "codex-home",
				authMode: "chatgpt",
			},
		});
	});
});
