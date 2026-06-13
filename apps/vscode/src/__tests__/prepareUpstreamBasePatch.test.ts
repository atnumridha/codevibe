import { strict as assert } from "node:assert"
import { execFileSync, type SpawnSyncReturns, spawnSync } from "node:child_process"
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const vscodeRoot = process.cwd()
const scriptPath = path.join(vscodeRoot, "scripts", "prepare-upstream-base-patch.mjs")

function runScript(
	script: string,
	args: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): SpawnSyncReturns<string> {
	return spawnSync(process.execPath, [script, ...args], {
		cwd: options.cwd ?? vscodeRoot,
		env: { ...process.env, ...options.env },
		encoding: "utf8",
		maxBuffer: 10 * 1024 * 1024,
	})
}

function assertScriptSucceeded(result: SpawnSyncReturns<string>) {
	assert.equal(result.error, undefined)
	assert.equal(result.status, 0, result.stderr || result.stdout)
}

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	})
}

async function initGitRepo(repoRoot: string) {
	git(repoRoot, ["init"])
	git(repoRoot, ["checkout", "-b", "main"])
}

function commitAll(cwd: string, message: string) {
	git(cwd, ["add", "."])
	git(cwd, ["-c", "user.email=codie-tests@example.com", "-c", "user.name=Codie Tests", "commit", "-m", message])
}

async function createLocalUpstreamFixture(
	parentDir: string,
	options: { dirName?: string; packageName?: string; sourceFileName?: string } = {},
): Promise<string> {
	const upstreamRoot = path.join(parentDir, options.dirName ?? "AJCursorClone")
	await mkdir(path.join(upstreamRoot, "apps", "vscode", "src", "core", "api"), { recursive: true })
	await writeFile(
		path.join(upstreamRoot, "apps", "vscode", "package.json"),
		`${JSON.stringify({ name: options.packageName ?? "ajcursorclone" })}\n`,
	)
	await writeFile(
		path.join(upstreamRoot, "apps", "vscode", "src", "core", "api", options.sourceFileName ?? "aj.ts"),
		"export const upstreamFixture = true\n",
	)
	await initGitRepo(upstreamRoot)
	commitAll(upstreamRoot, `initial ${options.packageName ?? "ajcursorclone"} upstream`)
	return upstreamRoot
}

async function createCodeVibeFixture(parentDir: string): Promise<{ repoRoot: string; script: string }> {
	const repoRoot = path.join(parentDir, "codevibe")
	const scriptDir = path.join(repoRoot, "apps", "vscode", "scripts")
	const script = path.join(scriptDir, "prepare-upstream-base-patch.mjs")
	await mkdir(scriptDir, { recursive: true })
	await copyFile(scriptPath, script)
	await writeFile(path.join(repoRoot, "README.md"), "# CodeVibe fixture\n")
	await initGitRepo(repoRoot)
	commitAll(repoRoot, "initial codevibe fixture")
	return { repoRoot, script }
}

async function withTempFixture<T>(callback: (tempRoot: string) => Promise<T>): Promise<T> {
	const tempRoot = await mkdtemp(path.join(tmpdir(), "codevibe-upstream-base-patch-"))
	try {
		return await callback(tempRoot)
	} finally {
		await rm(tempRoot, { recursive: true, force: true })
	}
}

describe("prepare-upstream-base-patch", function () {
	this.timeout(15_000)

	it("prints upstream profile metadata with --list-profiles", () => {
		const result = runScript(scriptPath, ["--list-profiles"])

		assertScriptSucceeded(result)
		const profiles = JSON.parse(result.stdout)
		assert.deepEqual(Object.keys(profiles), ["cline", "ajcursorclone", "cursor-local", "vibecode", "copilot-local"])
		assert.equal(profiles.cline.sourceKind, "git-remote")
		assert.equal(profiles.cline.remoteName, "codevibe-upstream-cline")
		assert.equal(profiles.cline.upstreamUrl, "https://github.com/cline/cline.git")
		assert.equal(profiles.ajcursorclone.label, "AJCursorClone local Cursor-style source")
		assert.equal(profiles.ajcursorclone.sourceKind, "local-git")
		assert.equal(profiles.ajcursorclone.remoteName, "codevibe-upstream-ajcursorclone")
		assert.equal(profiles.ajcursorclone.localPathEnv, "CODEVIBE_AJCURSORCLONE_PATH")
		assert.match(profiles.ajcursorclone.defaultLocalPath, /AJCursorClone$/)
		assert.equal(profiles["cursor-local"].localPathEnv, "CODEVIBE_CURSOR_UPSTREAM_PATH")
		assert.equal(profiles["cursor-local"].sourceKind, "local-git")
		assert.equal(profiles.vibecode.label, "VibeCode upstream")
		assert.equal(profiles.vibecode.sourceKind, "git-remote")
		assert.equal(profiles.vibecode.remoteName, "codevibe-upstream-vibecode")
		assert.equal(profiles.vibecode.upstreamUrl, "https://github.com/atnumridha/vibecode.git")
		assert.equal(profiles["copilot-local"].label, "Local Copilot-compatible source")
		assert.equal(profiles["copilot-local"].sourceKind, "local-git")
		assert.equal(profiles["copilot-local"].remoteName, "codevibe-upstream-copilot-local")
		assert.equal(profiles["copilot-local"].localPathEnv, "CODEVIBE_COPILOT_UPSTREAM_PATH")
	})

	it("writes an AJCursorClone local profile report under the profile output directory", async () => {
		await withTempFixture(async (tempRoot) => {
			const upstreamRoot = await createLocalUpstreamFixture(tempRoot)
			const fixture = await createCodeVibeFixture(tempRoot)

			const result = runScript(fixture.script, ["--profile", "ajcursorclone", "--fetch", "--write-report"], {
				cwd: fixture.repoRoot,
				env: { CODEVIBE_AJCURSORCLONE_PATH: upstreamRoot },
			})

			assertScriptSucceeded(result)
			const reportPath = path.join(fixture.repoRoot, ".codevibe", "upstream-base", "ajcursorclone", "intake-report.json")
			const report = JSON.parse(await readFile(reportPath, "utf8"))
			assert.equal(report.schemaVersion, 2)
			assert.equal(report.upstream.profile, "ajcursorclone")
			assert.equal(report.upstream.profileLabel, "AJCursorClone local Cursor-style source")
			assert.equal(report.upstream.sourceKind, "local-git")
			assert.equal(report.upstream.remoteName, "codevibe-upstream-ajcursorclone")
			assert.equal(report.upstream.remoteUrl, upstreamRoot)
			assert.equal(report.upstream.requestedRef, "main")
			assert.match(report.upstream.commit, /^[a-f0-9]{40}$/)
			assert.equal(report.upstream.noMergeBaseTreeInventory, true)
			assert.equal(report.workingTreeDirty, false)
			assert.equal(
				report.changedFiles.some((file: { path?: string }) => file.path === "apps/vscode/package.json"),
				true,
			)
			assert.equal(
				report.layerPlan.some(
					(layer: { name?: string; changedFileCount?: number }) =>
						layer.name === "extension-manifest-and-package-scripts" && (layer.changedFileCount ?? 0) > 0,
				),
				true,
			)
			assert.equal(report.recommendedCommands[0].includes("--upstream-profile ajcursorclone"), true)
			assert.match(result.stdout, /Profile: ajcursorclone \(AJCursorClone local Cursor-style source\)/)
			assert.match(result.stdout, new RegExp(reportPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
		})
	})

	it("writes a Copilot-compatible local profile report from the profile environment variable", async () => {
		await withTempFixture(async (tempRoot) => {
			const upstreamRoot = await createLocalUpstreamFixture(tempRoot, {
				dirName: "CopilotLocal",
				packageName: "copilot-local-fixture",
				sourceFileName: "copilot.ts",
			})
			const fixture = await createCodeVibeFixture(tempRoot)

			const result = runScript(fixture.script, ["--profile", "copilot-local", "--fetch", "--write-report"], {
				cwd: fixture.repoRoot,
				env: { CODEVIBE_COPILOT_UPSTREAM_PATH: upstreamRoot },
			})

			assertScriptSucceeded(result)
			const reportPath = path.join(fixture.repoRoot, ".codevibe", "upstream-base", "copilot-local", "intake-report.json")
			const report = JSON.parse(await readFile(reportPath, "utf8"))
			assert.equal(report.upstream.profile, "copilot-local")
			assert.equal(report.upstream.profileLabel, "Local Copilot-compatible source")
			assert.equal(report.upstream.sourceKind, "local-git")
			assert.equal(report.upstream.remoteName, "codevibe-upstream-copilot-local")
			assert.equal(report.upstream.remoteUrl, upstreamRoot)
			assert.equal(report.upstream.noMergeBaseTreeInventory, true)
			assert.equal(
				report.changedFiles.some((file: { path?: string }) => file.path === "apps/vscode/package.json"),
				true,
			)
			assert.equal(report.recommendedCommands[0].includes("--upstream-profile copilot-local"), true)
			assert.match(result.stdout, /Profile: copilot-local \(Local Copilot-compatible source\)/)
		})
	})

	it("does not resolve stale FETCH_HEAD or the local default branch without --fetch", async () => {
		await withTempFixture(async (tempRoot) => {
			const fixture = await createCodeVibeFixture(tempRoot)
			git(fixture.repoRoot, ["fetch", ".", "main"])

			const result = runScript(fixture.script, ["--allow-dirty", "--json"], {
				cwd: fixture.repoRoot,
			})

			assertScriptSucceeded(result)
			const report = JSON.parse(result.stdout)
			assert.equal(report.upstream.resolvedRef, null)
			assert.equal(report.upstream.commit, null)
			assert.equal(report.changedFileCount, 0)
		})
	})
})
