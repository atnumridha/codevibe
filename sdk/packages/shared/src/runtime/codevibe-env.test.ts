import { describe, expect, it } from "vitest";
import {
	codeVibeEnvName,
	isCodeVibeEnvEnabled,
	legacyClineEnvName,
	readCodeVibeEnv,
} from "./codevibe-env";

describe("CodeVibe env helpers", () => {
	it("maps legacy Cline env names to CodeVibe names", () => {
		expect(codeVibeEnvName("CLINE_API_KEY")).toBe("CODEVIBE_API_KEY");
		expect(codeVibeEnvName("CODEVIBE_API_KEY")).toBe("CODEVIBE_API_KEY");
		expect(legacyClineEnvName("CODEVIBE_API_KEY")).toBe("CLINE_API_KEY");
		expect(legacyClineEnvName("CLINE_API_KEY")).toBe("CLINE_API_KEY");
	});

	it("prefers CodeVibe env values over legacy Cline values", () => {
		expect(
			readCodeVibeEnv("CLINE_PROVIDER", {
				CODEVIBE_PROVIDER: "openai-codex",
				CLINE_PROVIDER: "anthropic",
			}),
		).toBe("openai-codex");
	});

	it("falls back to legacy Cline env values", () => {
		expect(
			readCodeVibeEnv("CODEVIBE_PROVIDER", {
				CLINE_PROVIDER: "anthropic",
			}),
		).toBe("anthropic");
	});

	it("normalizes boolean-like enabled values", () => {
		expect(
			isCodeVibeEnvEnabled("CLINE_SANDBOX", { CODEVIBE_SANDBOX: "yes" }),
		).toBe(true);
		expect(isCodeVibeEnvEnabled("CLINE_SANDBOX", { CLINE_SANDBOX: "1" })).toBe(
			true,
		);
		expect(
			isCodeVibeEnvEnabled("CLINE_SANDBOX", { CODEVIBE_SANDBOX: "0" }),
		).toBe(false);
	});
});
