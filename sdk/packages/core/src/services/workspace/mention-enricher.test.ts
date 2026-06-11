import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { enrichPromptWithMentions } from "./mention-enricher";

vi.mock("node:worker_threads", async () => {
	const actual = await vi.importActual<typeof import("node:worker_threads")>(
		"node:worker_threads",
	);
	return {
		...actual,
		isMainThread: false,
		parentPort: null,
	};
});

async function createTempWorkspace(): Promise<string> {
	return mkdtemp(path.join(os.tmpdir(), "core-mentions-"));
}

describe("enrichPromptWithMentions", () => {
	it("returns matched files for matching @path mentions", async () => {
		const cwd = await createTempWorkspace();
		try {
			const sourcePath = path.join(cwd, "src", "index.ts");
			await mkdir(path.dirname(sourcePath), { recursive: true });
			await writeFile(sourcePath, "export const answer = 42\n", "utf8");

			const result = await enrichPromptWithMentions(
				"Review @src/index.ts",
				cwd,
			);

			expect(result.mentions).toEqual(["src/index.ts"]);
			expect(result.matchedFiles).toEqual(["src/index.ts"]);
			expect(result.ignoredMentions).toEqual([]);
			expect(result.prompt).toBe("Review @src/index.ts");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("ignores emails and unmatched mentions", async () => {
		const cwd = await createTempWorkspace();
		try {
			await writeFile(path.join(cwd, "README.md"), "# Demo\n", "utf8");

			const result = await enrichPromptWithMentions(
				"Ping me at test@example.com and check @missing/file.ts.",
				cwd,
			);

			expect(result.mentions).toEqual(["missing/file.ts"]);
			expect(result.matchedFiles).toEqual([]);
			expect(result.ignoredMentions).toEqual(["missing/file.ts"]);
			expect(result.prompt).toBe(
				"Ping me at test@example.com and check @missing/file.ts.",
			);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("ignores mentioned files excluded from Cursor indexing", async () => {
		const cwd = await createTempWorkspace();
		try {
			await mkdir(path.join(cwd, "generated"), { recursive: true });
			await writeFile(
				path.join(cwd, ".cursorindexingignore"),
				"generated/\n",
				"utf8",
			);
			await writeFile(
				path.join(cwd, "generated", "types.ts"),
				"export type Secret = string\n",
				"utf8",
			);

			const result = await enrichPromptWithMentions(
				"Use @generated/types.ts",
				cwd,
			);

			expect(result.mentions).toEqual(["generated/types.ts"]);
			expect(result.matchedFiles).toEqual([]);
			expect(result.ignoredMentions).toEqual(["generated/types.ts"]);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("ignores mentioned files matched by terminal Cursor indexing globstar rules", async () => {
		const cwd = await createTempWorkspace();
		try {
			await mkdir(path.join(cwd, "secrets"), { recursive: true });
			await writeFile(
				path.join(cwd, ".cursorindexingignore"),
				"secrets/**\n",
				"utf8",
			);
			await writeFile(
				path.join(cwd, "secrets", "token.ts"),
				"export const token = 1\n",
				"utf8",
			);

			const result = await enrichPromptWithMentions(
				"Use @secrets/token.ts",
				cwd,
			);

			expect(result.mentions).toEqual(["secrets/token.ts"]);
			expect(result.matchedFiles).toEqual([]);
			expect(result.ignoredMentions).toEqual(["secrets/token.ts"]);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("can match Cursor-indexing ignored mentions when the privacy gate is disabled", async () => {
		const cwd = await createTempWorkspace();
		try {
			await mkdir(path.join(cwd, "generated"), { recursive: true });
			await writeFile(
				path.join(cwd, ".cursorindexingignore"),
				"generated/\n",
				"utf8",
			);
			await writeFile(
				path.join(cwd, "generated", "types.ts"),
				"export type Legacy = string\n",
				"utf8",
			);

			const result = await enrichPromptWithMentions(
				"Use @generated/types.ts",
				cwd,
				{ cursorRetrievalIndexingPrivacyGate: false },
			);

			expect(result.mentions).toEqual(["generated/types.ts"]);
			expect(result.matchedFiles).toEqual(["generated/types.ts"]);
			expect(result.ignoredMentions).toEqual([]);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("respects maxTotalBytes while keeping prompt unchanged", async () => {
		const cwd = await createTempWorkspace();
		try {
			await writeFile(path.join(cwd, "a.ts"), "123", "utf8");
			await writeFile(path.join(cwd, "b.ts"), "const b = 2\n", "utf8");

			const result = await enrichPromptWithMentions(
				"Use @a.ts and @b.ts",
				cwd,
				{ maxTotalBytes: 5, maxFiles: 2, maxFileBytes: 5 },
			);

			expect(result.mentions).toEqual(["a.ts", "b.ts"]);
			expect(result.matchedFiles).toEqual(["a.ts"]);
			expect(result.ignoredMentions).toEqual(["b.ts"]);
			expect(result.prompt).toBe("Use @a.ts and @b.ts");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("does not over-count totalBytes across multiple mentions", async () => {
		const cwd = await createTempWorkspace();
		try {
			await writeFile(path.join(cwd, "a.ts"), "aaa", "utf8");
			await writeFile(path.join(cwd, "b.ts"), "bbb", "utf8");
			await writeFile(path.join(cwd, "c.ts"), "ccc", "utf8");

			const result = await enrichPromptWithMentions(
				"Use @a.ts @b.ts @c.ts",
				cwd,
				{ maxTotalBytes: 15, maxFiles: 5, maxFileBytes: 5 },
			);

			expect(result.mentions).toEqual(["a.ts", "b.ts", "c.ts"]);
			expect(result.matchedFiles).toEqual(["a.ts", "b.ts", "c.ts"]);
			expect(result.ignoredMentions).toEqual([]);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
