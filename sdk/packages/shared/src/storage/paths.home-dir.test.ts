import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type EnvSnapshot = {
	HOME: string | undefined;
	USERPROFILE: string | undefined;
	HOMEDRIVE: string | undefined;
	HOMEPATH: string | undefined;
	CODEVIBE_DIR: string | undefined;
	CLINE_DIR: string | undefined;
};

function captureEnv(): EnvSnapshot {
	return {
		HOME: process.env.HOME,
		USERPROFILE: process.env.USERPROFILE,
		HOMEDRIVE: process.env.HOMEDRIVE,
		HOMEPATH: process.env.HOMEPATH,
		CODEVIBE_DIR: process.env.CODEVIBE_DIR,
		CLINE_DIR: process.env.CLINE_DIR,
	};
}

function restoreEnv(snapshot: EnvSnapshot): void {
	process.env.HOME = snapshot.HOME;
	process.env.USERPROFILE = snapshot.USERPROFILE;
	process.env.HOMEDRIVE = snapshot.HOMEDRIVE;
	process.env.HOMEPATH = snapshot.HOMEPATH;
	process.env.CODEVIBE_DIR = snapshot.CODEVIBE_DIR;
	process.env.CLINE_DIR = snapshot.CLINE_DIR;
}

describe("storage home directory fallback", () => {
	let snapshot: EnvSnapshot = captureEnv();

	afterEach(() => {
		restoreEnv(snapshot);
		vi.resetModules();
	});

	it("uses USERPROFILE when HOME is unset", async () => {
		snapshot = captureEnv();
		delete process.env.HOME;
		process.env.USERPROFILE = "C:\\Users\\saoud";
		delete process.env.HOMEDRIVE;
		delete process.env.HOMEPATH;
		delete process.env.CODEVIBE_DIR;
		delete process.env.CLINE_DIR;

		const { resolveCodeVibeDir, resolveClineDir } = await import("./paths");
		expect(resolveCodeVibeDir()).toBe(join("C:\\Users\\saoud", ".codevibe"));
		expect(resolveClineDir()).toBe(join("C:\\Users\\saoud", ".codevibe"));
	});

	it("treats HOME=~ as unset and falls back to USERPROFILE", async () => {
		snapshot = captureEnv();
		process.env.HOME = "~";
		process.env.USERPROFILE = "C:\\Users\\saoud";
		delete process.env.HOMEDRIVE;
		delete process.env.HOMEPATH;
		delete process.env.CODEVIBE_DIR;
		delete process.env.CLINE_DIR;

		const { resolveCodeVibeDir, resolveClineDir } = await import("./paths");
		expect(resolveCodeVibeDir()).toBe(join("C:\\Users\\saoud", ".codevibe"));
		expect(resolveClineDir()).toBe(join("C:\\Users\\saoud", ".codevibe"));
	});

	it("uses CLINE_DIR as a legacy fallback when CODEVIBE_DIR is unset", async () => {
		snapshot = captureEnv();
		process.env.HOME = "/home/saoud";
		delete process.env.CODEVIBE_DIR;
		process.env.CLINE_DIR = "/home/saoud/.cline";

		const { resolveCodeVibeDir, resolveClineDir } = await import("./paths");
		expect(resolveCodeVibeDir()).toBe("/home/saoud/.cline");
		expect(resolveClineDir()).toBe("/home/saoud/.cline");
	});

	it("uses CODEVIBE_DIR before CLINE_DIR", async () => {
		snapshot = captureEnv();
		process.env.HOME = "/home/saoud";
		process.env.CODEVIBE_DIR = "/home/saoud/.codevibe-custom";
		process.env.CLINE_DIR = "/home/saoud/.cline";

		const { resolveCodeVibeDir, resolveClineDir } = await import("./paths");
		expect(resolveCodeVibeDir()).toBe("/home/saoud/.codevibe-custom");
		expect(resolveClineDir()).toBe("/home/saoud/.codevibe-custom");
	});
});
