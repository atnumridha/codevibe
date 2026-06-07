import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CursorSandboxRuntimePolicy } from "@cline/core";
import { describe, expect, it, vi } from "vitest";
import { buildUserInputMessage } from "./prompt";

function cursorSandboxPolicy(
	workspaceRoot: string,
	readablePaths: string[],
): CursorSandboxRuntimePolicy {
	return {
		source: "cursor-sandbox",
		status: "loaded",
		configPath: join(workspaceRoot, ".cursor", "sandbox.json"),
		workspaceRoot,
		effectiveAccess: "prompt",
		readablePaths,
		writablePaths: [],
		networkPolicy: { default: "deny", allow: [] },
		disableTmpWrite: false,
		enableSharedBuildCache: false,
		blockGitWrites: false,
		allowReadAutoApprove: true,
		allowWriteAutoApprove: false,
		allowTerminalAutoApprove: false,
		allowNetworkAutoApprove: false,
	};
}

describe("buildUserInputMessage", () => {
	it("extracts image mentions into userImages", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cli-prompt-"));
		const imagePath = join(dir, "hero.png");
		writeFileSync(imagePath, Buffer.from("hello"));

		const result = await buildUserInputMessage(
			`@${imagePath} describe this image`,
		);

		expect(result.prompt).toBe("[image: hero.png] describe this image");
		expect(result.userImages).toEqual(["data:image/png;base64,aGVsbG8="]);
		expect(result.userFiles).toEqual([]);
	});

	it("extracts text file mentions into userFiles", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cli-prompt-"));
		const filePath = join(dir, "notes.md");
		writeFileSync(filePath, "# Notes\n");

		const result = await buildUserInputMessage(`summarize @${filePath}`);

		expect(result.prompt).toBe("summarize [file: notes.md]");
		expect(result.userImages).toEqual([]);
		expect(result.userFiles).toEqual([filePath]);
	});

	it("extracts quoted text file mentions with spaces into userFiles", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cli prompt "));
		const filePath = join(dir, "notes with spaces.md");
		writeFileSync(filePath, "# Notes\n");

		const result = await buildUserInputMessage(`summarize @"${filePath}"`);

		expect(result.prompt).toBe("summarize [file: notes with spaces.md]");
		expect(result.userImages).toEqual([]);
		expect(result.userFiles).toEqual([filePath]);
	});

	it("does not attach files blocked by .cursorignore", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cli-prompt-"));
		const filePath = join(dir, "secrets", "token.txt");
		mkdirSync(join(dir, "secrets"), { recursive: true });
		writeFileSync(join(dir, ".cursorignore"), "secrets/\n");
		writeFileSync(filePath, "secret\n");
		const warn = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			const result = await buildUserInputMessage(
				`summarize @${filePath}`,
				undefined,
				{ cwd: dir },
			);

			expect(result.prompt).toBe(`summarize @${filePath}`);
			expect(result.userImages).toEqual([]);
			expect(result.userFiles).toEqual([]);
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining("blocked by direct-access ignore settings"),
			);
		} finally {
			warn.mockRestore();
		}
	});

	it("does not attach files blocked by .cursorindexingignore", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cli-prompt-"));
		const filePath = join(dir, "generated", "types.ts");
		mkdirSync(join(dir, "generated"), { recursive: true });
		writeFileSync(join(dir, ".cursorindexingignore"), "generated/\n");
		writeFileSync(filePath, "export type Secret = string\n");
		const warn = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			const result = await buildUserInputMessage(
				"summarize @./generated/types.ts",
				undefined,
				{ cwd: dir },
			);

			expect(result.prompt).toBe("summarize @./generated/types.ts");
			expect(result.userImages).toEqual([]);
			expect(result.userFiles).toEqual([]);
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining("blocked by direct-access ignore settings"),
			);
		} finally {
			warn.mockRestore();
		}
	});

	it("attaches files allowed by negated .cursorindexingignore rules", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cli-prompt-"));
		const filePath = join(dir, "generated", "keep.ts");
		mkdirSync(join(dir, "generated"), { recursive: true });
		writeFileSync(
			join(dir, ".cursorindexingignore"),
			"generated/\n!generated/keep.ts\n",
		);
		writeFileSync(filePath, "export const keep = true\n");

		const result = await buildUserInputMessage(
			"summarize @./generated/keep.ts",
			undefined,
			{ cwd: dir },
		);

		expect(result.prompt).toBe("summarize [file: keep.ts]");
		expect(result.userImages).toEqual([]);
		expect(result.userFiles).toEqual([filePath]);
	});

	it("does not attach files outside Cursor sandbox readable paths", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cli-prompt-"));
		const outside = mkdtempSync(join(tmpdir(), "cli-prompt-outside-"));
		const filePath = join(outside, "notes.md");
		writeFileSync(filePath, "# Notes\n");
		const warn = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			const result = await buildUserInputMessage(
				`summarize @${filePath}`,
				undefined,
				{
					cwd: dir,
					cursorSandboxPolicy: cursorSandboxPolicy(dir, [dir]),
				},
			);

			expect(result.prompt).toBe(`summarize @${filePath}`);
			expect(result.userImages).toEqual([]);
			expect(result.userFiles).toEqual([]);
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining(
					"outside Cursor sandbox read paths from .cursor/sandbox.json",
				),
			);
		} finally {
			warn.mockRestore();
		}
	});
});
