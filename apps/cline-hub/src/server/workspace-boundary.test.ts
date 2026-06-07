import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { resolveWorkspaceSubpath } = (await import(
	new URL("./workspace-boundary.ts", import.meta.url).href
)) as typeof import("./workspace-boundary");

function withTempDir(run: (baseDir: string) => void): void {
	const baseDir = mkdtempSync(join(tmpdir(), "cline-hub-boundary-"));
	try {
		run(baseDir);
	} finally {
		rmSync(baseDir, { recursive: true, force: true });
	}
}

test("resolveWorkspaceSubpath allows the active workspace root", () => {
	withTempDir((baseDir) => {
		const workspaceRoot = join(baseDir, "workspace");
		mkdirSync(workspaceRoot);

		assert.equal(
			resolveWorkspaceSubpath(workspaceRoot, undefined, "cursor_git_action"),
			realpathSync(workspaceRoot),
		);
	});
});

test("resolveWorkspaceSubpath allows nested workspace roots", () => {
	withTempDir((baseDir) => {
		const workspaceRoot = join(baseDir, "workspace");
		const nestedRoot = join(workspaceRoot, "packages", "app");
		mkdirSync(nestedRoot, { recursive: true });

		assert.equal(
			resolveWorkspaceSubpath(workspaceRoot, nestedRoot, "cursor_git_action"),
			realpathSync(nestedRoot),
		);
	});
});

test("resolveWorkspaceSubpath rejects sibling roots", () => {
	withTempDir((baseDir) => {
		const workspaceRoot = join(baseDir, "workspace");
		const otherRoot = join(baseDir, "other-repo");
		mkdirSync(workspaceRoot);
		mkdirSync(otherRoot);

		assert.throws(
			() => resolveWorkspaceSubpath(workspaceRoot, otherRoot, "cursor_git_action"),
			/workspaceRoot must be inside the active workspace/,
		);
	});
});

test("resolveWorkspaceSubpath rejects parent traversal", () => {
	withTempDir((baseDir) => {
		const workspaceRoot = join(baseDir, "workspace");
		mkdirSync(workspaceRoot);

		assert.throws(
			() =>
				resolveWorkspaceSubpath(
					workspaceRoot,
					join(workspaceRoot, ".."),
					"cursor_git_action",
				),
			/workspaceRoot must be inside the active workspace/,
		);
	});
});

test("resolveWorkspaceSubpath rejects symlink escapes", (t) => {
	withTempDir((baseDir) => {
		const workspaceRoot = join(baseDir, "workspace");
		const otherRoot = join(baseDir, "other-repo");
		const symlinkRoot = join(workspaceRoot, "linked-repo");
		mkdirSync(workspaceRoot);
		mkdirSync(otherRoot);

		try {
			symlinkSync(otherRoot, symlinkRoot, "dir");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EPERM") {
				t.skip("symlink creation requires elevated permissions on this platform");
				return;
			}
			throw error;
		}

		assert.throws(
			() =>
				resolveWorkspaceSubpath(
					workspaceRoot,
					symlinkRoot,
					"cursor_git_action",
				),
			/workspaceRoot must be inside the active workspace/,
		);
	});
});
