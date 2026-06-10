#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const vscodeRoot = path.resolve(scriptDir, "..")
const repoRoot = path.resolve(vscodeRoot, "../..")

const defaultOptions = {
	remoteName: "codevibe-base-upstream",
	upstreamUrl: "https://github.com/cline/cline.git",
	upstreamRef: "main",
	baseRef: "HEAD",
	outDir: path.join(repoRoot, ".codevibe", "upstream-base"),
	fetch: false,
	exportPatch: false,
	writeReport: false,
	json: false,
	allowDirty: false,
}

const patchLayers = [
	{
		name: "extension-manifest-and-package-scripts",
		paths: [
			"apps/vscode/package.json",
			"apps/vscode/package-lock.json",
			"apps/vscode/.vscodeignore",
			"package.json",
			"package-lock.json",
			".vscodeignore",
		],
		checks: ["npm --prefix apps/vscode run package:github-vsix:preflight"],
	},
	{
		name: "agent-core-tools-and-prompts",
		paths: [
			"apps/vscode/src/core",
			"apps/vscode/src/shared",
			"apps/vscode/src/integrations",
			"src/core",
			"src/shared",
			"src/integrations",
		],
		checks: ["npm --prefix apps/vscode run check-types"],
	},
	{
		name: "providers-auth-and-codex-defaults",
		paths: [
			"apps/vscode/src/core/api",
			"apps/vscode/src/services/auth",
			"apps/vscode/src/shared/api.ts",
			"src/core/api",
			"src/services/auth",
			"src/shared/api.ts",
		],
		checks: ["npm --prefix apps/vscode run test:unit -- --grep Codex"],
	},
	{
		name: "webview-ui-and-visible-branding",
		paths: [
			"apps/vscode/webview-ui/src",
			"apps/vscode/assets",
			"apps/vscode/walkthrough",
			"webview-ui/src",
			"assets",
			"walkthrough",
		],
		checks: ["npm --prefix apps/vscode run build:webview", "npm --prefix apps/vscode run package:github-vsix:preflight"],
	},
	{
		name: "proto-and-host-bridge",
		paths: ["apps/vscode/proto", "apps/vscode/src/hosts", "apps/vscode/src/generated", "proto", "src/hosts", "src/generated"],
		checks: ["npm --prefix apps/vscode run protos", "npm --prefix apps/vscode run check-types"],
	},
	{
		name: "release-and-parity-guards",
		paths: [
			"apps/vscode/scripts",
			"apps/vscode/src/test",
			"apps/vscode/playwright.config.ts",
			"scripts",
			"src/test",
			"playwright.config.ts",
		],
		checks: ["npm --prefix apps/vscode run lint", "npm --prefix apps/vscode run package:github-vsix:preflight"],
	},
]

const codeVibeOverlayFiles = [
	"apps/vscode/package.json",
	"apps/vscode/scripts/package-github-vsix.mjs",
	"apps/vscode/scripts/release-github-vsix.mjs",
	"apps/vscode/src/package/brandGuards.ts",
	"apps/vscode/src/core/api/providers/openai-codex.ts",
	"apps/vscode/src/services/auth",
	"apps/vscode/src/hosts",
	"apps/vscode/src/extension.ts",
	"apps/vscode/webview-ui/src/components/home",
	"apps/vscode/webview-ui/src/components/common/CodeVibeMark.tsx",
	"apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx",
	"apps/vscode/assets",
	"apps/vscode/agents/00-codevibe-agent.agent.md",
	"apps/vscode/walkthrough",
]

const brandGuardCommands = [
	"npm --prefix apps/vscode run package:github-vsix:preflight",
	"npm --prefix apps/vscode run build:webview",
	"npm --prefix apps/vscode run lint",
	"git diff --check",
]

const finalValidationCommands = [
	"npm --prefix apps/vscode run check-types",
	"npm --prefix apps/vscode run test:unit -- --grep \"Codex|Cursor|Package manifest|Telemetry\"",
	"node apps/vscode/scripts/package-github-vsix.mjs --out-dir /private/tmp/codevibe-vsix --install --verify-install",
]

const githubReleaseValidationCommands = [
	"npm --prefix apps/vscode run release:preflight:release -- --candidate",
]

const overlayRiskRules = [
	{
		name: "codex-auth-defaults",
		severity: "critical",
		paths: [
			"apps/vscode/src/core/api",
			"apps/vscode/src/services/auth",
			"apps/vscode/src/core/storage/state-migrations.ts",
			"apps/vscode/src/shared/api.ts",
		],
		reason: "Preserve OpenAI Codex as the default provider and keep .codex/auth.json import behavior intact.",
	},
	{
		name: "native-agent-placement",
		severity: "critical",
		paths: [
			"apps/vscode/package.json",
			"apps/vscode/src/hosts",
			"apps/vscode/src/extension.ts",
			"apps/vscode/agents/00-codevibe-agent.agent.md",
		],
		reason: "Keep CodeVibe's agent contribution before Copilot-style agents and avoid reintroducing orphaned view containers.",
	},
	{
		name: "visible-branding-and-ui",
		severity: "high",
		paths: [
			"apps/vscode/package.json",
			"apps/vscode/README.md",
			"apps/vscode/assets",
			"apps/vscode/walkthrough",
			"apps/vscode/webview-ui/src",
		],
		reason: "Do not regress CodeVibe look, icons, marketplace copy, or visible UI text back to upstream branding.",
	},
	{
		name: "release-and-package-guards",
		severity: "high",
		paths: [
			"apps/vscode/scripts/package-github-vsix.mjs",
			"apps/vscode/scripts/release-github-vsix.mjs",
			"apps/vscode/scripts/check-local-release-prereqs.mjs",
			"apps/vscode/scripts/assert-cursor-parity-release-gate.mjs",
		],
		reason: "Keep VSIX packaging, install smoke tests, release gates, and visible-brand scans enforced.",
	},
	{
		name: "standalone-ui-bridge",
		severity: "high",
		paths: ["apps/cline-hub", "apps/vscode/src/standalone", "apps/vscode/src/hosts/standalone"],
		reason: "Preserve the non-VS-Code runtime path for the upcoming CodeVibe standalone UI.",
	},
	{
		name: "cursor-compatibility-surfaces",
		severity: "medium",
		paths: [
			"apps/vscode/src/services/uri",
			"apps/vscode/src/services/browser",
			"apps/vscode/src/core/controller/background-agent",
			"apps/vscode/src/core/context/instructions",
			"apps/vscode/src/core/task/tools/autoApprove.ts",
		],
		reason: "Keep Cursor-compatible routes, background agents, browser tooling, rules, ignores, and sandbox policy working.",
	},
]

function printHelp() {
	console.log(`CodeVibe upstream base patch intake

Usage:
  node apps/vscode/scripts/prepare-upstream-base-patch.mjs [options]

Options:
  --remote-name <name>      Upstream base git remote name. Default: codevibe-base-upstream
  --upstream-url <url>      Upstream base git URL. Default: https://github.com/cline/cline.git
  --upstream-ref <ref>      Upstream branch/tag/ref to inspect. Default: main
  --base-ref <ref>          CodeVibe base ref to compare against. Default: HEAD
  --out-dir <path>          Report/patch output directory. Default: .codevibe/upstream-base
  --fetch                   Add/fetch the upstream remote before planning
  --export-patch            Write a binary git patch when the upstream ref is locally available
  --write-report            Write the intake report JSON to --out-dir
  --json                    Print JSON instead of a readable report
  --allow-dirty             Do not fail when the working tree is dirty
  --help                    Show this help

Typical flow:
  npm --prefix apps/vscode run upstream:base:plan -- --fetch --upstream-ref main --write-report
  git switch -c codex/upstream-base-main
  npm --prefix apps/vscode run upstream:base:plan -- --export-patch --write-report
  Apply one patch layer at a time, then run the guard commands printed in the report.
`)
}

function parseArgs(argv) {
	const options = { ...defaultOptions }
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index]
		switch (arg) {
			case "--help":
			case "-h":
				printHelp()
				process.exit(0)
				break
			case "--remote-name":
				options.remoteName = readValue(argv, ++index, arg)
				break
			case "--upstream-url":
				options.upstreamUrl = readValue(argv, ++index, arg)
				break
			case "--upstream-ref":
				options.upstreamRef = readValue(argv, ++index, arg)
				break
			case "--base-ref":
				options.baseRef = readValue(argv, ++index, arg)
				break
			case "--out-dir":
				options.outDir = path.resolve(readValue(argv, ++index, arg))
				break
			case "--fetch":
				options.fetch = true
				break
			case "--export-patch":
				options.exportPatch = true
				break
			case "--write-report":
				options.writeReport = true
				break
			case "--json":
				options.json = true
				break
			case "--allow-dirty":
				options.allowDirty = true
				break
			default:
				throw new Error(`Unknown argument: ${arg}`)
		}
	}
	return options
}

function readValue(argv, index, flag) {
	const value = argv[index]
	if (!value || value.startsWith("--")) {
		throw new Error(`${flag} requires a value`)
	}
	return value
}

function git(args, options = {}) {
	const result = spawnSync("git", args, {
		cwd: repoRoot,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		...options,
	})
	return {
		status: result.status ?? 1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		ok: result.status === 0,
	}
}

function mustGit(args) {
	const result = git(args)
	if (!result.ok) {
		throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`)
	}
	return result.stdout.trim()
}

function ensureCleanWorktree(allowDirty) {
	const status = mustGit(["status", "--porcelain"])
	if (status && !allowDirty) {
		throw new Error("Working tree is dirty. Commit/stash first, or pass --allow-dirty for a planning-only report.")
	}
	return status.split("\n").filter(Boolean)
}

function ensureRemote(options) {
	const remoteUrl = git(["remote", "get-url", options.remoteName])
	if (remoteUrl.ok) {
		return { existed: true, url: remoteUrl.stdout.trim() }
	}
	const add = git(["remote", "add", options.remoteName, options.upstreamUrl])
	if (!add.ok) {
		throw new Error(`Failed to add upstream remote ${options.remoteName}: ${(add.stderr || add.stdout).trim()}`)
	}
	return { existed: false, url: options.upstreamUrl }
}

function fetchUpstream(options) {
	const remote = ensureRemote(options)
	const fetch = git(["fetch", "--tags", options.remoteName, options.upstreamRef])
	if (!fetch.ok) {
		throw new Error(`Failed to fetch ${options.remoteName} ${options.upstreamRef}: ${(fetch.stderr || fetch.stdout).trim()}`)
	}
	return remote
}

function resolveRef(options) {
	const candidates = [
		`${options.remoteName}/${options.upstreamRef}`,
		`refs/remotes/${options.remoteName}/${options.upstreamRef}`,
		`refs/tags/${options.upstreamRef}`,
		`FETCH_HEAD`,
		options.upstreamRef,
	]
	for (const candidate of candidates) {
		const resolved = git(["rev-parse", "--verify", `${candidate}^{commit}`])
		if (resolved.ok) {
			return { input: options.upstreamRef, ref: candidate, commit: resolved.stdout.trim() }
		}
	}
	return { input: options.upstreamRef, ref: null, commit: null }
}

function listChangedFiles(fromRef, toRef) {
	const diff = git(["diff", "--name-status", `${fromRef}..${toRef}`])
	if (!diff.ok) {
		return []
	}
	return diff.stdout
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [status, ...fileParts] = line.split("\t")
			return { status, path: fileParts.join("\t") }
		})
}

function countLayerHits(changedFiles) {
	return patchLayers.map((layer) => ({
		name: layer.name,
		paths: layer.paths,
		checks: layer.checks,
		changedFiles: changedFiles
			.filter((file) => layer.paths.some((layerPath) => file.path.startsWith(layerPath)))
			.slice(0, 40),
	}))
}

function pathMatches(filePath, candidatePath) {
	return filePath === candidatePath || filePath.startsWith(`${candidatePath}/`)
}

function findOverlayRisks(changedFiles) {
	return overlayRiskRules
		.map((rule) => {
			const changedFilesForRule = changedFiles
				.filter((file) => rule.paths.some((rulePath) => pathMatches(file.path, rulePath)))
				.slice(0, 80)
			return {
				name: rule.name,
				severity: rule.severity,
				reason: rule.reason,
				paths: rule.paths,
				changedFiles: changedFilesForRule,
				changedFileCount: changedFilesForRule.length,
				reviewRequired: changedFilesForRule.length > 0,
			}
		})
		.sort((a, b) => {
			const severityRank = { critical: 0, high: 1, medium: 2, low: 3 }
			return (severityRank[a.severity] ?? 99) - (severityRank[b.severity] ?? 99) || b.changedFileCount - a.changedFileCount
		})
}

function summarizeOverlayRisks(overlayRiskPlan) {
	const activeRisks = overlayRiskPlan.filter((risk) => risk.reviewRequired)
	return {
		reviewRequired: activeRisks.length > 0,
		activeRiskCount: activeRisks.length,
		criticalRiskCount: activeRisks.filter((risk) => risk.severity === "critical").length,
		highRiskCount: activeRisks.filter((risk) => risk.severity === "high").length,
		activeRisks: activeRisks.map((risk) => ({
			name: risk.name,
			severity: risk.severity,
			changedFileCount: risk.changedFileCount,
		})),
	}
}

function exportPatch(options, upstream) {
	if (!upstream.commit) {
		return null
	}
	fs.mkdirSync(options.outDir, { recursive: true })
	const safeRef = options.upstreamRef.replace(/[^a-zA-Z0-9._-]+/g, "-")
	const patchPath = path.join(options.outDir, `cline-${safeRef}.patch`)
	const baseCommit = mustGit(["rev-parse", "--verify", `${options.baseRef}^{commit}`])
	const mergeBase = git(["merge-base", baseCommit, upstream.commit])
	const patchBase = mergeBase.ok ? mergeBase.stdout.trim() : options.baseRef
	const patch = git(["diff", "--binary", `${patchBase}..${upstream.commit}`], { encoding: "buffer" })
	if (!patch.ok) {
		throw new Error(`Failed to export patch: ${patch.stderr?.toString() || patch.stdout?.toString() || "unknown error"}`)
	}
	fs.writeFileSync(patchPath, patch.stdout)
	return { path: patchPath, base: patchBase }
}

function buildReport(options, dirtyFiles, upstream, exportedPatch) {
	const branch = mustGit(["branch", "--show-current"]) || "(detached)"
	const head = mustGit(["rev-parse", "HEAD"])
	const remoteUrl = git(["remote", "get-url", options.remoteName])
	const baseCommit = mustGit(["rev-parse", "--verify", `${options.baseRef}^{commit}`])
	const mergeBase = upstream.commit ? git(["merge-base", baseCommit, upstream.commit]) : { ok: false, stdout: "" }
	const changedFiles = upstream.commit && mergeBase.ok ? listChangedFiles(mergeBase.stdout.trim(), upstream.commit) : []
	const overlayRiskPlan = findOverlayRisks(changedFiles)

	return {
		generatedAt: new Date().toISOString(),
		repoRoot,
		branch,
		head,
		baseRef: options.baseRef,
		baseCommit,
		workingTreeDirty: dirtyFiles.length > 0,
		dirtyFiles,
		upstream: {
			remoteName: options.remoteName,
			remoteUrl: remoteUrl.ok ? remoteUrl.stdout.trim() : options.upstreamUrl,
			requestedRef: options.upstreamRef,
			resolvedRef: upstream.ref,
			commit: upstream.commit,
			mergeBase: mergeBase.ok ? mergeBase.stdout.trim() : null,
		},
		exportedPatchPath: exportedPatch?.path ?? null,
		exportedPatchBase: exportedPatch?.base ?? null,
		layerPlan: countLayerHits(changedFiles),
		overlayRiskSummary: summarizeOverlayRisks(overlayRiskPlan),
		overlayRiskPlan,
		changedFileCount: changedFiles.length,
		changedFiles: changedFiles.slice(0, 200),
		codeVibeOverlayFiles,
		brandGuardCommands,
		finalValidationCommands,
		githubReleaseValidationCommands,
		recommendedCommands: [
			`npm --prefix apps/vscode run upstream:base:plan -- --fetch --upstream-ref ${options.upstreamRef} --write-report`,
			`git switch -c codex/upstream-base-${options.upstreamRef.replace(/[^a-zA-Z0-9._-]+/g, "-")}`,
			"Apply one layer at a time from the generated report or patch file.",
			"Re-apply or preserve the CodeVibe overlay files listed in the report before packaging.",
			...brandGuardCommands,
			...finalValidationCommands,
			...githubReleaseValidationCommands,
		],
	}
}

function writeReport(options, report) {
	fs.mkdirSync(options.outDir, { recursive: true })
	const reportPath = path.join(options.outDir, "intake-report.json")
	fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
	return reportPath
}

function printReadableReport(report, reportPath) {
	console.log("CodeVibe upstream base patch intake")
	console.log(`Branch: ${report.branch}`)
	console.log(`HEAD: ${report.head}`)
	console.log(`Upstream: ${report.upstream.remoteName} ${report.upstream.requestedRef}`)
	console.log(`Resolved upstream commit: ${report.upstream.commit ?? "(not fetched/found)"}`)
	console.log(`Changed files from upstream merge-base: ${report.changedFileCount}`)
	if (report.exportedPatchPath) {
		console.log(`Patch: ${report.exportedPatchPath}`)
		console.log(`Patch base: ${report.exportedPatchBase}`)
	}
	if (reportPath) {
		console.log(`Report: ${reportPath}`)
	}
	console.log("\nCodeVibe overlay risk summary:")
	if (!report.overlayRiskSummary.reviewRequired) {
		console.log("- No overlay collisions detected from the available upstream diff.")
	} else {
		console.log(
			`- Review required for ${report.overlayRiskSummary.activeRiskCount} overlay area(s), including ${report.overlayRiskSummary.criticalRiskCount} critical area(s).`,
		)
		for (const risk of report.overlayRiskPlan.filter((item) => item.reviewRequired).slice(0, 6)) {
			console.log(`- ${risk.severity}: ${risk.name} (${risk.changedFileCount} changed file(s))`)
			console.log(`  ${risk.reason}`)
			for (const file of risk.changedFiles.slice(0, 6)) {
				console.log(`  ${file.status} ${file.path}`)
			}
		}
	}
	console.log("\nPatch layers:")
	for (const layer of report.layerPlan) {
		console.log(`- ${layer.name}: ${layer.changedFiles.length} sampled changed file(s)`)
		for (const file of layer.changedFiles.slice(0, 8)) {
			console.log(`  ${file.status} ${file.path}`)
		}
	}
	console.log("\nCodeVibe overlay files to preserve/review:")
	for (const file of report.codeVibeOverlayFiles) {
		console.log(`- ${file}`)
	}
	console.log("\nRequired guard commands after each applied layer:")
	for (const command of report.brandGuardCommands) {
		console.log(`- ${command}`)
	}
	console.log("\nFinal validation before a VSIX or GitHub release:")
	for (const command of report.finalValidationCommands) {
		console.log(`- ${command}`)
	}
	console.log("\nGitHub release prerequisite check:")
	for (const command of report.githubReleaseValidationCommands) {
		console.log(`- ${command}`)
	}
	if (!report.upstream.commit) {
		console.log("\nUpstream ref is not available locally. Re-run with --fetch when network access is available.")
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2))
	const dirtyFiles = ensureCleanWorktree(options.allowDirty)
	if (options.fetch) {
		fetchUpstream(options)
	}
	const upstream = resolveRef(options)
	const exportedPatch = options.exportPatch ? exportPatch(options, upstream) : null
	const report = buildReport(options, dirtyFiles, upstream, exportedPatch)
	const reportPath = options.writeReport ? writeReport(options, report) : null

	if (options.json) {
		console.log(JSON.stringify({ ...report, reportPath }, null, 2))
		return
	}
	printReadableReport(report, reportPath)
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error))
	process.exit(1)
})
