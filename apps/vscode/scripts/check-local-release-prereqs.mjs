#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.join(__dirname, "..")
const repoRoot = path.join(projectRoot, "..", "..")

function usage() {
	console.error(`Usage: check-local-release-prereqs.mjs [--release] [--candidate|--final] [--github-release] [--json]

Checks local prerequisites for CodeVibe VSIX packaging, installed VS Code smoke validation,
and optional local GitHub Release creation.

Use --candidate for draft/prerelease validation VSIX releases. Final releases remain
the default and require CODEVIBE_ALL_PARITY_VALIDATED=true plus an https:// evidence URL.`)
}

function parseArgs(argv) {
	const options = {
		release: false,
		releaseStage: "final",
		githubRelease: false,
		json: false,
	}

	for (const arg of argv) {
		if (arg === "--release") {
			options.release = true
		} else if (arg === "--candidate") {
			options.releaseStage = "candidate"
		} else if (arg === "--final") {
			options.releaseStage = "final"
		} else if (arg === "--github-release") {
			options.githubRelease = true
		} else if (arg === "--json") {
			options.json = true
		} else if (arg === "-h" || arg === "--help") {
			usage()
			process.exit(0)
		} else {
			throw new Error(`Unknown argument: ${arg}`)
		}
	}

	return options
}

function exists(filePath) {
	return fs.existsSync(filePath)
}

function commandResult(command, args = ["--version"], cwd = projectRoot) {
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		stdio: "pipe",
		shell: false,
	})

	if (result.error) {
		return {
			ok: false,
			error: result.error.code === "ENOENT" ? "not found on PATH" : result.error.message,
		}
	}

	return {
		ok: result.status === 0,
		output: [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
		status: result.status,
	}
}

function commandOk(command, args) {
	return commandResult(command, args).ok
}

function readPackageJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function isHttpsUrl(value) {
	try {
		const url = new URL(value)
		return url.protocol === "https:" && Boolean(url.hostname)
	} catch {
		return false
	}
}

function add(checks, level, label, detail, fix) {
	checks.push({ level, label, detail, ...(fix ? { fix } : {}) })
}

function checkNode(checks) {
	const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10)
	if (major >= 22) {
		add(checks, "pass", "Node.js", `found ${process.version}`)
		return
	}
	add(checks, "fail", "Node.js", `found ${process.version}; Node 22 or newer is required`)
}

function checkCommand(checks, command, label, fix, args = ["--version"], required = true) {
	const result = commandResult(command, args)
	if (result.ok) {
		add(checks, "pass", label, result.output.split("\n")[0] || `${command} is available`)
		return true
	}
	add(checks, required ? "fail" : "warn", label, result.error || `exit ${result.status ?? 1}`, fix)
	return false
}

function checkDependencies(checks) {
	const extensionNodeModules = path.join(projectRoot, "node_modules")
	const webviewNodeModules = path.join(projectRoot, "webview-ui", "node_modules")
	const localVsce = path.join(
		extensionNodeModules,
		".bin",
		process.platform === "win32" ? "vsce.cmd" : "vsce",
	)

	if (exists(extensionNodeModules)) {
		add(checks, "pass", "Extension dependencies", "apps/vscode/node_modules exists")
	} else {
		add(
			checks,
			"fail",
			"Extension dependencies",
			"apps/vscode/node_modules is missing",
			"Run: npm --prefix apps/vscode ci --include=optional",
		)
	}

	if (exists(webviewNodeModules)) {
		add(checks, "pass", "Webview dependencies", "apps/vscode/webview-ui/node_modules exists")
	} else {
		add(
			checks,
			"fail",
			"Webview dependencies",
			"apps/vscode/webview-ui/node_modules is missing",
			"Run: npm --prefix apps/vscode/webview-ui ci --include=optional",
		)
	}

	if (exists(localVsce) || commandOk("vsce", ["--version"])) {
		add(
			checks,
			"pass",
			"VSIX packager",
			exists(localVsce) ? "local @vscode/vsce is installed" : "global vsce is available",
		)
	} else {
		add(
			checks,
			"fail",
			"VSIX packager",
			"@vscode/vsce is not available locally or globally",
			"Run: npm --prefix apps/vscode ci --include=optional",
		)
	}
}

function checkBuildOutputs(checks) {
	const extensionBundle = path.join(projectRoot, "dist", "extension.js")
	const webviewBuild = path.join(projectRoot, "webview-ui", "build")

	if (exists(extensionBundle) && fs.statSync(extensionBundle).isFile() && fs.statSync(extensionBundle).size > 0) {
		add(checks, "pass", "Extension build output", "dist/extension.js exists")
	} else {
		add(
			checks,
			"fail",
			"Extension build output",
			"dist/extension.js is missing or empty",
			"Run from apps/vscode: npm run package",
		)
	}

	if (exists(webviewBuild) && fs.statSync(webviewBuild).isDirectory() && fs.readdirSync(webviewBuild).length > 0) {
		add(checks, "pass", "Webview build output", "webview-ui/build contains assets")
	} else {
		add(
			checks,
			"fail",
			"Webview build output",
			"webview-ui/build is missing or empty",
			"Run from apps/vscode: npm run build:webview",
		)
	}
}

function checkMarketplaceReadme(checks) {
	const readmePath = path.join(projectRoot, "README.md")
	const marketplaceReadmePath = path.join(projectRoot, "README.marketplace.md")
	const backupPath = path.join(projectRoot, ".README.github.bak")

	if (exists(readmePath) && fs.statSync(readmePath).isFile()) {
		add(checks, "pass", "README.md", "packaged README.md exists")
	} else {
		add(checks, "fail", "README.md", "apps/vscode/README.md is missing")
	}

	if (exists(marketplaceReadmePath) && fs.statSync(marketplaceReadmePath).isFile()) {
		add(checks, "pass", "Marketplace README", "README.marketplace.md exists")
	} else {
		add(checks, "fail", "Marketplace README", "README.marketplace.md is missing")
	}

	if (exists(backupPath)) {
		add(
			checks,
			"fail",
			"Marketplace README backup",
			".README.github.bak exists",
			"Run: node scripts/marketplace-readme.mjs restore",
		)
	} else {
		add(checks, "pass", "Marketplace README backup", "no stale .README.github.bak")
	}
}

function checkVsCodeCli(checks) {
	const configuredCode = (process.env.CODEVIBE_VSCODE_CLI ?? "").trim()
	if (configuredCode) {
		const result = commandResult(configuredCode, ["--version"])
		if (result.ok) {
			add(checks, "pass", "VS Code CLI", `CODEVIBE_VSCODE_CLI works: ${configuredCode}`)
			return
		}
		add(
			checks,
			"fail",
			"VS Code CLI",
			`CODEVIBE_VSCODE_CLI failed: ${result.error || result.status}`,
			"Point CODEVIBE_VSCODE_CLI at a working VS Code CLI",
		)
		return
	}

	if (commandOk("code", ["--version"])) {
		add(checks, "pass", "VS Code CLI", "code is available on PATH")
		return
	}

	const testElectronPackage = path.join(
		projectRoot,
		"node_modules",
		"@vscode",
		"test-electron",
		"package.json",
	)
	if (exists(testElectronPackage)) {
		add(
			checks,
			"warn",
			"VS Code CLI",
			"code is not on PATH; package-github-vsix can fall back to @vscode/test-electron",
		)
		return
	}

	add(
		checks,
		"fail",
		"VS Code CLI",
		"code is not on PATH and @vscode/test-electron is not installed",
		"Install the code command, set CODEVIBE_VSCODE_CLI, or install extension dependencies",
	)
}

function checkReleaseGate(checks, requireGate, releaseStage) {
	const allParityValidated = process.env.CODEVIBE_ALL_PARITY_VALIDATED
	const evidenceUrl = (process.env.CODEVIBE_PARITY_EVIDENCE_URL ?? "").trim()

	if (allParityValidated === "true" && isHttpsUrl(evidenceUrl)) {
		add(checks, "pass", "Cursor-parity release gate", `evidence: ${evidenceUrl}`)
		return
	}

	if (releaseStage === "candidate") {
		add(
			checks,
			"pass",
			"Cursor-parity release gate",
			"candidate release; final parity evidence is intentionally pending",
		)
		return
	}

	const level = requireGate ? "fail" : "warn"
	if (allParityValidated !== "true") {
		add(
			checks,
			level,
			"Cursor-parity validation",
			"CODEVIBE_ALL_PARITY_VALIDATED is not true",
			"Set it only after local, CI, e2e, VSIX install, and manual installed-VS-Code validation pass",
		)
	}
	if (!isHttpsUrl(evidenceUrl)) {
		add(
			checks,
			level,
			"Cursor-parity evidence",
			"CODEVIBE_PARITY_EVIDENCE_URL is missing or not https://",
			"Point it at the final validation log or release checklist",
		)
	}
}

function checkPackageVersion(checks) {
	const packageJson = readPackageJson(path.join(projectRoot, "package.json"))
	const version = packageJson.version
	if (/^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?$/.test(version)) {
		add(checks, "pass", "VSIX version", `${version}; expected release tag v${version}`)
		return
	}
	add(checks, "fail", "VSIX version", `invalid apps/vscode/package.json version: ${version}`)
}

function checkGitState(checks, requireClean) {
	const result = commandResult("git", ["status", "--short"], repoRoot)
	if (!result.ok) {
		add(checks, "warn", "Git status", result.error || `exit ${result.status ?? 1}`)
		return
	}
	if (!result.output) {
		add(checks, "pass", "Git status", "working tree is clean")
		return
	}
	add(
		checks,
		requireClean ? "fail" : "warn",
		"Git status",
		"working tree has uncommitted changes",
		"Commit or stash changes before final release packaging",
	)
}

function summarize(checks) {
	const failures = checks.filter((check) => check.level === "fail")
	const warnings = checks.filter((check) => check.level === "warn")
	return {
		ok: failures.length === 0,
		failures: failures.length,
		warnings: warnings.length,
		checks,
	}
}

function printText(summary) {
	console.log("CodeVibe VSIX release preflight")
	for (const check of summary.checks) {
		const marker = check.level === "pass" ? "[pass]" : check.level === "warn" ? "[warn]" : "[fail]"
		console.log(`${marker} ${check.label}: ${check.detail}`)
		if (check.fix) {
			console.log(`       ${check.fix}`)
		}
	}
	console.log("")
	if (summary.ok) {
		console.log(`Ready for local packaging with ${summary.warnings} warning(s).`)
	} else {
		console.log(`Blocked by ${summary.failures} failure(s) and ${summary.warnings} warning(s).`)
	}
}

function main() {
	const options = parseArgs(process.argv.slice(2))
	const checks = []

	checkNode(checks)
	checkCommand(checks, "npm", "npm", "Install npm or use a Node distribution that includes it")
	checkDependencies(checks)
	checkBuildOutputs(checks)
	checkMarketplaceReadme(checks)
	checkVsCodeCli(checks)
	checkPackageVersion(checks)
	checkGitState(checks, options.release)
	checkReleaseGate(checks, options.release, options.releaseStage)

	if (options.githubRelease) {
		checkCommand(
			checks,
			"gh",
			"GitHub CLI",
			"Install gh or use .github/workflows/ext-vscode-github-release.yml",
		)
	}

	const summary = summarize(checks)
	if (options.json) {
		console.log(JSON.stringify(summary, null, 2))
	} else {
		printText(summary)
	}

	process.exit(summary.ok ? 0 : 1)
}

try {
	main()
} catch (error) {
	console.error(
		`check-local-release-prereqs: ${error instanceof Error ? error.message : String(error)}`,
	)
	process.exit(1)
}
