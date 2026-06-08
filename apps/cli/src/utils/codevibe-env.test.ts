import { describe, expect, it } from "vitest";
import {
	installCodeVibeEnvAliases,
	resolveCodeVibeDir,
	setCodeVibeDirEnvironment,
} from "./codevibe-env";

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

	it("resolves CODEVIBE_DIR before legacy CLINE_DIR", () => {
		expect(
			resolveCodeVibeDir(
				{
					CODEVIBE_DIR: "/tmp/codevibe-home",
					CLINE_DIR: "/tmp/legacy-home",
				},
				"/home/tester",
			),
		).toBe("/tmp/codevibe-home");
	});

	it("falls back to CLINE_DIR for legacy installs", () => {
		expect(
			resolveCodeVibeDir({ CLINE_DIR: "/tmp/legacy-home" }, "/home/tester"),
		).toBe("/tmp/legacy-home");
	});

	it("defaults to ~/.codevibe when no config env is set", () => {
		expect(resolveCodeVibeDir({}, "/home/tester")).toBe(
			"/home/tester/.codevibe",
		);
	});

	it("mirrors selected config dirs into both CodeVibe and legacy names", () => {
		const env: NodeJS.ProcessEnv = {
			CODEVIBE_DIR: "/tmp/old-codevibe",
			CLINE_DIR: "/tmp/old-legacy",
		};

		setCodeVibeDirEnvironment("/tmp/selected", env);

		expect(env.CODEVIBE_DIR).toBe("/tmp/selected");
		expect(env.CLINE_DIR).toBe("/tmp/selected");
	});
});
