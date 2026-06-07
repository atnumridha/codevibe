import { describe, expect, it } from "vitest";
import { buildSessionDiffState } from "./session-diff";

describe("buildSessionDiffState", () => {
	it("marks apply_patch delete-only events as visible file changes", () => {
		const result = buildSessionDiffState([
			{
				hookEventName: "tool_result",
				toolName: "apply_patch",
				toolInput: {
					input: [
						"*** Begin Patch",
						"*** Delete File: src/old.ts",
						"*** End Patch",
					].join("\n"),
				},
				toolOutput: {
					success: true,
				},
			},
		]);

		expect(result.summary).toEqual({
			additions: 0,
			deletions: 1,
		});
		expect(result.fileDiffs).toEqual([
			{
				path: "src/old.ts",
				additions: 0,
				deletions: 1,
				hunks: [],
			},
		]);
	});
});
