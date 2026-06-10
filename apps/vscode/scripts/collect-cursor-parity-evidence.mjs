#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.join(__dirname, "..")
const repoRoot = path.join(projectRoot, "..", "..")
const defaultOutFile = path.join(projectRoot, "dist", "cursor-parity-evidence.local.md")
const localTsxCli = path.join("apps", "vscode", "node_modules", "tsx", "dist", "cli.mjs")

const safeCommands = [
	{
		label: "Git branch status",
		command: "git",
		args: ["status", "--short", "--branch"],
		cwd: repoRoot,
		requiredChecklist: true,
	},
	{
		label: "VSIX release preflight",
		command: process.execPath,
		args: ["apps/vscode/scripts/package-github-vsix.mjs", "--preflight"],
		cwd: repoRoot,
		requiredChecklist: true,
	},
	{
		label: "Release prerequisite JSON",
		command: process.execPath,
		args: ["apps/vscode/scripts/check-local-release-prereqs.mjs", "--json"],
		cwd: repoRoot,
		requiredChecklist: false,
	},
]

const requiredDependencyCommands = [
	{
		label: "Install extension dependencies",
		command: "npm",
		args: ["--prefix", "apps/vscode", "ci", "--include=optional"],
		cwd: repoRoot,
	},
	{
		label: "Install webview dependencies",
		command: "npm",
		args: ["--prefix", "apps/vscode/webview-ui", "ci", "--include=optional"],
		cwd: repoRoot,
	},
	{
		label: "Type check",
		command: "npm",
		args: ["--prefix", "apps/vscode", "run", "check-types"],
		cwd: repoRoot,
	},
	{
		label: "Lint",
		command: "npm",
		args: ["--prefix", "apps/vscode", "run", "lint"],
		cwd: repoRoot,
	},
	{
		label: "Unit tests",
		command: "npm",
		args: ["--prefix", "apps/vscode", "run", "test:unit"],
		cwd: repoRoot,
	},
	{
		label: "E2E tests",
		command: "npm",
		args: ["--prefix", "apps/vscode", "run", "test:e2e:optimal"],
		cwd: repoRoot,
	},
	{
		label: "Package and verify VSIX install",
		command: "npm",
		args: ["--prefix", "apps/vscode", "run", "package:github-vsix", "--", "--verify-install"],
		cwd: repoRoot,
	},
]

const retrievalIndexingCommands = [
	{
		label: "Retrieval/indexing privacy unit tests",
		command: "npm",
		args: [
			"--prefix",
			"apps/vscode",
			"run",
			"test:unit",
			"--",
			"--grep",
			"Cursor.*(ignore|retrieval|indexing)|retrieval privacy|host-index results|ripgrep fallback|searchWorkspaceItems|ignored list entries|SearchFilesToolHandler.execute|ListFilesToolHandler.execute|File Search|ClineIgnoreController",
		],
		cwd: repoRoot,
		category: "retrieval-indexing",
	},
	{
		label: "Hub retrieval workspace-boundary tests",
		command: process.execPath,
		args: [
			localTsxCli,
			"--tsconfig",
			"apps/cline-hub/tsconfig.json",
			"--test",
			"apps/cline-hub/src/server/desktop-commands.search.test.ts",
			"apps/cline-hub/src/server/workspace-boundary.test.ts",
		],
		cwd: repoRoot,
		category: "retrieval-indexing",
	},
]

const mcpOAuthCommands = [
	{
		label: "MCP install/OAuth VS Code unit tests",
		command: "npm",
		args: [
			"--prefix",
			"apps/vscode",
			"run",
			"test:unit",
			"--",
			"--grep",
			"CursorMcpInstall|MCP OAuth callback handling|McpOAuthRedirectResolver|authenticateMcpServer|installCursorMcpServer",
		],
		cwd: repoRoot,
		category: "mcp-oauth",
	},
	{
		label: "Hub MCP import/install/OAuth tests",
		command: process.execPath,
		args: [
			localTsxCli,
			"--tsconfig",
			"apps/cline-hub/tsconfig.json",
			"--test",
			"apps/cline-hub/src/server/mcp.test.ts",
			"apps/cline-hub/src/server/desktop-commands.mcp.test.ts",
		],
		cwd: repoRoot,
		category: "mcp-oauth",
	},
]

const standaloneUiCommands = [
	{
		label: "Standalone package artifact build and manifest verification",
		command: "npm",
		args: ["--prefix", "apps/vscode", "run", "compile-standalone"],
		cwd: repoRoot,
		category: "standalone-ui",
	},
	{
		label: "Standalone hub route/readiness tests",
		command: process.execPath,
		args: [
			localTsxCli,
			"--tsconfig",
			"apps/cline-hub/tsconfig.json",
			"--test",
			"apps/cline-hub/src/server/http.test.ts",
			"apps/cline-hub/src/server/standalone-readiness.test.ts",
			"apps/cline-hub/src/server/state-payloads.test.ts",
			"apps/cline-hub/src/server/cursor-launch.test.ts",
			"apps/cline-hub/src/server/desktop-commands.background-agent.test.ts",
		],
		cwd: repoRoot,
		category: "standalone-ui",
	},
	{
		label: "Standalone hub typecheck",
		command: process.execPath,
		args: ["node_modules/typescript/bin/tsc", "-p", "apps/cline-hub/tsconfig.json", "--noEmit"],
		cwd: repoRoot,
		category: "standalone-ui",
	},
	{
		label: "Standalone webview build",
		command: "npm",
		args: ["--prefix", "apps/cline-hub/src/webview", "run", "build"],
		cwd: repoRoot,
		category: "standalone-ui",
	},
]

const sandboxPolicyCommands = [
	{
		label: "Cursor sandbox policy unit tests",
		command: "npm",
		args: [
			"--prefix",
			"apps/vscode",
			"run",
			"test:unit",
			"--",
			"src/core/config/cursor-sandbox.test.ts",
			"src/core/task/tools/__tests__/ToolValidator.cursorSandbox.test.ts",
			"src/core/task/tools/utils/__tests__/PathResolver.cursorSandbox.test.ts",
			"src/core/task/tools/handlers/__tests__/PathToolHandlers.gracefulErrors.test.ts",
			"--grep",
			"cursor-sandbox config|ToolValidator Cursor sandbox|PathResolver Cursor sandbox|Cursor sandbox",
		],
		cwd: repoRoot,
		category: "sandbox-policy",
	},
]

function usage() {
	console.error(`Usage: collect-cursor-parity-evidence.mjs [--out-file <path>] [--run-required] [--run-retrieval-indexing] [--run-mcp-oauth] [--run-standalone-ui] [--run-sandbox-policy]

Generates a local Markdown evidence log for the Cursor-parity release gate.

Default mode records safe, non-mutating probes and marks dependency/build/test
commands as not run. Use --run-required only in a dependency-equipped checkout
where npm install, build, test, e2e, package, and VSIX smoke install are expected
to run. Use --run-retrieval-indexing to execute focused retrieval/indexing
privacy evidence without running the full dependency/build/e2e gate. Use
--run-mcp-oauth to execute focused Cursor MCP import/install/OAuth evidence.
Use --run-standalone-ui to execute focused standalone UI/readiness evidence.
Use --run-sandbox-policy to execute focused .cursor/sandbox.json policy evidence.`)
}

function parseArgs(argv) {
	const options = {
		outFile: defaultOutFile,
		runRequired: false,
		runRetrievalIndexing: false,
		runMcpOAuth: false,
		runStandaloneUi: false,
		runSandboxPolicy: false,
	}

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index]
		if (arg === "--out-file") {
			const value = argv[++index]
			if (!value) {
				throw new Error("--out-file requires a value")
			}
			options.outFile = path.resolve(value)
		} else if (arg === "--run-required") {
			options.runRequired = true
			options.runRetrievalIndexing = true
			options.runMcpOAuth = true
			options.runStandaloneUi = true
			options.runSandboxPolicy = true
		} else if (arg === "--run-retrieval-indexing") {
			options.runRetrievalIndexing = true
		} else if (arg === "--run-mcp-oauth") {
			options.runMcpOAuth = true
		} else if (arg === "--run-standalone-ui") {
			options.runStandaloneUi = true
		} else if (arg === "--run-sandbox-policy") {
			options.runSandboxPolicy = true
		} else if (arg === "-h" || arg === "--help") {
			usage()
			process.exit(0)
		} else {
			throw new Error(`Unknown argument: ${arg}`)
		}
	}

	return options
}

function commandLine(command, args) {
	return [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ")
}

function runCommand({ label, command, args, cwd }) {
	const startedAt = new Date().toISOString()
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		stdio: "pipe",
		shell: false,
	})
	const finishedAt = new Date().toISOString()
	if (result.error) {
		return {
			label,
			command: commandLine(command, args),
			status: "failed",
			exitCode: null,
			startedAt,
			finishedAt,
			stdout: result.stdout ?? "",
			stderr: result.stderr ?? result.error.message,
			error: result.error.code === "ENOENT" ? "not found on PATH" : result.error.message,
		}
	}
	return {
		label,
		command: commandLine(command, args),
		status: result.status === 0 ? "passed" : "failed",
		exitCode: result.status ?? 1,
		startedAt,
		finishedAt,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	}
}

function skippedCommand({ label, command, args }, reason) {
	return {
		label,
		command: commandLine(command, args),
		status: "not run",
		exitCode: null,
		startedAt: new Date().toISOString(),
		finishedAt: new Date().toISOString(),
		stdout: "",
		stderr: "",
		reason,
	}
}

function skippedRetrievalIndexingCommand(command) {
	return {
		...skippedCommand(command, "Skipped by default; rerun with --run-retrieval-indexing or --run-required."),
		category: command.category,
	}
}

function skippedMcpOAuthCommand(command) {
	return {
		...skippedCommand(command, "Skipped by default; rerun with --run-mcp-oauth or --run-required."),
		category: command.category,
	}
}

function skippedStandaloneUiCommand(command) {
	return {
		...skippedCommand(command, "Skipped by default; rerun with --run-standalone-ui or --run-required."),
		category: command.category,
	}
}

function skippedSandboxPolicyCommand(command) {
	return {
		...skippedCommand(command, "Skipped by default; rerun with --run-sandbox-policy or --run-required."),
		category: command.category,
	}
}

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function tryGit(args) {
	const result = spawnSync("git", args, {
		cwd: repoRoot,
		encoding: "utf8",
		stdio: "pipe",
		shell: false,
	})
	return result.status === 0 ? result.stdout.trim() : ""
}

function codeCliCandidates() {
	const candidates = []
	const configured = (process.env.CODEVIBE_VSCODE_CLI ?? "").trim()
	if (configured) {
		candidates.push(configured)
	}
	candidates.push("code")
	if (process.platform === "darwin") {
		candidates.push("/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code")
		if (os.homedir()) {
			candidates.push(path.join(os.homedir(), "Applications", "Visual Studio Code.app", "Contents", "Resources", "app", "bin", "code"))
		}
	}
	return [...new Set(candidates)]
}

function resolveVsCodeVersion() {
	for (const candidate of codeCliCandidates()) {
		const result = spawnSync(candidate, ["--version"], {
			cwd: repoRoot,
			encoding: "utf8",
			stdio: "pipe",
			shell: false,
		})
		if (!result.error && result.status === 0) {
			return {
				command: candidate,
				version: result.stdout.trim(),
			}
		}
	}
	return {
		command: "",
		version: "",
	}
}

function parsePrereqSummary(results) {
	const prereq = results.find((result) => result.label === "Release prerequisite JSON")
	if (!prereq?.stdout) {
		return undefined
	}
	try {
		return JSON.parse(prereq.stdout)
	} catch {
		return undefined
	}
}

function statusMarker(status) {
	if (status === "passed") {
		return "PASS"
	}
	if (status === "not run") {
		return "NOT RUN"
	}
	return "FAIL"
}

function fenced(value) {
	const trimmed = String(value ?? "").trim()
	return trimmed ? `\n\`\`\`text\n${trimmed}\n\`\`\`\n` : "\n_Not emitted._\n"
}

function outputTail(value, limit = 2000) {
	const text = String(value ?? "").trim()
	if (text.length <= limit) {
		return text
	}
	return `...${text.slice(-limit)}`
}

function renderCommandResult(result) {
	return `### ${result.label}

- Status: ${statusMarker(result.status)}
- Command: \`${result.command}\`
- Exit code: ${result.exitCode === null ? "n/a" : result.exitCode}
- Started: ${result.startedAt}
- Finished: ${result.finishedAt}
${result.reason ? `- Reason: ${result.reason}\n` : ""}${result.error ? `- Error: ${result.error}\n` : ""}
Stdout:${fenced(result.stdout)}
Stderr:${fenced(result.stderr)}
`
}

function renderRetrievalIndexingEvidence(results) {
	const retrievalResults = results.filter((result) => result.category === "retrieval-indexing")
	if (retrievalResults.length === 0) {
		return "_No retrieval/indexing evidence commands were configured._"
	}
	const rows = retrievalResults.map(
		(result) => `| ${statusMarker(result.status)} | ${result.label.replaceAll("|", "\\|")} | \`${result.command}\` |`,
	)
	return [
		"| Status | Check | Command |",
		"| --- | --- | --- |",
		...rows,
		"",
		"Focused evidence covers Cursor-compatible retrieval privacy for `.cursorignore`, `.cursorindexingignore`, host-index search, ripgrep fallback, `list_files`, `search_files`, and hub mention-search workspace boundaries.",
	].join("\n")
}

function renderMcpOAuthEvidence(results) {
	const mcpResults = results.filter((result) => result.category === "mcp-oauth")
	if (mcpResults.length === 0) {
		return "_No MCP install/OAuth evidence commands were configured._"
	}
	const rows = mcpResults.map(
		(result) => `| ${statusMarker(result.status)} | ${result.label.replaceAll("|", "\\|")} | \`${result.command}\` |`,
	)
	return [
		"| Status | Check | Command |",
		"| --- | --- | --- |",
		...rows,
		"",
		"Focused evidence covers Cursor-compatible MCP install routes, OAuth callback handling, hub `.cursor/mcp.json` import/source ownership, sanitized OAuth status, and standalone MCP authorization wiring.",
	].join("\n")
}

function renderStandaloneUiEvidence(results) {
	const standaloneResults = results.filter((result) => result.category === "standalone-ui")
	if (standaloneResults.length === 0) {
		return "_No standalone UI evidence commands were configured._"
	}
	const rows = standaloneResults.map(
		(result) => `| ${statusMarker(result.status)} | ${result.label.replaceAll("|", "\\|")} | \`${result.command}\` |`,
	)
	return [
		"| Status | Check | Command |",
		"| --- | --- | --- |",
		...rows,
		"",
		"Focused evidence covers the VS-Code-free standalone package artifact, `standalone.zip` manifest contract, hub UI route surface, dynamic standalone readiness metadata, Cursor URI launch/background-agent flow, hub typechecking, and production webview build.",
		"",
		"Standalone package: `npm --prefix apps/vscode run compile-standalone` builds `dist-standalone/standalone.zip` and runs `scripts/verify-standalone-package.mjs` against `standalone-manifest.json`, `codevibe-core.js`, the ProtoBus descriptor set, webview assets, external HostBridge requirements, and packaged native-module targets.",
		"",
		"Readiness endpoint: `GET /api/standalone-readiness` returns redacted capability metadata for CodeVibe standalone mode, Codex Home auth support, live hub/UI-client availability, Cursor-compatible routes, desktop commands, and settings surfaces.",
	].join("\n")
}

function renderSandboxPolicyEvidence(results) {
	const sandboxResults = results.filter((result) => result.category === "sandbox-policy")
	if (sandboxResults.length === 0) {
		return "_No sandbox policy evidence commands were configured._"
	}
	const rows = sandboxResults.map(
		(result) => `| ${statusMarker(result.status)} | ${result.label.replaceAll("|", "\\|")} | \`${result.command}\` |`,
	)
	return [
		"| Status | Check | Command |",
		"| --- | --- | --- |",
		...rows,
		"",
		"Focused evidence covers Cursor-compatible `.cursor/sandbox.json` parsing, conservative defaults, read/write path enforcement, network allow/deny validation, and path-handler blocking before filesystem, tree-sitter, or ripgrep work starts.",
	].join("\n")
}

function renderPrereqTable(summary) {
	if (!summary?.checks) {
		return "_Prerequisite JSON was unavailable._"
	}
	const rows = summary.checks.map((check) => {
		const fix = check.fix ? check.fix.replaceAll("|", "\\|") : ""
		return `| ${check.level} | ${check.label.replaceAll("|", "\\|")} | ${check.detail.replaceAll("|", "\\|")} | ${fix} |`
	})
	return [
		`Summary: ${summary.ok ? "ready" : "blocked"} (${summary.failures} failure(s), ${summary.warnings} warning(s))`,
		"",
		"| Level | Check | Detail | Fix |",
		"| --- | --- | --- | --- |",
		...rows,
	].join("\n")
}

function renderEvidence({
	metadata,
	results,
	prereqSummary,
	runRequired,
	runRetrievalIndexing,
	runMcpOAuth,
	runStandaloneUi,
	runSandboxPolicy,
}) {
	const generatedAt = new Date().toISOString()
	return `# CodeVibe Cursor-Parity Evidence

Generated: ${generatedAt}

This file is local validation evidence. It does not replace the final release gate. Set \`CODEVIBE_ALL_PARITY_VALIDATED=true\` only after every required local, CI, e2e, VSIX install, installed-VS-Code, and standalone UI check below has concrete passing evidence.

## Release Candidate

- Branch: ${metadata.branch || ""}
- Commit SHA: ${metadata.commit || ""}
- VSIX version: ${metadata.version || ""}
- Release tag: ${metadata.tag || ""}
- VS Code CLI: ${metadata.vsCodeCommand || ""}
- VS Code version:
${fenced(metadata.vsCodeVersion)}
- Operating system: ${metadata.os}
- Evidence owner:
- Validation date: ${generatedAt.slice(0, 10)}
- Required dependency/build commands executed: ${runRequired ? "yes" : "no"}
- Focused retrieval/indexing evidence executed: ${runRetrievalIndexing ? "yes" : "no"}
- Focused MCP install/OAuth evidence executed: ${runMcpOAuth ? "yes" : "no"}
- Focused standalone UI evidence executed: ${runStandaloneUi ? "yes" : "no"}
- Focused sandbox policy evidence executed: ${runSandboxPolicy ? "yes" : "no"}

## Preflight Summary

${renderPrereqTable(prereqSummary)}

## Retrieval/Indexing Evidence

${renderRetrievalIndexingEvidence(results)}

## MCP Install/OAuth Evidence

${renderMcpOAuthEvidence(results)}

## Standalone UI Evidence

${renderStandaloneUiEvidence(results)}

## Sandbox Policy Evidence

${renderSandboxPolicyEvidence(results)}

## Command Evidence

${results.map(renderCommandResult).join("\n")}

## CI Gates

- ext-vscode-test.yml result:
- ext-vscode-test-e2e.yml result:
- GitHub-only release dry run or packaging run:
- Marketplace workflow dry run, if marketplace publishing is planned:

## Installed VS Code Validation

- VSIX install command and output:
- \`code --list-extensions --show-versions | rg '^atnumridha\\.codevibe@'\` output:
- CodeVibe sidebar opens and renders the chat/composer:
- \`openai-codex\` is the default Plan provider and Act provider:
- Codex auth imports from \`~/.codex/auth.json\` without logging token values:
- Codex account, installation id, and model list are visible without exposing secrets:
- Plan mode explores first and does not edit files when strict Plan mode is enabled:
- Act mode applies a multi-file diff and shows reviewable changes:
- Terminal command approvals are shown and respected:
- MCP install flow works, including OAuth callback handling when applicable:
- Browser automation can launch, snapshot, click, type, and screenshot with configured privacy controls:
- Retrieval/indexing honors \`.cursorignore\`, \`.cursorindexingignore\`, and privacy gates:
- Background-agent launch creates the expected branch/worktree/session metadata:
- Cursor rules are imported from \`.cursorrules\` and \`.cursor/rules\`:
- Cursor MCP config imports from \`.cursor/mcp.json\`:
- Cursor sandbox policy imports from \`.cursor/sandbox.json\`:
- Cursor-compatible deeplinks validate and require confirmations for sensitive actions:
  - \`/createchat\`
  - \`/mcp/install\`
  - \`/background-agent\`
  - \`/settings\`
  - \`/prompt\`
  - \`/command\`
  - \`/rule\`
  - \`/pr-review\`
  - \`/plugin/add\`
  - \`/glass\`
  - \`/automation/ingest\`
  - \`/git/checkout\`
  - \`/git/branch\`
  - \`/git/commit\`
- \`/plugin/add?replace=true\` replaces only after confirmation:
- Disabling \`cline.cursorCompatibility.deepLinks.enabled\` blocks Cursor-compatible URI handling:

## Standalone UI Validation

- Desktop app launches without VS Code:
- Existing Codex auth state is detected from the configured Codex home:
- \`GET /api/standalone-readiness\` exposes VS-Code-free readiness metadata:
- \`dist-standalone/standalone.zip\` contains a verified \`standalone-manifest.json\`, \`codevibe-core.js\`, webview assets, descriptor set, external HostBridge contract, and target native module paths:
- Cursor URI preview and launch work from the standalone settings UI:
- Browser controls, retrieval/indexing controls, background-agent sessions, MCP import/install, plugin add/replace, rule review, git helpers, and NDJSON ingest are visible and functional:
- Secret-bearing URL query strings, tokens, headers, and config values are redacted from previews, logs, and UI metadata:

## Release Decision

- All local checks passed:
- All CI checks passed:
- VSIX install smoke passed:
- Manual installed-VS-Code validation passed:
- Standalone UI validation passed:
- Known residual risks:
- Release approver:
`
}

function main() {
	const options = parseArgs(process.argv.slice(2))
	const packageJson = readJson(path.join(projectRoot, "package.json"))
	const vsCode = resolveVsCodeVersion()
	const metadata = {
		branch: tryGit(["rev-parse", "--abbrev-ref", "HEAD"]),
		commit: tryGit(["rev-parse", "HEAD"]),
		version: packageJson.version,
		tag: packageJson.version ? `v${packageJson.version}` : "",
		vsCodeCommand: vsCode.command,
		vsCodeVersion: vsCode.version,
		os: `${os.type()} ${os.release()} ${os.arch()}`,
	}

	const results = safeCommands.map(runCommand)
	if (options.runRequired) {
		for (const command of requiredDependencyCommands) {
			results.push(runCommand(command))
		}
	} else {
		const reason = "Skipped by default; rerun with --run-required in a dependency-equipped checkout."
		for (const command of requiredDependencyCommands) {
			results.push(skippedCommand(command, reason))
		}
	}
	if (options.runRetrievalIndexing) {
		for (const command of retrievalIndexingCommands) {
			results.push({
				...runCommand(command),
				category: command.category,
			})
		}
	} else {
		for (const command of retrievalIndexingCommands) {
			results.push(skippedRetrievalIndexingCommand(command))
		}
	}
	if (options.runMcpOAuth) {
		for (const command of mcpOAuthCommands) {
			results.push({
				...runCommand(command),
				category: command.category,
			})
		}
	} else {
		for (const command of mcpOAuthCommands) {
			results.push(skippedMcpOAuthCommand(command))
		}
	}
	if (options.runStandaloneUi) {
		for (const command of standaloneUiCommands) {
			results.push({
				...runCommand(command),
				category: command.category,
			})
		}
	} else {
		for (const command of standaloneUiCommands) {
			results.push(skippedStandaloneUiCommand(command))
		}
	}
	if (options.runSandboxPolicy) {
		for (const command of sandboxPolicyCommands) {
			results.push({
				...runCommand(command),
				category: command.category,
			})
		}
	} else {
		for (const command of sandboxPolicyCommands) {
			results.push(skippedSandboxPolicyCommand(command))
		}
	}

	const evidence = renderEvidence({
		metadata,
		results,
		prereqSummary: parsePrereqSummary(results),
		runRequired: options.runRequired,
		runRetrievalIndexing: options.runRetrievalIndexing,
		runMcpOAuth: options.runMcpOAuth,
		runStandaloneUi: options.runStandaloneUi,
		runSandboxPolicy: options.runSandboxPolicy,
	})

	fs.mkdirSync(path.dirname(options.outFile), { recursive: true })
	fs.writeFileSync(options.outFile, evidence, "utf8")
	console.log(`Cursor-parity evidence written to ${options.outFile}`)
	const failedResults = results.filter((result) => result.status === "failed")
	const failed = failedResults.length
	const skipped = results.filter((result) => result.status === "not run").length
	console.log(`${failed} failed command(s), ${skipped} not run command(s).`)
	if (failedResults.length > 0) {
		console.error("Failed evidence command summary:")
		for (const result of failedResults) {
			console.error(`\n[${result.label}] exit ${result.exitCode === null ? "n/a" : result.exitCode}`)
			console.error(`Command: ${result.command}`)
			const stderr = outputTail(result.stderr)
			const stdout = outputTail(result.stdout)
			if (stderr) {
				console.error(`Stderr tail:\n${stderr}`)
			}
			if (stdout) {
				console.error(`Stdout tail:\n${stdout}`)
			}
			if (result.error) {
				console.error(`Error: ${result.error}`)
			}
		}
	}
	process.exit(
		failed === 0 &&
			(skipped === 0 ||
				options.runRetrievalIndexing ||
				options.runMcpOAuth ||
				options.runStandaloneUi ||
				options.runSandboxPolicy)
			? 0
			: 1,
	)
}

try {
	main()
} catch (error) {
	console.error(
		`collect-cursor-parity-evidence: ${error instanceof Error ? error.message : String(error)}`,
	)
	process.exit(1)
}
