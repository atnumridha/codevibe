import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentToolContext } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createSearchExecutor } from "./search";

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
	return mkdtemp(path.join(os.tmpdir(), "core-search-"));
}

describe("createSearchExecutor", () => {
	it("does not return matches from Cursor-indexing ignored files", async () => {
		const cwd = await createTempWorkspace();
		try {
			await mkdir(path.join(cwd, "generated"), { recursive: true });
			await mkdir(path.join(cwd, "src"), { recursive: true });
			await writeFile(
				path.join(cwd, ".cursorindexingignore"),
				"generated/\n",
				"utf8",
			);
			await writeFile(
				path.join(cwd, "generated", "types.ts"),
				"export const ignored = 'CURSOR_SECRET'\n",
				"utf8",
			);
			await writeFile(
				path.join(cwd, "src", "app.ts"),
				"export const app = 'visible'\n",
				"utf8",
			);

			const search = createSearchExecutor();
			const result = await search(
				"CURSOR_SECRET",
				cwd,
				{} as AgentToolContext,
			);

			expect(result).toContain("No results found");
			expect(result).not.toContain("generated/types.ts");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
