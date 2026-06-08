import { describe, expect, it } from "vitest";
import { installCodeVibeEnvAliases } from "./codevibe-env";

describe("installCodeVibeEnvAliases", () => {
	it("maps CODEVIBE_* values to legacy CLINE_* names when unset", () => {
		const env: NodeJS.ProcessEnv = {
			CODEVIBE_DATA_DIR: "/tmp/codevibe-data",
			CODEVIBE_PROVIDER: "openai-codex",
		};

		installCodeVibeEnvAliases(env);

		expect(env.CLINE_DATA_DIR).toBe("/tmp/codevibe-data");
		expect(env.CLINE_PROVIDER).toBe("openai-codex");
	});

	it("does not overwrite explicit legacy CLINE_* values", () => {
		const env: NodeJS.ProcessEnv = {
			CODEVIBE_DATA_DIR: "/tmp/codevibe-data",
			CLINE_DATA_DIR: "/tmp/legacy-data",
		};

		installCodeVibeEnvAliases(env);

		expect(env.CLINE_DATA_DIR).toBe("/tmp/legacy-data");
	});
});
