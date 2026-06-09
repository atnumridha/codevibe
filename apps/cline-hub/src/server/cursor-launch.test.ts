import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test, { after } from "node:test";

const previousModuleDataDir = process.env.CLINE_DATA_DIR;
const moduleDataDir = mkdtempSync(join(tmpdir(), "codevibe-hub-data-"));
process.env.CLINE_DATA_DIR = moduleDataDir;

after(() => {
	if (previousModuleDataDir === undefined) {
		delete process.env.CLINE_DATA_DIR;
	} else {
		process.env.CLINE_DATA_DIR = previousModuleDataDir;
	}
	rmSync(moduleDataDir, { recursive: true, force: true });
});

const { launchCursorUri } = (await import(
	new URL("./cursor-launch.ts", import.meta.url).href
)) as typeof import("./cursor-launch");
const { HubContext } = (await import(
	new URL("./state.ts", import.meta.url).href
)) as typeof import("./state");

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

function createGitRepo(): { root: string; repo: string; dataDir: string } {
	const root = mkdtempSync(join(tmpdir(), "codevibe-hub-bg-"));
	const repo = join(root, "repo");
	const dataDir = join(root, "data");
	mkdirSync(repo, { recursive: true });
	mkdirSync(dataDir, { recursive: true });
	git(repo, ["init", "-b", "main"]);
	git(repo, ["config", "user.email", "codevibe@example.invalid"]);
	git(repo, ["config", "user.name", "CodeVibe Test"]);
	writeFileSync(join(repo, "README.md"), "# repo\n", "utf8");
	git(repo, ["add", "README.md"]);
	git(repo, ["commit", "-m", "initial"]);
	return { root, repo, dataDir };
}

test("launchCursorUri creates a confirmed background-agent worktree by default", async () => {
	const previousDataDir = process.env.CLINE_DATA_DIR;
	const { root, repo, dataDir } = createGitRepo();
	process.env.CLINE_DATA_DIR = dataDir;
	try {
		const starts: Array<Record<string, unknown>> = [];
		const sends: Array<Record<string, unknown>> = [];
		const broadcasts: unknown[] = [];
		const ctx = new HubContext();
		ctx.broadcast = (payload: unknown) => {
			broadcasts.push(payload);
		};
		ctx.cline = {
			start: async (input: Record<string, unknown>) => {
				starts.push(input);
				return { sessionId: "session-worktree" };
			},
			send: async (input: Record<string, unknown>) => {
				sends.push(input);
			},
		} as never;
		ctx.uiClient = {
			previewCursorUri: async () => ({
				handled: true,
				route: "background-agent",
				path: "/background-agent",
				taskPrompt:
					"A compatible background agent deeplink was opened.\n\nRequested prompt:\nFix queue",
				requiresConfirmation: true,
				paramKeys: ["branch", "repo", "task"],
			}),
		} as never;

		const result = await launchCursorUri(ctx, {
			uri: "codevibe://background-agent?task=Fix%20queue&repo=owner%2Frepo&branch=main",
			confirmed: true,
			workspaceRoot: repo,
		});

		const details = result.backgroundAgentDetails as Record<string, unknown>;
		assert.equal(result.backgroundAgent, true);
		assert.equal(result.sessionId, "session-worktree");
		assert.equal(details.launchMode, "worktree");
		assert.match(
			String(details.worktreeBranch),
			/^background-agent\/fix-queue-bg-/,
		);
		assert.equal(typeof details.worktreePath, "string");
		assert.match(String(details.worktreePath), /repo-background-agent-bg-/);
		assert.equal(
			git(String(details.worktreePath), ["branch", "--show-current"]),
			details.worktreeBranch,
		);
		assert.equal(starts.length, 1);
		const startInput = starts[0];
		const startConfig = startInput.config as Record<string, unknown>;
		const startMetadata = startInput.sessionMetadata as Record<string, unknown>;
		assert.equal(startConfig.workspaceRoot, details.worktreePath);
		assert.equal(startConfig.cwd, details.worktreePath);
		assert.equal(startMetadata.backgroundAgent, true);
		assert.equal(
			(startMetadata.backgroundAgentDetails as Record<string, unknown>)
				.worktreePath,
			details.worktreePath,
		);
		assert.equal(sends.length, 1);
		assert.equal(sends[0].mode, "plan");
		assert.equal(sends[0].delivery, "queue");
		assert.match(String(sends[0].prompt), /Prepared isolated worktree/);
		assert.ok(broadcasts.length >= 1);
	} finally {
		if (previousDataDir === undefined) {
			delete process.env.CLINE_DATA_DIR;
		} else {
			process.env.CLINE_DATA_DIR = previousDataDir;
		}
		rmSync(root, { recursive: true, force: true });
	}
});

test("launchCursorUri honors explicit background-agent worktree opt-out", async () => {
	const previousDataDir = process.env.CLINE_DATA_DIR;
	const { root, repo, dataDir } = createGitRepo();
	process.env.CLINE_DATA_DIR = dataDir;
	try {
		const starts: Array<Record<string, unknown>> = [];
		const ctx = new HubContext();
		ctx.broadcast = () => {};
		ctx.cline = {
			start: async (input: Record<string, unknown>) => {
				starts.push(input);
				return { sessionId: "session-fallback" };
			},
			send: async () => {},
		} as never;
		ctx.uiClient = {
			previewCursorUri: async () => ({
				handled: true,
				route: "background-agent",
				path: "/background-agent",
				taskPrompt:
					"A compatible background agent deeplink was opened.\n\nRequested prompt:\nFix queue",
				requiresConfirmation: true,
				paramKeys: ["repo", "task"],
			}),
		} as never;

		const result = await launchCursorUri(ctx, {
			uri: "codevibe://background-agent?task=Fix%20queue&repo=owner%2Frepo",
			confirmed: true,
			workspaceRoot: repo,
			enableWorktrees: false,
		});

		const details = result.backgroundAgentDetails as Record<string, unknown>;
		const startConfig = starts[0]?.config as Record<string, unknown>;
		assert.equal(details.launchMode, "controller-record");
		assert.equal(details.fallbackReason, "Worktrees are disabled");
		assert.equal(startConfig.workspaceRoot, repo);
	} finally {
		if (previousDataDir === undefined) {
			delete process.env.CLINE_DATA_DIR;
		} else {
			process.env.CLINE_DATA_DIR = previousDataDir;
		}
		rmSync(root, { recursive: true, force: true });
	}
});
