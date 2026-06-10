import { describe, expect, it } from "vitest";
import { normalizeWorkspaceDiffResponse } from "./workspace-state";

describe("normalizeWorkspaceDiffResponse", () => {
	it("maps authoritative sidecar diffs into chat diff rows and totals", () => {
		const result = normalizeWorkspaceDiffResponse({
			workspaceRoot: "/repo",
			summary: {
				files: 2,
				additions: 3,
				deletions: 1,
			},
			files: [
				{
					path: "src/app.ts",
					additions: 1,
					deletions: 1,
					hunks: [
						{
							oldStart: 4,
							newStart: 4,
							old: "old",
							new: "new",
						},
					],
				},
				{
					path: "src/new.ts",
					originalPath: "src/old.ts",
					additions: 2,
					deletions: 0,
					hunks: [
						{
							oldStart: 1,
							newStart: 1,
							old: "",
							new: "one\ntwo",
						},
					],
				},
			],
		});

		expect(result.summary).toEqual({ additions: 3, deletions: 1 });
		expect(result.fileDiffs).toEqual([
			{
				path: "src/app.ts",
				additions: 1,
				deletions: 1,
				hunks: [
					{
						oldStart: 4,
						newStart: 4,
						old: "old",
						new: "new",
					},
				],
			},
			{
				path: "src/old.ts -> src/new.ts",
				additions: 2,
				deletions: 0,
				hunks: [
					{
						oldStart: 1,
						newStart: 1,
						old: "",
						new: "one\ntwo",
					},
				],
			},
		]);
	});
});
