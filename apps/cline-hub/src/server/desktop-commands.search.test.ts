import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { HubMentionFileSearchRequest } from "@cline/shared";
import { handleDesktopCommand } from "./desktop-commands";
import { HubContext } from "./state";

function searchContext(calls: HubMentionFileSearchRequest[]): HubContext {
	const ctx = new HubContext();
	ctx.uiClient = {
		searchMentionFiles: async (input: HubMentionFileSearchRequest) => {
			calls.push(input);
			return {
				query: input.query ?? "",
				workspaceRoot: input.workspaceRoot ?? "",
				count: 2,
				truncated: false,
				results: [
					{
						path: "src/app.ts",
						basename: "app.ts",
						directory: "src",
						score: 100,
					},
					{
						path: "src/index.ts",
						basename: "index.ts",
						directory: "src",
						score: 90,
					},
				],
			};
		},
	} as never;
	return ctx;
}

test("search_workspace_files resolves inside the active workspace and forwards the privacy gate", async () => {
	const calls: HubMentionFileSearchRequest[] = [];
	const ctx = searchContext(calls);

	const result = await handleDesktopCommand(ctx, "search_workspace_files", {
		query: " app ",
		limit: 25,
		cursorRetrievalIndexingPrivacyGate: false,
	});

	assert.deepEqual(result, ["src/app.ts", "src/index.ts"]);
	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.workspaceRoot, realpathSync(process.cwd()));
	assert.equal(calls[0]?.query, "app");
	assert.equal(calls[0]?.limit, 25);
	assert.equal(calls[0]?.cursorRetrievalIndexingPrivacyGate, false);
});

test("search_workspace_files accepts cwd aliases inside the active workspace", async () => {
	const calls: HubMentionFileSearchRequest[] = [];
	const ctx = searchContext(calls);
	const nestedRoot = join(process.cwd(), "apps", "cline-hub");

	await handleDesktopCommand(ctx, "search_workspace_files", {
		cwd: nestedRoot,
		query: "hub",
	});

	assert.equal(calls[0]?.workspaceRoot, realpathSync(nestedRoot));
	assert.equal(calls[0]?.query, "hub");
});

test("search_workspace_files rejects parent traversal", async () => {
	const calls: HubMentionFileSearchRequest[] = [];
	const ctx = searchContext(calls);

	await assert.rejects(
		() =>
			handleDesktopCommand(ctx, "search_workspace_files", {
				workspaceRoot: join(process.cwd(), ".."),
				query: "outside",
			}),
		/search_workspace_files workspaceRoot must be inside the active workspace/,
	);
	assert.equal(calls.length, 0);
});

test("search_workspace_files rejects sibling workspaces", async () => {
	const calls: HubMentionFileSearchRequest[] = [];
	const ctx = searchContext(calls);

	await assert.rejects(
		() =>
			handleDesktopCommand(ctx, "search_workspace_files", {
				workspaceRoot: "/private/tmp",
				query: "outside",
			}),
		/search_workspace_files workspaceRoot must be inside the active workspace/,
	);
	assert.equal(calls.length, 0);
});
