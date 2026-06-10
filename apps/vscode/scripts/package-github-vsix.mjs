#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import zlib from "node:zlib"
import { assertCursorParityReleaseGate } from "./assert-cursor-parity-release-gate.mjs"
import { restore as restoreMarketplaceReadme, swapIn as swapInMarketplaceReadme } from "./marketplace-readme.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.join(__dirname, "..")
const repoRoot = path.join(projectRoot, "..", "..")
const packageJsonPath = path.join(projectRoot, "package.json")
const nativeAgentMarkdownPath = path.join(projectRoot, "agents", "00-codevibe-agent.agent.md")

const requiredCursorParityConfigKeys = [
	"codevibe.openAiCodex.authSource",
	"codevibe.compatibility.enabled",
	"codevibe.compatibility.deepLinks.enabled",
	"codevibe.compatibility.retrievalIndexing.privacyGate",
	"codevibe.compatibility.sandboxPolicy",
	"codevibe.compatibility.safeBrowserEvaluate.enabled",
	"codevibe.cursorCompatibility.enabled",
	"codevibe.cursorCompatibility.deepLinks.enabled",
	"codevibe.cursorCompatibility.retrievalIndexing.privacyGate",
	"codevibe.cursorCompatibility.sandboxPolicy",
	"codevibe.cursorCompatibility.safeBrowserEvaluate.enabled",
	"codevibe.ui.preferOpenAiCodexSidebar",
	"ndjson.port",
	"ndjson.bindAddress",
]

const disallowedLegacyConfigurationPrefixes = ["cline.openAiCodex.", "cline.cursorCompatibility.", "cline.ui."]

const requiredCursorParityCommands = [
	"codevibe.compatibility.ndjson.start",
	"codevibe.compatibility.ndjson.stop",
	"codevibe.compatibility.ndjson.copyCurl",
	"codevibe.compatibility.ndjson.reassignPort",
	"codevibe.compatibility.ndjson.showStatus",
	"codevibe.compatibility.deeplink.debug.trigger",
	"codevibe.nativeAgentDiagnostics",
	"codevibe.newNativeAgentSession",
]

const requiredCursorParityLegacyActivationCommands = [
	"cursor.ndjsonIngest.start",
	"cursor.ndjsonIngest.stop",
	"cursor.ndjsonIngest.copyCurl",
	"cursor.ndjsonIngest.reassignPort",
	"cursor.ndjsonIngest.showStatus",
	"cursor-deeplink.debug.triggerDeeplink",
]

const expectedManifestAssetPaths = [
	"agents/00-codevibe-agent.agent.md",
	"assets/prompts/codevibe-plan.prompt.md",
	"assets/prompts/codevibe-review.prompt.md",
	"assets/prompts/codevibe-standalone-readiness.prompt.md",
	"assets/prompts/skills/codevibe-background-sessions/SKILL.md",
	"assets/prompts/skills/codevibe-cursor-compatibility/SKILL.md",
	"assets/prompts/skills/codevibe-customizations/SKILL.md",
	"assets/prompts/skills/codevibe-mcp/SKILL.md",
	"assets/prompts/skills/codevibe-performance-troubleshooting/SKILL.md",
	"assets/prompts/skills/codevibe-release-validation/SKILL.md",
	"assets/icons/icon.png",
	"assets/icons/codevibe-glyph.woff",
	"walkthrough/step1.md",
	"walkthrough/step2.md",
	"walkthrough/step3.md",
	"walkthrough/step4.md",
	"walkthrough/step5.md",
]

const packagedMarkdownAssetPaths = [
	"README.md",
	"agents/00-codevibe-agent.agent.md",
	"assets/prompts/codevibe-plan.prompt.md",
	"assets/prompts/codevibe-review.prompt.md",
	"assets/prompts/codevibe-standalone-readiness.prompt.md",
	"assets/prompts/skills/codevibe-background-sessions/SKILL.md",
	"assets/prompts/skills/codevibe-cursor-compatibility/SKILL.md",
	"assets/prompts/skills/codevibe-customizations/SKILL.md",
	"assets/prompts/skills/codevibe-mcp/SKILL.md",
	"assets/prompts/skills/codevibe-performance-troubleshooting/SKILL.md",
	"assets/prompts/skills/codevibe-release-validation/SKILL.md",
	"walkthrough/step1.md",
	"walkthrough/step2.md",
	"walkthrough/step3.md",
	"walkthrough/step4.md",
	"walkthrough/step5.md",
]

const upstreamLicenseNotice = "[Apache 2.0 \u00a9 2026 Cline Bot Inc.](./LICENSE)"
const upstreamLicensePlaceholder = "__CODEVIBE_UPSTREAM_CLINE_LICENSE_NOTICE__"

const disallowedPackagedMarkdownFragments = [
	"docs.cline.bot",
	"app.cline.bot",
	"api.cline.bot",
	"cline.bot",
	"github.com/cline/cline",
	"discord.gg/cline",
	"reddit.com/r/cline",
	"saoudrizwan.claude-dev",
]

const disallowedPackagedVisibleTextFragments = [
	"<title>Cline",
	"<title>Antigravity",
	"<title>VibeCode",
	"Launch Cursor",
	"Choose Cursor",
	"Import Cursor",
	"Global Cursor",
	"Start Cursor",
	"Cursor automation",
	"Cursor background",
	"Cursor git helper",
	"Run Cursor",
	"Create Cursor",
	"Install Cursor plugin",
	"Direct push from Cursor",
	"recognized Cursor",
	"Failed to install Cursor",
	"Open in Cursor",
	"Cursor rule",
	"Cursor-parity",
	"Cursor inputs",
	"cline-bot",
	"cline.bot",
	"https://cline.bot",
	"github.com/cline/plugins.git",
	"cline-vscode-extension",
	"~/.cline/data/tasks",
	"~/.cline/data/checkpoints",
	'HTTP-Referer": "https://cline.bot',
	'HTTP-Referer":"https://cline.bot',
	'X-Title": "Cline',
	'X-Title":"Cline',
	'User-Agent": "Cline/',
	'User-Agent":"Cline/',
	"https://avatars.githubusercontent.com/u/184127137",
	"Please sign in to access Cline services.",
	"Open in Cline",
	"submits a prompt to Cline",
	"when Cline reaches a user-attention boundary",
	"proto/cline/state.proto",
	"What can I do for you?",
	"Workspace console",
	"Starter workflows",
	"works best with Claude models",
	"recommended to use Claude 4.5 Sonnet",
	"models like Claude Sonnet",
	"cursor://createchat",
	"Cursor workspace",
	"Cursor global",
]

const packagedWebviewHtmlTitlePattern = /<title>\s*CodeVibe\s*<\/title>/i

const vscodeChatAgentContributionKeys = new Set(["id", "path", "name", "description", "when", "sessionTypes"])
const vscodeChatPromptContributionKeys = new Set(["path", "name", "description", "when", "sessionTypes"])
const vscodeChatSessionContributionKeys = new Set([
	"id",
	"type",
	"name",
	"displayName",
	"description",
	"when",
	"icon",
	"order",
	"alternativeIds",
	"welcomeTitle",
	"welcomeMessage",
	"welcomeTips",
	"inputPlaceholder",
	"capabilities",
	"commands",
	"canDelegate",
	"customAgentTarget",
	"requiresCustomModels",
	"autoAttachReferences",
	"useRequestToPopulateBuiltInPickers",
])
const vscodeChatSessionCapabilitiesKeys = new Set([
	"supportsFileAttachments",
	"supportsToolAttachments",
	"supportsMCPAttachments",
	"supportsImageAttachments",
	"supportsSearchResultAttachments",
	"supportsInstructionAttachments",
	"supportsSourceControlAttachments",
	"supportsProblemAttachments",
	"supportsSymbolAttachments",
	"supportsPromptAttachments",
	"supportsHandOffs",
])
const vscodeChatSessionCommandKeys = new Set(["id", "description", "when"])

const disallowedVsixEntryPrefixes = [
	"extension/testing-platform/",
	"extension/tests/",
	"extension/webview-ui/.storybook/",
	"extension/scripts/",
	"extension/proto/",
	"extension/assets/icons/robot_panel_",
]

const disallowedVsixEntries = new Set([
	"extension/.nycrc.unit.json",
	"extension/.env.example",
	"extension/biome.jsonc",
	"extension/esbuild.mjs",
	"extension/knip.json",
	"extension/skills-lock.json",
	"extension/test-setup.js",
	"extension/assets/icons/sleepy-codevibe.svg",
	"extension/webview-ui/components.json",
	"extension/webview-ui/tailwind.config.mjs",
	"extension/webview-ui/tsconfig.app.json",
	"extension/webview-ui/tsconfig.json",
	"extension/webview-ui/tsconfig.node.json",
])

const githubVsixManifestOverrides = {
	name: "codevibe",
	displayName: "CodeVibe",
	description:
		"CodeVibe editor-native coding agent for VS Code, with Codex auth, planning, tools, MCP, browser automation, and background workflows.",
	publisher: "atnumridha",
	author: {
		name: "CodeVibe",
	},
	repository: {
		type: "git",
		url: "https://github.com/atnumridha/codevibe",
	},
	homepage: "https://github.com/atnumridha/codevibe",
}

const visibleManifestStringKeys = new Set(["category", "description", "title"])
const defaultCommandTimeoutMs = readPositiveIntegerEnv("CODEVIBE_PACKAGE_COMMAND_TIMEOUT_MS", 10 * 60 * 1000)
const vsCodeSmokeInstallTimeoutMs = readPositiveIntegerEnv("CODEVIBE_VSCODE_SMOKE_INSTALL_TIMEOUT_MS", 3 * 60 * 1000)

function readPositiveIntegerEnv(name, fallback) {
	const rawValue = process.env[name]
	if (!rawValue?.trim()) {
		return fallback
	}
	const value = Number(rawValue)
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`${name} must be a positive integer number of milliseconds`)
	}
	return Math.trunc(value)
}

function formatDuration(ms) {
	if (ms >= 1000 && ms % 1000 === 0) {
		return `${ms / 1000}s`
	}
	return `${ms}ms`
}

function usage() {
	console.error(
		"Usage: package-github-vsix.mjs [--out-dir <dir>] [--out-file <path>] [--pre-release] [--install] [--verify-install] [--write-native-agent-launcher] [--enable-native-agent-argv] [--code <path>] [--print-metadata] [--preflight] [--require-release-gate] [--clean-legacy-view-state-only]",
	)
}

function parseArgs(argv) {
	const options = {
		outDir: "dist",
		outFile: undefined,
		install: false,
		verifyInstall: false,
		writeNativeAgentLauncher: false,
		enableNativeAgentArgv: false,
		code: undefined,
		preRelease: false,
		printMetadata: false,
		preflight: false,
		requireReleaseGate: false,
		cleanLegacyViewStateOnly: false,
	}

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index]
		if (arg === "--out-dir") {
			const outDir = argv[++index]
			if (!outDir) {
				throw new Error("--out-dir requires a value")
			}
			options.outDir = outDir
		} else if (arg === "--out-file") {
			const outFile = argv[++index]
			if (!outFile) {
				throw new Error("--out-file requires a value")
			}
			options.outFile = outFile
		} else if (arg === "--pre-release") {
			options.preRelease = true
		} else if (arg === "--install") {
			options.install = true
		} else if (arg === "--verify-install") {
			options.verifyInstall = true
		} else if (arg === "--write-native-agent-launcher") {
			options.writeNativeAgentLauncher = true
		} else if (arg === "--enable-native-agent-argv") {
			options.enableNativeAgentArgv = true
		} else if (arg === "--code") {
			const code = argv[++index]
			if (!code) {
				throw new Error("--code requires a value")
			}
			options.code = code
		} else if (arg === "--print-metadata") {
			options.printMetadata = true
		} else if (arg === "--preflight") {
			options.preflight = true
		} else if (arg === "--require-release-gate") {
			options.requireReleaseGate = true
		} else if (arg === "--clean-legacy-view-state-only") {
			options.cleanLegacyViewStateOnly = true
		} else if (arg === "-h" || arg === "--help") {
			usage()
			process.exit(0)
		} else {
			throw new Error(`Unknown argument: ${arg}`)
		}
	}

	return options
}

function commandCandidates(name) {
	const localBin = path.join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name)
	return fs.existsSync(localBin)
		? [localBin, process.platform === "win32" ? `${name}.cmd` : name]
		: [process.platform === "win32" ? `${name}.cmd` : name]
}

function macVsCodeCliCandidates() {
	if (process.platform !== "darwin") {
		return []
	}
	const home = os.homedir()
	return [
		"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
		...(home
			? [path.join(home, "Applications", "Visual Studio Code.app", "Contents", "Resources", "app", "bin", "code")]
			: []),
	]
}

function codeCommandCandidates(codePath) {
	if (codePath) {
		return [codePath]
	}
	if (process.env.CODEVIBE_VSCODE_CLI) {
		return [process.env.CODEVIBE_VSCODE_CLI]
	}
	return [...commandCandidates("code"), ...macVsCodeCliCandidates()]
}

function findExistingCodeInvocation(codePath) {
	for (const command of codeCommandCandidates(codePath)) {
		const result = spawnSync(command, ["--version"], {
			cwd: projectRoot,
			encoding: "utf8",
			stdio: "pipe",
			shell: shouldRunCommandViaShell(command),
		})

		if (!result.error && result.status === 0) {
			return { command, baseArgs: [] }
		}
		if (result.error && result.error.code !== "ENOENT") {
			throw result.error
		}
	}
	return undefined
}

async function resolveCodeInvocation(codePath) {
	const existing = findExistingCodeInvocation(codePath)
	if (existing) {
		return existing
	}

	try {
		const { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, SilentReporter } = await import(
			"@vscode/test-electron"
		)
		const executablePath = await downloadAndUnzipVSCode("stable", undefined, new SilentReporter())
		const [command, ...baseArgs] = resolveCliArgsFromVSCodeExecutablePath(executablePath)
		return { command, baseArgs }
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		throw new Error(
			`Unable to resolve a VS Code CLI for smoke install. Install the code command, pass --code <path>, or install @vscode/test-electron. Cause: ${message}`,
		)
	}
}

function quoteCommand(command, args) {
	return [command, ...args].join(" ")
}

function shouldRunCommandViaShell(command) {
	return process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command)
}

function shellQuote(value) {
	return `'${String(value).replace(/'/g, "'\\''")}'`
}

function resolveNativeAgentLauncherPath(outPath) {
	const extension = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "command" : "sh"
	return path.join(path.dirname(outPath), `launch-codevibe-native-agent.${extension}`)
}

function writeNativeAgentLauncher(outPath, metadata, codePath) {
	const launcherPath = resolveNativeAgentLauncherPath(outPath)
	fs.mkdirSync(path.dirname(launcherPath), { recursive: true })

	if (process.platform === "win32") {
		const fallbackCodeCommand = "%LocalAppData%\\Programs\\Microsoft VS Code\\bin\\code.cmd"
		const content = [
			"@echo off",
			"setlocal",
			`set "CODEVIBE_VSIX=${outPath}"`,
			`set "CODEVIBE_EXTENSION_ID=${metadata.extensionId}"`,
			`if not defined CODEVIBE_VSCODE_CLI set "CODEVIBE_VSCODE_CLI=${codePath || fallbackCodeCommand}"`,
			`"%CODEVIBE_VSCODE_CLI%" --install-extension "%CODEVIBE_VSIX%" --force`,
			`"%CODEVIBE_VSCODE_CLI%" --enable-proposed-api "%CODEVIBE_EXTENSION_ID%" %*`,
			"endlocal",
			"",
		].join("\r\n")
		fs.writeFileSync(launcherPath, content)
		console.log(`Native agent launcher written to ${launcherPath}`)
		return launcherPath
	}

	const defaultCodeCli =
		codePath ||
		(process.platform === "darwin" ? "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" : "code")
	const content = [
		"#!/usr/bin/env bash",
		"set -euo pipefail",
		`CODEVIBE_VSIX=${shellQuote(outPath)}`,
		`CODEVIBE_EXTENSION_ID=${shellQuote(metadata.extensionId)}`,
		`CODE_BIN=\${CODEVIBE_VSCODE_CLI:-${shellQuote(defaultCodeCli)}}`,
		'if [[ ! -x "$CODE_BIN" && "$CODE_BIN" == /* ]]; then',
		"  CODE_BIN=code",
		"fi",
		'"$CODE_BIN" --install-extension "$CODEVIBE_VSIX" --force',
		"if [[ $# -eq 0 ]]; then",
		'  set -- "$PWD"',
		"fi",
		'exec "$CODE_BIN" --enable-proposed-api "$CODEVIBE_EXTENSION_ID" "$@"',
		"",
	].join("\n")
	fs.writeFileSync(launcherPath, content, { mode: 0o755 })
	fs.chmodSync(launcherPath, 0o755)
	console.log(`Native agent launcher written to ${launcherPath}`)
	return launcherPath
}

function resolveVSCodeArgvJsonPath() {
	if (process.env.CODEVIBE_VSCODE_ARGV_JSON?.trim()) {
		return path.resolve(process.env.CODEVIBE_VSCODE_ARGV_JSON.trim())
	}
	if (process.platform === "darwin") {
		return path.join(os.homedir(), "Library", "Application Support", "Code", "User", "argv.json")
	}
	if (process.platform === "win32") {
		const appData = process.env.APPDATA?.trim() || path.join(os.homedir(), "AppData", "Roaming")
		return path.join(appData, "Code", "User", "argv.json")
	}
	const configHome = process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), ".config")
	return path.join(configHome, "Code", "User", "argv.json")
}

function resolveLegacyVSCodeArgvJsonPaths() {
	if (process.env.CODEVIBE_VSCODE_ARGV_JSON?.trim()) {
		return []
	}
	if (process.platform === "darwin") {
		return [path.join(os.homedir(), "Library", "Application Support", "Code", "argv.json")]
	}
	if (process.platform === "win32") {
		const appData = process.env.APPDATA?.trim() || path.join(os.homedir(), "AppData", "Roaming")
		return [path.join(appData, "Code", "argv.json")]
	}
	const configHome = process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), ".config")
	return [path.join(configHome, "Code", "argv.json")]
}

function stripJsonComments(text) {
	return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

function readVSCodeArgvJson(argvPath) {
	if (!fs.existsSync(argvPath)) {
		return {}
	}
	const text = fs.readFileSync(argvPath, "utf8")
	if (!text.trim()) {
		return {}
	}
	try {
		return JSON.parse(stripJsonComments(text))
	} catch (error) {
		throw new Error(
			`Unable to parse VS Code argv.json at ${argvPath}. Please fix it or set CODEVIBE_VSCODE_ARGV_JSON to a writable test file. Cause: ${
				error instanceof Error ? error.message : String(error)
			}`,
		)
	}
}

function enableNativeAgentInVSCodeArgv(metadata) {
	const argvPath = resolveVSCodeArgvJsonPath()
	const argv = readVSCodeArgvJson(argvPath)
	const legacyEnabled = []
	for (const legacyArgvPath of resolveLegacyVSCodeArgvJsonPaths()) {
		if (!fs.existsSync(legacyArgvPath)) {
			continue
		}
		const legacyArgv = readVSCodeArgvJson(legacyArgvPath)
		if (Array.isArray(legacyArgv["enable-proposed-api"])) {
			legacyEnabled.push(...legacyArgv["enable-proposed-api"].filter((value) => typeof value === "string"))
		}
	}
	const existing = Array.isArray(argv["enable-proposed-api"])
		? argv["enable-proposed-api"].filter((value) => typeof value === "string")
		: []
	const enabled = Array.from(new Set([...existing, ...legacyEnabled, metadata.extensionId])).sort()
	if (existing.length === enabled.length && existing.every((value, index) => value === enabled[index])) {
		console.log(`VS Code argv already enables proposed API for ${metadata.extensionId}: ${argvPath}`)
		return argvPath
	}

	fs.mkdirSync(path.dirname(argvPath), { recursive: true })
	fs.writeFileSync(argvPath, `${JSON.stringify({ ...argv, "enable-proposed-api": enabled }, null, "\t")}\n`, "utf8")
	console.log(`VS Code argv enables proposed API for ${metadata.extensionId}: ${argvPath}`)
	return argvPath
}

function runCommand(candidates, args, options = {}) {
	let lastError
	const timeoutMs = options.timeoutMs ?? defaultCommandTimeoutMs
	for (const command of candidates) {
		const result = spawnSync(command, args, {
			cwd: projectRoot,
			encoding: "utf8",
			stdio: options.capture ? "pipe" : "inherit",
			shell: shouldRunCommandViaShell(command),
			timeout: timeoutMs,
		})

		if (!result.error) {
			if (result.status !== 0) {
				const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
				throw new Error(
					`${quoteCommand(command, args)} failed with exit code ${result.status ?? 1}${output ? `\n${output}` : ""}`,
				)
			}
			return result
		}

		lastError = result.error
		if (result.error.code === "ETIMEDOUT") {
			throw new Error(`${quoteCommand(command, args)} timed out after ${formatDuration(timeoutMs)}`)
		}
		if (result.error.code !== "ENOENT") {
			throw result.error
		}
	}

	throw lastError ?? new Error(`Unable to find command: ${candidates.join(" or ")}`)
}

function installSignalCleanup(cleanup) {
	let interrupted = false
	const cleanupOnSignal = (exitCode) => () => {
		interrupted = true
		try {
			cleanup()
		} catch (error) {
			console.error(
				`package-github-vsix: failed to restore package inputs on signal: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
		process.exit(exitCode)
	}
	const onSigint = cleanupOnSignal(130)
	const onSigterm = cleanupOnSignal(143)
	process.on("SIGINT", onSigint)
	process.on("SIGTERM", onSigterm)
	return {
		get interrupted() {
			return interrupted
		},
		remove() {
			process.off("SIGINT", onSigint)
			process.off("SIGTERM", onSigterm)
		},
	}
}

function readPackageJson() {
	return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
}

function writePackageJson(packageJson) {
	fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, "\t")}\n`)
}

function replaceVisibleClineBrand(value) {
	return value.replace(/\bCline\b/g, "CodeVibe")
}

function replaceVisibleMarkdownBrand(value) {
	return replaceVisibleClineBrand(value.replace(upstreamLicenseNotice, upstreamLicensePlaceholder)).replace(
		upstreamLicensePlaceholder,
		upstreamLicenseNotice,
	)
}

function brandVisibleManifestStrings(value, key) {
	if (typeof value === "string") {
		return visibleManifestStringKeys.has(key) ? replaceVisibleClineBrand(value) : value
	}
	if (Array.isArray(value)) {
		return value.map((item) => brandVisibleManifestStrings(item, ""))
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([entryKey, entryValue]) => [entryKey, brandVisibleManifestStrings(entryValue, entryKey)]),
		)
	}
	return value
}

function createGithubVsixPackageJson(packageJson) {
	const githubVsixPackageJson = brandVisibleManifestStrings(
		{
			...packageJson,
			...githubVsixManifestOverrides,
			keywords: Array.from(new Set(["codevibe", ...(Array.isArray(packageJson.keywords) ? packageJson.keywords : [])])),
		},
		"",
	)
	for (const key of ["scripts", "lint-staged", "devDependencies"]) {
		delete githubVsixPackageJson[key]
	}
	return githubVsixPackageJson
}

function readPackageMetadata(packageJson = readPackageJson()) {
	if (typeof packageJson.version !== "string" || !packageJson.version.trim()) {
		throw new Error("apps/vscode/package.json is missing a version")
	}
	if (typeof packageJson.publisher !== "string" || !packageJson.publisher.trim()) {
		throw new Error("apps/vscode/package.json is missing a publisher")
	}
	if (typeof packageJson.name !== "string" || !packageJson.name.trim()) {
		throw new Error("apps/vscode/package.json is missing a name")
	}
	return {
		extensionId: `${packageJson.publisher.trim()}.${packageJson.name.trim()}`,
		version: packageJson.version.trim(),
	}
}

function resolveOutputPath(options, metadata) {
	if (options.outFile) {
		return path.resolve(projectRoot, options.outFile)
	}
	const outDir = path.resolve(projectRoot, options.outDir)
	return path.join(outDir, `codevibe-${metadata.version}.vsix`)
}

function verifyInstalledExtension(listOutput, expectedExtension) {
	const expected = expectedExtension.toLowerCase()
	const installed = listOutput
		.split(/\r?\n/)
		.map((line) => line.trim().toLowerCase())
		.filter(Boolean)

	if (!installed.includes(expected)) {
		throw new Error(
			`VSIX smoke install did not find ${expectedExtension}. Installed extensions:\n${listOutput.trim() || "(none)"}`,
		)
	}
}

function resolveVsCodeUserStorageDir() {
	if (process.env.VSCODE_PORTABLE) {
		return path.join(process.env.VSCODE_PORTABLE, "user-data", "User")
	}
	if (process.platform === "darwin") {
		return path.join(os.homedir(), "Library", "Application Support", "Code", "User")
	}
	if (process.platform === "win32") {
		const appData = process.env.APPDATA
		return appData ? path.join(appData, "Code", "User") : undefined
	}
	const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
	return path.join(configHome, "Code", "User")
}

function resolveVsCodeUserStorageDirs() {
	const dirs = new Set()
	const primary = resolveVsCodeUserStorageDir()
	if (primary) {
		dirs.add(primary)
	}
	if (process.env.CODEVIBE_VSCODE_USER_STORAGE_DIRS?.trim()) {
		for (const entry of process.env.CODEVIBE_VSCODE_USER_STORAGE_DIRS.split(path.delimiter)) {
			if (entry.trim()) {
				dirs.add(path.resolve(entry.trim()))
			}
		}
	}
	if (!process.env.VSCODE_PORTABLE && process.platform === "darwin") {
		dirs.add(path.join(os.homedir(), "Library", "Application Support", "VibeCode IDE", "User"))
	}
	return [...dirs]
}

function resolveVsCodeExtensionsDir() {
	if (process.env.CODEVIBE_VSCODE_EXTENSIONS_DIR?.trim()) {
		return path.resolve(process.env.CODEVIBE_VSCODE_EXTENSIONS_DIR.trim())
	}
	if (process.env.VSCODE_PORTABLE) {
		return path.join(process.env.VSCODE_PORTABLE, "extensions")
	}
	return path.join(os.homedir(), ".vscode", "extensions")
}

function pruneInstalledCodeVibeExtensionVersions(metadata) {
	const extensionsDir = resolveVsCodeExtensionsDir()
	if (!fs.existsSync(extensionsDir)) {
		return
	}
	const extensionPrefix = `${metadata.extensionId.toLowerCase()}-`
	const currentExtensionDir = `${metadata.extensionId.toLowerCase()}-${metadata.version.toLowerCase()}`
	let removed = 0
	for (const entry of fs.readdirSync(extensionsDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue
		}
		const entryName = entry.name.toLowerCase()
		if (!entryName.startsWith(extensionPrefix) || entryName === currentExtensionDir) {
			continue
		}
		const extensionPath = path.join(extensionsDir, entry.name)
		fs.rmSync(extensionPath, { recursive: true, force: true })
		removed++
	}
	if (removed > 0) {
		console.log(`Removed ${removed} stale CodeVibe extension version folder(s) from ${extensionsDir}`)
	}
}

function writeInstalledNativeAgentCache(metadata) {
	const markdown = readNativeAgentMarkdown()
	for (const userStorageDir of resolveVsCodeUserStorageDirs()) {
		if (!userStorageDir) {
			continue
		}
		const agentDir = path.join(userStorageDir, "globalStorage", metadata.extensionId, "native-agents")
		const agentPath = path.join(agentDir, "00-codevibe-agent.agent.md")
		fs.mkdirSync(agentDir, { recursive: true })
		fs.writeFileSync(agentPath, markdown, "utf8")
		console.log(`Repaired CodeVibe native agent cache file: ${agentPath}`)
	}
}

function readNativeAgentMarkdown() {
	return fs.readFileSync(nativeAgentMarkdownPath, "utf8")
}

function runSqlite(databasePath, sql) {
	return spawnSync("sqlite3", [databasePath, sql], {
		cwd: projectRoot,
		encoding: "utf8",
		stdio: "pipe",
		shell: false,
	})
}

function filterJsonArrayByIdSql(key, legacyIds) {
	const quotedIds = legacyIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ")
	const escapedKey = key.replace(/'/g, "''")
	const valueClauses = legacyIds.map((id) => `value like '%${id.replace(/'/g, "''")}%'`).join(" or ")
	return `
		update ItemTable
		set value = coalesce((
			select json_group_array(json(value))
			from json_each(ItemTable.value)
			where coalesce(json_extract(value, '$.id'), '') not in (${quotedIds})
		), '[]')
		where key = '${escapedKey}' and (${valueClauses});
	`
}

function filterJsonArrayByIdPatternSql(keyLikePattern, legacyIds) {
	const quotedIds = legacyIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ")
	const escapedPattern = keyLikePattern.replace(/'/g, "''")
	const valueClauses = legacyIds.map((id) => `value like '%${id.replace(/'/g, "''")}%'`).join(" or ")
	return `
		update ItemTable
		set value = coalesce((
			select json_group_array(json(value))
			from json_each(ItemTable.value)
			where coalesce(json_extract(value, '$.id'), '') not in (${quotedIds})
		), '[]')
		where key like '${escapedPattern}' and (${valueClauses});
	`
}

function filterJsonObjectKeysContainingSql(key, legacyFragments) {
	const escapedKey = key.replace(/'/g, "''")
	const valueClauses = legacyFragments.map((fragment) => `value like '%${fragment.replace(/'/g, "''")}%'`).join(" or ")
	const keepClauses = legacyFragments
		.map((fragment) => `json_each.key not like '%${fragment.replace(/'/g, "''")}%'`)
		.join(" and ")
	return `
		update ItemTable
		set value = coalesce((
			select json_group_object(json_each.key, json_each.value)
			from json_each(ItemTable.value)
			where ${keepClauses}
		), '{}')
		where key = '${escapedKey}' and (${valueClauses});
	`
}

function filterJsonObjectKeysByNamePatternSql(keyLikePattern, targetKeys) {
	const quotedKeys = targetKeys.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ")
	const escapedPattern = keyLikePattern.replace(/'/g, "''")
	const valueClauses = targetKeys.map((id) => `value like '%${id.replace(/'/g, "''")}%'`).join(" or ")
	return `
		update ItemTable
		set value = coalesce((
			select json_group_object(json_each.key, json(json_each.value))
			from json_each(ItemTable.value)
			where json_each.key not in (${quotedKeys})
		), '{}')
		where key like '${escapedPattern}' and (${valueClauses});
	`
}

function hideJsonArrayEntriesByIdSql(key, targetIds) {
	const quotedIds = targetIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ")
	const escapedKey = key.replace(/'/g, "''")
	const valueClauses = targetIds.map((id) => `value like '%${id.replace(/'/g, "''")}%'`).join(" or ")
	return `
		update ItemTable
		set value = coalesce((
			select json_group_array(json_set(json_each.value, '$.visible', json('false')))
			from json_each(ItemTable.value)
		), '[]')
		where key = '${escapedKey}'
			and (${valueClauses})
			and exists (
				select 1
				from json_each(ItemTable.value)
				where coalesce(json_extract(json_each.value, '$.id'), '') in (${quotedIds})
			);
	`
}

function hideAuxiliaryBarForViewIdsSql(targetIds) {
	const quotedIds = targetIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ")
	const stateValueClauses = targetIds.map((id) => `state.value like '%${id.replace(/'/g, "''")}%'`).join(" or ")
	return `
		update ItemTable
		set value = 'true'
		where key = 'workbench.auxiliaryBar.hidden'
			and (
				exists (
					select 1
					from ItemTable active
					where active.key = 'workbench.auxiliarybar.activepanelid'
						and active.value in (${quotedIds})
				)
				or exists (
					select 1
					from ItemTable state, json_each(state.value)
					where state.key = 'workbench.auxiliarybar.viewContainersWorkspaceState'
						and (${stateValueClauses})
						and coalesce(json_extract(json_each.value, '$.id'), '') in (${quotedIds})
						and coalesce(json_extract(json_each.value, '$.visible'), 0) = 1
				)
			);
	`
}

function cleanLegacyCodeVibeViewStateDatabase(databasePath) {
	const legacyActivityViewIds = [
		"workbench.view.extension.claude-dev-ActivityBar",
		"workbench.view.extension.codevibe-ActivityBar",
		"workbench.view.extension.codevibe.agent",
		"workbench.view.extension.vibecodeAgentSidebar",
		"workbench.view.extension.vibecodex-agent-extension-container",
	]
	const legacyWebviewViewIds = [
		"claude-dev.SidebarProvider",
		"codevibe.SidebarProvider",
		"codevibe.agentPanel",
		"vibecode.agent",
		"vibecode.agentPanel",
		"vibecodex-agent-extension-view",
	]
	const legacyStateKeyFragments = [...legacyActivityViewIds, ...legacyWebviewViewIds]
	const competingAuxiliaryViewIds = [
		"workbench.view.extension.codexSecondaryViewContainer",
		"workbench.panel.chat",
		"workbench.viewContainer.agentSessions",
	]
	const sql = [
		filterJsonArrayByIdSql("workbench.activity.pinnedViewlets2", legacyActivityViewIds),
		filterJsonArrayByIdSql("workbench.activity.placeholderViewlets", legacyActivityViewIds),
		filterJsonArrayByIdSql("workbench.activity.viewletsWorkspaceState", legacyActivityViewIds),
		filterJsonArrayByIdPatternSql("workbench.%.views.state.hidden", legacyWebviewViewIds),
		filterJsonObjectKeysByNamePatternSql("workbench.%.views.state", legacyWebviewViewIds),
		filterJsonObjectKeysContainingSql("memento/webviewViews.origins", legacyWebviewViewIds),
		filterJsonObjectKeysContainingSql("memento/mainThreadWebviewPanel.origins", legacyWebviewViewIds),
		filterJsonObjectKeysContainingSql("__$__targetStorageMarker", legacyStateKeyFragments),
		hideAuxiliaryBarForViewIdsSql([...legacyActivityViewIds, ...competingAuxiliaryViewIds]),
		filterJsonArrayByIdSql("workbench.auxiliarybar.placeholderPanels", legacyActivityViewIds),
		filterJsonArrayByIdSql("workbench.auxiliarybar.pinnedPanels", legacyActivityViewIds),
		filterJsonArrayByIdSql("workbench.auxiliarybar.viewContainersWorkspaceState", legacyActivityViewIds),
		hideJsonArrayEntriesByIdSql("workbench.auxiliarybar.viewContainersWorkspaceState", competingAuxiliaryViewIds),
		hideJsonArrayEntriesByIdSql("workbench.auxiliarybar.pinnedPanels", competingAuxiliaryViewIds),
		`
		delete from ItemTable
		where key in (
			'workbench.view.extension.claude-dev-ActivityBar.state',
			'workbench.view.extension.claude-dev-ActivityBar.state.hidden',
			'workbench.view.extension.claude-dev-ActivityBar.numberOfVisibleViews',
			'workbench.view.extension.codevibe-ActivityBar.state',
			'workbench.view.extension.codevibe-ActivityBar.state.hidden',
			'workbench.view.extension.codevibe-ActivityBar.numberOfVisibleViews',
			'workbench.view.extension.codevibe.agent.state',
			'workbench.view.extension.codevibe.agent.state.hidden',
			'workbench.view.extension.codevibe.agent.numberOfVisibleViews',
			'workbench.view.extension.vibecodeAgentSidebar.state',
			'workbench.view.extension.vibecodeAgentSidebar.state.hidden',
			'workbench.view.extension.vibecodeAgentSidebar.numberOfVisibleViews',
			'workbench.view.extension.vibecodex-agent-extension-container.state',
			'workbench.view.extension.vibecodex-agent-extension-container.state.hidden',
			'workbench.view.extension.vibecodex-agent-extension-container.numberOfVisibleViews',
			'memento/webviewView.claude-dev.SidebarProvider',
			'memento/webviewView.codevibe.SidebarProvider',
			'memento/webviewView.codevibe.agentPanel',
			'memento/webviewView.vibecode.agent',
			'memento/webviewView.vibecode.agentPanel',
			'memento/webviewView.vibecodex-agent-extension-view'
		);
		`,
		`
		update ItemTable
		set value = 'workbench.view.explorer'
		where key = 'workbench.sidebar.activeviewletid'
			and value in (
				'workbench.view.extension.claude-dev-ActivityBar',
				'workbench.view.extension.codevibe-ActivityBar',
				'workbench.view.extension.codevibe.agent',
				'workbench.view.extension.vibecodeAgentSidebar',
				'workbench.view.extension.vibecodex-agent-extension-container'
			);
		`,
		`
		delete from ItemTable
		where key = 'workbench.auxiliarybar.activepanelid'
			and value in (
				'workbench.view.extension.claude-dev-ActivityBar',
				'workbench.view.extension.codevibe-ActivityBar',
				'workbench.view.extension.codevibe.agent',
				'workbench.view.extension.vibecodeAgentSidebar',
				'workbench.view.extension.vibecodex-agent-extension-container',
				'workbench.view.extension.codexSecondaryViewContainer',
				'workbench.panel.chat',
				'workbench.viewContainer.agentSessions'
			);
		`,
	].join("\n")
	const result = runSqlite(databasePath, sql)
	if (result.error?.code === "ENOENT") {
		throw new Error("sqlite3 is required to clean legacy VS Code view state")
	}
	if (result.error) {
		throw result.error
	}
	if (result.status !== 0) {
		const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
		throw new Error(output || `sqlite3 failed for ${databasePath}`)
	}
}

function cleanLegacyCodeVibeViewState() {
	const databasePaths = []
	for (const userStorageDir of resolveVsCodeUserStorageDirs()) {
		if (!userStorageDir || !fs.existsSync(userStorageDir)) {
			continue
		}
		const globalState = path.join(userStorageDir, "globalStorage", "state.vscdb")
		if (fs.existsSync(globalState)) {
			databasePaths.push(globalState)
		}
		const workspaceStorageDir = path.join(userStorageDir, "workspaceStorage")
		if (fs.existsSync(workspaceStorageDir)) {
			for (const entry of fs.readdirSync(workspaceStorageDir, { withFileTypes: true })) {
				if (!entry.isDirectory()) {
					continue
				}
				const stateDb = path.join(workspaceStorageDir, entry.name, "state.vscdb")
				if (fs.existsSync(stateDb)) {
					databasePaths.push(stateDb)
				}
			}
		}
	}
	if (databasePaths.length === 0) {
		return
	}
	let cleaned = 0
	for (const databasePath of databasePaths) {
		cleanLegacyCodeVibeViewStateDatabase(databasePath)
		cleaned++
	}
	console.log(`Cleaned legacy CodeVibe sidebar view state in ${cleaned} VS Code storage database(s)`)
}

function assertFileExists(filePath, label, options = {}) {
	if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
		throw new Error(`Missing ${label}: ${path.relative(projectRoot, filePath)}`)
	}
	if (options.nonEmpty && fs.statSync(filePath).size === 0) {
		throw new Error(`Empty ${label}: ${path.relative(projectRoot, filePath)}`)
	}
}

function assertDirectoryHasFiles(dirPath, label) {
	if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
		throw new Error(`Missing ${label}: ${path.relative(projectRoot, dirPath)}`)
	}
	const entries = fs.readdirSync(dirPath)
	if (entries.length === 0) {
		throw new Error(`Empty ${label}: ${path.relative(projectRoot, dirPath)}`)
	}
}

function assertArrayIncludes(values, expected, label) {
	if (!Array.isArray(values) || !values.includes(expected)) {
		throw new Error(`${label} must include ${expected}`)
	}
}

function assertArrayExcludes(values, expected, label) {
	if (Array.isArray(values) && values.includes(expected)) {
		throw new Error(`${label} must not include ${expected}`)
	}
}

function assertOnlyAllowedObjectKeys(value, allowedKeys, label) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`)
	}
	for (const key of Object.keys(value)) {
		if (!allowedKeys.has(key)) {
			throw new Error(`${label} contains unsupported VS Code contribution property '${key}'`)
		}
	}
}

function assertObjectHasKey(object, key, label) {
	if (!object || typeof object !== "object" || Array.isArray(object) || !(key in object)) {
		throw new Error(`${label} is missing ${key}`)
	}
	return object[key]
}

function assertVisibleManifestStringsBranded(value, label, pathParts = []) {
	if (typeof value === "string") {
		const key = pathParts.at(-1) ?? ""
		if (visibleManifestStringKeys.has(key) && /\bCline\b/.test(value)) {
			throw new Error(`${label} visible manifest string ${pathParts.join(".")} must use CodeVibe branding`)
		}
		return
	}
	if (Array.isArray(value)) {
		value.forEach((item, index) => {
			assertVisibleManifestStringsBranded(item, label, [...pathParts, String(index)])
		})
		return
	}
	if (value && typeof value === "object") {
		for (const [key, entryValue] of Object.entries(value)) {
			assertVisibleManifestStringsBranded(entryValue, label, [...pathParts, key])
		}
	}
}

function assertNativeCodeVibeContributionIds(packageJson, label) {
	const activityBarContainers = packageJson.contributes?.viewsContainers?.activitybar ?? []
	const activityBarIds = activityBarContainers.map((container) => container?.id).filter(Boolean)
	for (const id of activityBarIds) {
		if (!/^[A-Za-z0-9_-]+$/.test(id)) {
			throw new Error(`${label} activity bar container '${id}' must use only alphanumeric characters, '_' or '-'`)
		}
	}
	if (!activityBarIds.includes("codevibe-agent")) {
		throw new Error(`${label} must contribute the native codevibe-agent activity bar container`)
	}
	if (activityBarIds.includes("codevibe-ActivityBar")) {
		throw new Error(`${label} must not contribute the legacy CodeVibe activity bar container`)
	}
	if (activityBarIds.includes("claude-dev-ActivityBar")) {
		throw new Error(`${label} must not contribute the legacy claude-dev activity bar container`)
	}

	const views = packageJson.contributes?.views ?? {}
	const registeredViewContainerIds = new Set(activityBarIds)
	for (const viewGroup of Object.keys(views)) {
		if (viewGroup.startsWith("codevibe") && !registeredViewContainerIds.has(viewGroup)) {
			throw new Error(`${label} contributes views under '${viewGroup}' without a matching view container`)
		}
	}
	const codeVibeAgentViews = Array.isArray(views["codevibe-agent"]) ? views["codevibe-agent"] : []
	const codeVibeAgentViewIds = codeVibeAgentViews.map((view) => view?.id).filter(Boolean)
	if (!codeVibeAgentViewIds.includes("codevibe-agent-chat")) {
		throw new Error(`${label} must contribute the native codevibe-agent-chat webview`)
	}
	const codeVibeAgentWebview = codeVibeAgentViews.find((view) => view?.id === "codevibe-agent-chat")
	if (codeVibeAgentWebview?.visibility !== "hidden") {
		throw new Error(`${label} codevibe-agent-chat webview must be hidden by default so native VS Code Chat is primary`)
	}
	const chatParticipants = Array.isArray(packageJson.contributes?.chatParticipants)
		? packageJson.contributes.chatParticipants
		: []
	const codeVibeAgentParticipant = chatParticipants.find((participant) => participant?.id === "codevibe")
	if (!codeVibeAgentParticipant) {
		throw new Error(`${label} must contribute the native codevibe chat participant`)
	}
	if (codeVibeAgentParticipant.name !== "codevibe" || codeVibeAgentParticipant.fullName !== "CodeVibe Agent") {
		throw new Error(`${label} codevibe chat participant must be named CodeVibe Agent`)
	}
	if (codeVibeAgentParticipant.isDefault !== true) {
		throw new Error(`${label} codevibe chat participant must be the default agent-mode participant`)
	}
	if (!Array.isArray(codeVibeAgentParticipant.locations) || !codeVibeAgentParticipant.locations.includes("panel")) {
		throw new Error(`${label} codevibe chat participant must target the native Chat panel`)
	}
	if (!Array.isArray(codeVibeAgentParticipant.modes) || !codeVibeAgentParticipant.modes.includes("agent")) {
		throw new Error(`${label} codevibe chat participant must register for native agent mode`)
	}
	const chatAgents = Array.isArray(packageJson.contributes?.chatAgents) ? packageJson.contributes.chatAgents : []
	for (const [index, agent] of chatAgents.entries()) {
		assertOnlyAllowedObjectKeys(agent, vscodeChatAgentContributionKeys, `${label} chatAgents[${index}]`)
		if (typeof agent?.path !== "string" || agent.path.trim() === "") {
			throw new Error(`${label} chatAgents[${index}] must declare a non-empty path`)
		}
		if (typeof agent?.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(agent.id)) {
			throw new Error(`${label} chatAgents[${index}] must declare a package-safe id`)
		}
	}
	const codeVibeAgent = chatAgents.find((agent) => agent?.path === "agents/00-codevibe-agent.agent.md")
	if (!codeVibeAgent) {
		throw new Error(`${label} must contribute the native CodeVibe chat agent markdown`)
	}
	if (codeVibeAgent !== chatAgents[0]) {
		throw new Error(`${label} must list CodeVibe chat agent before other chat agents`)
	}
	if (
		codeVibeAgent.id !== "codevibe" ||
		codeVibeAgent.name !== "codevibe" ||
		!String(codeVibeAgent.description ?? "").includes("CodeVibe Agent")
	) {
		throw new Error(`${label} CodeVibe chat agent contribution must be named and described as CodeVibe Agent`)
	}
	const chatSessions = Array.isArray(packageJson.contributes?.chatSessions) ? packageJson.contributes.chatSessions : []
	for (const [index, session] of chatSessions.entries()) {
		assertOnlyAllowedObjectKeys(session, vscodeChatSessionContributionKeys, `${label} chatSessions[${index}]`)
		const sessionId = session?.id
		if (typeof sessionId !== "string" || sessionId.trim() === "") {
			throw new Error(`${label} chatSessions[${index}] must declare a non-empty id`)
		}
		if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
			throw new Error(
				`${label} chatSessions[${index}] id '${sessionId}' must use only alphanumeric characters, '_' or '-'`,
			)
		}
		const sessionType = session?.type
		if (typeof sessionType !== "string" || sessionType.trim() === "") {
			throw new Error(`${label} chatSessions[${index}] must declare a non-empty type`)
		}
		if (!/^[A-Za-z0-9_-]+$/.test(sessionType)) {
			throw new Error(
				`${label} chatSessions[${index}] type '${sessionType}' must use only alphanumeric characters, '_' or '-'`,
			)
		}
		if (sessionId !== sessionType) {
			throw new Error(`${label} chatSessions[${index}] id must match type for native VS Code registration`)
		}
		if (session.capabilities !== undefined) {
			assertOnlyAllowedObjectKeys(
				session.capabilities,
				vscodeChatSessionCapabilitiesKeys,
				`${label} chatSessions[${index}].capabilities`,
			)
		}
		for (const [commandIndex, command] of (Array.isArray(session.commands) ? session.commands : []).entries()) {
			assertOnlyAllowedObjectKeys(
				command,
				vscodeChatSessionCommandKeys,
				`${label} chatSessions[${index}].commands[${commandIndex}]`,
			)
		}
	}
	const codeVibeSession = chatSessions.find((session) => session?.type === "agent-host-codevibe")
	if (!codeVibeSession) {
		throw new Error(`${label} must contribute the native agent-host-codevibe chat session`)
	}
	if (codeVibeSession !== chatSessions[0]) {
		throw new Error(`${label} must list agent-host-codevibe before Copilot-style providers`)
	}
	if (codeVibeSession.name !== "CodeVibe Agent" || codeVibeSession.displayName !== "CodeVibe Agent") {
		throw new Error(`${label} agent-host-codevibe chat session must display as CodeVibe Agent`)
	}
	if (typeof codeVibeSession.order !== "number" || codeVibeSession.order >= 0) {
		throw new Error(`${label} agent-host-codevibe chat session must be ordered before Copilot-style providers`)
	}
	if (codeVibeSession.customAgentTarget !== "codevibe") {
		throw new Error(`${label} agent-host-codevibe chat session must target CodeVibe custom agents`)
	}
	const codeVibeLegacySession = chatSessions.find((session) => session?.type === "codevibe-agent")
	if (codeVibeLegacySession) {
		throw new Error(`${label} must not contribute duplicate codevibe-agent chat session alias`)
	}
	const newSessionMenu = Array.isArray(packageJson.contributes?.menus?.["chatSessions/newSession"])
		? packageJson.contributes.menus["chatSessions/newSession"]
		: []
	const codeVibeNewSessionMenu = newSessionMenu.find((item) => item?.command === "codevibe.newNativeAgentSession")
	if (!codeVibeNewSessionMenu) {
		throw new Error(`${label} must contribute a CodeVibe command to chatSessions/newSession`)
	}
	if (codeVibeNewSessionMenu !== newSessionMenu[0] || codeVibeNewSessionMenu.group !== "navigation@-1000") {
		throw new Error(`${label} CodeVibe chatSessions/newSession menu must be first in navigation`)
	}
	if (codeVibeNewSessionMenu.when !== undefined) {
		throw new Error(`${label} CodeVibe chatSessions/newSession menu must be visible before Copilot sessions`)
	}

	const expectedPromptPaths = expectedManifestAssetPaths.filter((assetPath) => assetPath.endsWith(".prompt.md"))
	const expectedSkillPaths = expectedManifestAssetPaths.filter((assetPath) => assetPath.endsWith("/SKILL.md"))
	const promptFiles = Array.isArray(packageJson.contributes?.chatPromptFiles)
		? packageJson.contributes.chatPromptFiles
		: []
	const skillFiles = Array.isArray(packageJson.contributes?.chatSkills) ? packageJson.contributes.chatSkills : []
	for (const [index, promptFile] of promptFiles.entries()) {
		assertOnlyAllowedObjectKeys(promptFile, vscodeChatPromptContributionKeys, `${label} chatPromptFiles[${index}]`)
	}
	for (const [index, skillFile] of skillFiles.entries()) {
		assertOnlyAllowedObjectKeys(skillFile, vscodeChatPromptContributionKeys, `${label} chatSkills[${index}]`)
	}
	assertCodeVibeChatResourceContributions(promptFiles, expectedPromptPaths, "prompt", label)
	assertCodeVibeChatResourceContributions(skillFiles, expectedSkillPaths, "skill", label)

	if ("codevibe-ActivityBar" in views) {
		throw new Error(`${label} must not contribute views under legacy codevibe-ActivityBar`)
	}
	if ("claude-dev-ActivityBar" in views) {
		throw new Error(`${label} must not contribute views under legacy claude-dev-ActivityBar`)
	}
	for (const [viewGroup, groupViews] of Object.entries(views)) {
		const viewIds = (Array.isArray(groupViews) ? groupViews : []).map((view) => view?.id).filter(Boolean)
		if (viewIds.includes("codevibe.SidebarProvider")) {
			throw new Error(`${label} ${viewGroup} must not contribute the legacy codevibe.SidebarProvider view`)
		}
		if (viewIds.includes("claude-dev.SidebarProvider")) {
			throw new Error(`${label} ${viewGroup} must not contribute the legacy claude-dev.SidebarProvider view`)
		}
	}

	const commands = Array.isArray(packageJson.contributes?.commands) ? packageJson.contributes.commands : []
	for (const command of commands) {
		if (typeof command?.command === "string" && command.command.startsWith("cline.")) {
			throw new Error(`${label} must not contribute legacy Cline command ${command.command}`)
		}
	}

	for (const [menuId, items] of Object.entries(packageJson.contributes?.menus ?? {})) {
		for (const item of Array.isArray(items) ? items : []) {
			if (typeof item?.command === "string" && item.command.startsWith("cline.")) {
				throw new Error(`${label} menu ${menuId} must not reference legacy Cline command ${item.command}`)
			}
			if (
				menuId === "view/title" &&
				[
					"codevibe.plusButtonClicked",
					"codevibe.mcpButtonClicked",
					"codevibe.historyButtonClicked",
					"codevibe.accountButtonClicked",
					"codevibe.settingsButtonClicked",
					"codevibe.worktreesButtonClicked",
				].includes(item?.command)
			) {
				throw new Error(`${label} must not contribute duplicate CodeVibe navigation actions to view/title`)
			}
			if (typeof item?.when === "string" && item.when.includes("claude-dev.SidebarProvider")) {
				throw new Error(`${label} menu ${menuId} must not target legacy claude-dev.SidebarProvider`)
			}
		}
	}
}

function assertCodeVibeChatResourceContributions(entries, expectedPaths, kind, label) {
	if (entries.length !== expectedPaths.length) {
		throw new Error(`${label} must contribute ${expectedPaths.length} native CodeVibe ${kind} file(s)`)
	}
	const actualPaths = entries.map((entry) => entry?.path).filter(Boolean)
	for (const expectedPath of expectedPaths.map((assetPath) => `./${assetPath}`)) {
		if (!actualPaths.includes(expectedPath)) {
			throw new Error(`${label} must contribute native CodeVibe ${kind} file ${expectedPath}`)
		}
	}
	for (const [index, entry] of entries.entries()) {
		const resourcePath = entry?.path
		if (typeof resourcePath !== "string" || !resourcePath.startsWith("./assets/prompts/")) {
			throw new Error(`${label} chat ${kind}s[${index}] must use a packaged assets/prompts path`)
		}
		const normalized = path.posix.normalize(resourcePath.replace(/^\.\//, "").replace(/\\/g, "/"))
		if (normalized.startsWith("../") || normalized.includes("\0")) {
			throw new Error(`${label} chat ${kind}s[${index}] uses an unsafe path`)
		}
		if (kind === "prompt" && !normalized.endsWith(".prompt.md")) {
			throw new Error(`${label} chatPromptFiles[${index}] must reference a .prompt.md file`)
		}
		if (kind === "skill" && !normalized.endsWith("/SKILL.md")) {
			throw new Error(`${label} chatSkills[${index}] must reference a SKILL.md file`)
		}
		if (!Array.isArray(entry.sessionTypes) || entry.sessionTypes.length !== 1 || entry.sessionTypes[0] !== "agent-host-codevibe") {
			throw new Error(`${label} chat ${kind}s[${index}] must target only agent-host-codevibe`)
		}
		const visiblePath = resourcePath.toLowerCase()
		if (visiblePath.includes("copilot") || visiblePath.includes("cline")) {
			throw new Error(`${label} chat ${kind}s[${index}] must use CodeVibe-branded paths`)
		}
	}
}

function assertPackagedManifestNoDevMetadata(packageJson, label) {
	for (const key of ["scripts", "lint-staged", "devDependencies"]) {
		if (Object.hasOwn(packageJson, key)) {
			throw new Error(`${label} must not include development-only ${key}`)
		}
	}
	const serialized = JSON.stringify(packageJson)
	if (serialized.includes("upstream:cline") || serialized.includes("prepare-upstream-cline-patch")) {
		throw new Error(`${label} must not expose legacy upstream patch script names`)
	}
}

function brandPackagedMarkdownAssets() {
	const snapshot = new Map()
	for (const assetPath of packagedMarkdownAssetPaths) {
		const filePath = path.join(projectRoot, assetPath)
		assertFileExists(filePath, `packaged markdown asset "${assetPath}"`, { nonEmpty: true })
		const originalText = fs.readFileSync(filePath, "utf8")
		snapshot.set(filePath, originalText)
		const brandedText = replaceVisibleMarkdownBrand(originalText)
		if (brandedText !== originalText) {
			fs.writeFileSync(filePath, brandedText)
		}
	}
	return snapshot
}

function restorePackagedMarkdownAssets(snapshot) {
	for (const [filePath, originalText] of snapshot) {
		fs.writeFileSync(filePath, originalText)
	}
}

function assertCursorParityManifest(packageJson, label = "package manifest") {
	if (packageJson.name !== "codevibe") {
		throw new Error(`${label} must use name codevibe`)
	}
	if (packageJson.displayName !== "CodeVibe") {
		throw new Error(`${label} must use displayName CodeVibe`)
	}
	if (packageJson.publisher !== "atnumridha") {
		throw new Error(`${label} must use publisher atnumridha`)
	}
	if (packageJson.author?.name !== "CodeVibe") {
		throw new Error(`${label} must use author.name CodeVibe`)
	}
	if (packageJson.repository?.url !== "https://github.com/atnumridha/codevibe") {
		throw new Error(`${label} must point repository.url at https://github.com/atnumridha/codevibe`)
	}
	if (packageJson.homepage !== "https://github.com/atnumridha/codevibe") {
		throw new Error(`${label} must point homepage at https://github.com/atnumridha/codevibe`)
	}
	if (typeof packageJson.description !== "string" || !packageJson.description.includes("editor-native")) {
		throw new Error(`${label} description must mention editor-native positioning`)
	}
	if (packageJson.main !== "./dist/extension.js") {
		throw new Error(`${label} must point main at ./dist/extension.js`)
	}
	assertArrayIncludes(packageJson.enabledApiProposals, "chatParticipantAdditions", `${label} enabledApiProposals`)
	assertArrayIncludes(packageJson.enabledApiProposals, "chatPromptFiles", `${label} enabledApiProposals`)
	assertArrayIncludes(packageJson.enabledApiProposals, "defaultChatParticipant", `${label} enabledApiProposals`)
	assertArrayIncludes(packageJson.enabledApiProposals, "chatSessionCustomizationProvider", `${label} enabledApiProposals`)
	assertArrayIncludes(packageJson.enabledApiProposals, "chatSessionsProvider", `${label} enabledApiProposals`)
	assertArrayIncludes(packageJson.activationEvents, "onUri", `${label} activationEvents`)
	assertArrayIncludes(packageJson.activationEvents, "onChatParticipant:codevibe", `${label} activationEvents`)
	assertArrayIncludes(packageJson.activationEvents, "onChatSession:agent-host-codevibe", `${label} activationEvents`)
	assertArrayExcludes(packageJson.activationEvents, "onChatSession:codevibe-agent", `${label} activationEvents`)
	for (const command of requiredCursorParityCommands) {
		assertArrayIncludes(packageJson.activationEvents, `onCommand:${command}`, `${label} activationEvents`)
	}
	for (const command of requiredCursorParityLegacyActivationCommands) {
		assertArrayIncludes(packageJson.activationEvents, `onCommand:${command}`, `${label} activationEvents`)
	}

	const properties = packageJson.contributes?.configuration?.properties
	for (const key of requiredCursorParityConfigKeys) {
		assertObjectHasKey(properties, key, `${label} configuration.properties`)
	}
	for (const key of Object.keys(properties ?? {})) {
		if (disallowedLegacyConfigurationPrefixes.some((prefix) => key.startsWith(prefix))) {
			throw new Error(`${label} configuration.properties must not expose legacy setting ${key}`)
		}
	}
	const commands = Array.isArray(packageJson.contributes?.commands)
		? packageJson.contributes.commands.map((command) => command?.command).filter(Boolean)
		: []
	for (const command of requiredCursorParityCommands) {
		assertArrayIncludes(commands, command, `${label} contributes.commands`)
	}
	for (const command of requiredCursorParityLegacyActivationCommands) {
		if (commands.includes(command)) {
			throw new Error(`${label} contributes.commands must not expose legacy compatibility command ${command}`)
		}
	}

	const codexAuth = properties["codevibe.openAiCodex.authSource"]
	if (codexAuth.default !== "codexHome") {
		throw new Error(`${label} must default codevibe.openAiCodex.authSource to codexHome`)
	}
	if (!String(codexAuth.description || "").includes("workspace .codex/auth.json")) {
		throw new Error(`${label} must describe workspace .codex/auth.json Codex auth discovery`)
	}
	if (properties["codevibe.ui.preferOpenAiCodexSidebar"].default !== false) {
		throw new Error(`${label} must default codevibe.ui.preferOpenAiCodexSidebar to false`)
	}
	for (const value of ["codexHome", "vscodeSecret", "auto"]) {
		assertArrayIncludes(codexAuth.enum, value, `${label} codevibe.openAiCodex.authSource enum`)
	}
	for (const key of [
		"codevibe.compatibility.enabled",
		"codevibe.compatibility.deepLinks.enabled",
		"codevibe.compatibility.retrievalIndexing.privacyGate",
		"codevibe.cursorCompatibility.enabled",
		"codevibe.cursorCompatibility.deepLinks.enabled",
		"codevibe.cursorCompatibility.retrievalIndexing.privacyGate",
	]) {
		if (properties[key].default !== true) {
			throw new Error(`${label} must default ${key} to true`)
		}
	}
	for (const key of [
		"codevibe.compatibility.safeBrowserEvaluate.enabled",
		"codevibe.cursorCompatibility.safeBrowserEvaluate.enabled",
	]) {
		if (properties[key].default !== false) {
			throw new Error(`${label} must default ${key} to false`)
		}
	}
	for (const key of [
		"codevibe.cursorCompatibility.enabled",
		"codevibe.cursorCompatibility.deepLinks.enabled",
		"codevibe.cursorCompatibility.retrievalIndexing.privacyGate",
		"codevibe.cursorCompatibility.sandboxPolicy",
		"codevibe.cursorCompatibility.safeBrowserEvaluate.enabled",
	]) {
		if (!String(properties[key].deprecationMessage ?? "").startsWith("Use codevibe.compatibility.")) {
			throw new Error(`${label} must mark ${key} as a deprecated compatibility alias`)
		}
	}
	if (properties["codevibe.compatibility.safeBrowserEvaluate.enabled"].default !== false) {
		throw new Error(`${label} must default safe browser evaluate to false`)
	}
	for (const key of ["codevibe.compatibility.sandboxPolicy", "codevibe.cursorCompatibility.sandboxPolicy"]) {
		if (properties[key].default !== "prompt") {
			throw new Error(`${label} must default ${key} to prompt`)
		}
	}
	assertVisibleManifestStringsBranded(packageJson, label)
	assertNativeCodeVibeContributionIds(packageJson, label)
	for (const key of ["codevibe.compatibility.sandboxPolicy", "codevibe.cursorCompatibility.sandboxPolicy"]) {
		for (const value of ["prompt", "workspace", "readOnly", "disabled"]) {
			assertArrayIncludes(properties[key].enum, value, `${label} ${key} enum`)
		}
	}
}

function stripAllowedMarkdownClineReferences(value) {
	return value.replace(/\[Apache 2\.0 \u00a9 2026 Cline Bot Inc\.\]\([^)]+\)/g, "")
}

function assertPackagedMarkdownTextBranded(value, label) {
	const normalized = stripAllowedMarkdownClineReferences(value)
	if (/\bCline\b/.test(normalized)) {
		throw new Error(`${label} must use CodeVibe branding for visible markdown copy`)
	}
	const lower = normalized.toLowerCase()
	for (const fragment of disallowedPackagedMarkdownFragments) {
		if (lower.includes(fragment)) {
			throw new Error(`${label} must not include upstream Cline URL or package id: ${fragment}`)
		}
	}
}

function assertPackagedMarkdownAssetsBranded() {
	for (const assetPath of packagedMarkdownAssetPaths) {
		const filePath = path.join(projectRoot, assetPath)
		assertFileExists(filePath, `packaged markdown asset "${assetPath}"`, { nonEmpty: true })
		assertPackagedMarkdownTextBranded(fs.readFileSync(filePath, "utf8"), `packaged markdown asset "${assetPath}"`)
	}
}

function isPackagedTextEntry(entryName) {
	if (
		entryName.startsWith("extension/dist/") ||
		entryName.startsWith("extension/webview-ui/build/") ||
		entryName === "extension.vsixmanifest" ||
		entryName === "extension/package.json" ||
		entryName === "extension/readme.md"
	) {
		return /\.(?:css|html|js|json|md|txt)$/i.test(entryName)
	}
	return packagedMarkdownAssetPaths.some((assetPath) => entryName === `extension/${assetPath.replace(/\\/g, "/")}`)
}

function assertPackagedVisibleTextBranded(zip) {
	for (const entryName of zip.entries.keys()) {
		if (!isPackagedTextEntry(entryName)) {
			continue
		}
		const text = readZipEntry(zip, entryName).toString("utf8")
		if (entryName === "extension/webview-ui/build/index.html" && !packagedWebviewHtmlTitlePattern.test(text)) {
			throw new Error("VSIX artifact extension/webview-ui/build/index.html must title the webview as CodeVibe")
		}
		for (const fragment of disallowedPackagedVisibleTextFragments) {
			if (text.includes(fragment)) {
				throw new Error(`VSIX artifact ${entryName} includes stale visible branding fragment: ${fragment}`)
			}
		}
	}
}

function findZipEndOfCentralDirectory(buffer) {
	const minimumOffset = Math.max(0, buffer.length - 22 - 0xffff)
	for (let offset = buffer.length - 22; offset >= minimumOffset; offset--) {
		if (buffer.readUInt32LE(offset) === 0x06054b50) {
			return offset
		}
	}
	throw new Error("VSIX artifact is not a readable zip archive")
}

function listZipEntries(zipPath) {
	const buffer = fs.readFileSync(zipPath)
	const eocdOffset = findZipEndOfCentralDirectory(buffer)
	const entryCount = buffer.readUInt16LE(eocdOffset + 10)
	const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16)
	const entries = new Map()
	let offset = centralDirectoryOffset
	for (let index = 0; index < entryCount; index++) {
		if (buffer.readUInt32LE(offset) !== 0x02014b50) {
			throw new Error(`VSIX central directory is corrupt at entry ${index}`)
		}
		const compressionMethod = buffer.readUInt16LE(offset + 10)
		const compressedSize = buffer.readUInt32LE(offset + 20)
		const fileNameLength = buffer.readUInt16LE(offset + 28)
		const extraFieldLength = buffer.readUInt16LE(offset + 30)
		const fileCommentLength = buffer.readUInt16LE(offset + 32)
		const localHeaderOffset = buffer.readUInt32LE(offset + 42)
		const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength)
		entries.set(fileName, {
			compressionMethod,
			compressedSize,
			localHeaderOffset,
		})
		offset += 46 + fileNameLength + extraFieldLength + fileCommentLength
	}
	return { buffer, entries }
}

function resolveZipEntryName(zip, entryName) {
	if (zip.entries.has(entryName)) {
		return entryName
	}
	const lowerEntryName = entryName.toLowerCase()
	return [...zip.entries.keys()].find((name) => name.toLowerCase() === lowerEntryName)
}

function zipHasEntry(zip, entryName) {
	return Boolean(resolveZipEntryName(zip, entryName))
}

function readZipEntry(zip, entryName) {
	const resolvedEntryName = resolveZipEntryName(zip, entryName)
	const entry = resolvedEntryName ? zip.entries.get(resolvedEntryName) : undefined
	if (!entry) {
		throw new Error(`VSIX artifact is missing ${entryName}`)
	}
	const { buffer } = zip
	if (buffer.readUInt32LE(entry.localHeaderOffset) !== 0x04034b50) {
		throw new Error(`VSIX local file header is corrupt for ${resolvedEntryName}`)
	}
	const fileNameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26)
	const extraFieldLength = buffer.readUInt16LE(entry.localHeaderOffset + 28)
	const dataOffset = entry.localHeaderOffset + 30 + fileNameLength + extraFieldLength
	const compressed = buffer.subarray(dataOffset, dataOffset + entry.compressedSize)
	if (entry.compressionMethod === 0) {
		return compressed
	}
	if (entry.compressionMethod === 8) {
		return zlib.inflateRawSync(compressed)
	}
	throw new Error(`VSIX entry ${resolvedEntryName} uses unsupported compression method ${entry.compressionMethod}`)
}

function addManifestAsset(assetPaths, value) {
	if (typeof value === "string" && value.trim()) {
		const trimmed = value.trim()
		const normalized = path.posix.normalize(trimmed.replace(/\\/g, "/"))
		if (
			trimmed.includes("\0") ||
			path.isAbsolute(trimmed) ||
			path.win32.isAbsolute(trimmed) ||
			normalized === ".." ||
			normalized.startsWith("../")
		) {
			throw new Error(`Manifest asset path is unsafe: ${trimmed}`)
		}
		assetPaths.add(normalized)
	}
}

function collectManifestAssetPaths(packageJson) {
	const assetPaths = new Set()
	addManifestAsset(assetPaths, packageJson.icon)

	for (const icon of Object.values(packageJson.contributes?.icons ?? {})) {
		addManifestAsset(assetPaths, icon?.default?.fontPath)
	}

	for (const containerGroup of Object.values(packageJson.contributes?.viewsContainers ?? {})) {
		for (const container of Array.isArray(containerGroup) ? containerGroup : []) {
			addManifestAsset(assetPaths, container?.icon)
		}
	}

	for (const viewGroup of Object.values(packageJson.contributes?.views ?? {})) {
		for (const view of Array.isArray(viewGroup) ? viewGroup : []) {
			addManifestAsset(assetPaths, view?.icon)
		}
	}

	for (const walkthrough of packageJson.contributes?.walkthroughs ?? []) {
		for (const step of walkthrough?.steps ?? []) {
			addManifestAsset(assetPaths, step?.media?.markdown)
			addManifestAsset(assetPaths, step?.content?.path)
		}
	}

	for (const agent of packageJson.contributes?.chatAgents ?? []) {
		addManifestAsset(assetPaths, agent?.path)
	}

	for (const promptFile of packageJson.contributes?.chatPromptFiles ?? []) {
		addManifestAsset(assetPaths, promptFile?.path)
	}

	for (const skillFile of packageJson.contributes?.chatSkills ?? []) {
		addManifestAsset(assetPaths, skillFile?.path)
	}

	return Array.from(assetPaths).sort()
}

function assertManifestAssets(packageJson) {
	const assetPaths = collectManifestAssetPaths(packageJson)
	for (const assetPath of expectedManifestAssetPaths) {
		if (!assetPaths.includes(assetPath)) {
			throw new Error(`Manifest is missing expected asset path "${assetPath}"`)
		}
	}
	for (const assetPath of assetPaths) {
		assertFileExists(path.join(projectRoot, assetPath), `manifest asset "${assetPath}"`)
	}
}

function assertNativeChatRegistrationSource() {
	const source = fs.readFileSync(path.join(projectRoot, "src", "extension.ts"), "utf8")
	for (const fragment of ["createChatParticipant!(chatSessionType", "createChatParticipant(chatSessionType"]) {
		if (source.includes(fragment)) {
			throw new Error(`Native Chat session providers must reuse the declared codevibe participant instead of ${fragment}`)
		}
	}
	if (!/registerChatSessionContentProvider!\(\s*chatSessionType,\s*contentProvider,\s*defaultChatParticipant/.test(source)) {
		throw new Error("Native Chat session providers must register with the declared CodeVibe chat participant")
	}
}

function assertNativeViewRegistrySource(packageJson) {
	const registrySource = fs.readFileSync(path.join(projectRoot, "src", "registry.ts"), "utf8")
	const activityBarContainers = packageJson.contributes?.viewsContainers?.activitybar ?? []
	const codeVibeContainer = activityBarContainers.find((container) => container?.id === "codevibe-agent")
	if (!codeVibeContainer) {
		throw new Error("package.json must contribute the codevibe-agent activity bar container")
	}
	const codeVibeAgentViews = Array.isArray(packageJson.contributes?.views?.["codevibe-agent"])
		? packageJson.contributes.views["codevibe-agent"]
		: []
	if (!codeVibeAgentViews.some((view) => view?.id === "codevibe-agent-chat")) {
		throw new Error("package.json must register codevibe-agent-chat under the codevibe-agent container")
	}
	if (!registrySource.includes('const viewPrefix = name === "codevibe" ? "codevibe" : name.replace(/[^A-Za-z0-9_-]/g, "-")')) {
		throw new Error("ExtensionRegistryInfo.views must derive package-name-safe view IDs")
	}
	if (!registrySource.includes('AgentContainer: viewPrefix + "-agent"')) {
		throw new Error("ExtensionRegistryInfo.views.AgentContainer must match the contributed codevibe-agent container")
	}
	if (!registrySource.includes('Sidebar: viewPrefix + "-agent-chat"')) {
		throw new Error("ExtensionRegistryInfo.views.Sidebar must match the contributed codevibe-agent-chat view")
	}
}

function assertPackageInputs(packageJson) {
	assertFileExists(path.join(projectRoot, "README.md"), "packaged README.md", { nonEmpty: true })
	assertManifestAssets(packageJson)
	assertCursorParityManifest(packageJson)
	assertPackagedMarkdownAssetsBranded()
	assertNativeChatRegistrationSource()
	assertNativeViewRegistrySource(packageJson)
}

function assertManifestInputs(packageJson) {
	assertManifestAssets(packageJson)
	assertCursorParityManifest(packageJson)
	assertNativeChatRegistrationSource()
}

function readRepoText(relativePath) {
	return fs.readFileSync(path.join(repoRoot, relativePath), "utf8")
}

function assertReleaseTextIncludes(text, expected, label) {
	if (!text.includes(expected)) {
		throw new Error(`${label} must include ${expected}`)
	}
}

function assertReleaseTextExcludes(text, forbidden, label) {
	if (text.includes(forbidden)) {
		throw new Error(`${label} must not include ${forbidden}`)
	}
}

function assertCodeVibeReleasePublishPaths() {
	const cliPublishWorkflow = readRepoText(".github/workflows/cli-publish.yml")
	const nightlyPublishWorkflow = readRepoText(".github/workflows/ext-vscode-publish-nightly.yml")
	const stablePublishWorkflow = readRepoText(".github/workflows/ext-vscode-publish-stable.yml")
	const githubReleaseWorkflow = readRepoText(".github/workflows/ext-vscode-github-release.yml")
	const vscodeIgnore = fs.readFileSync(path.join(projectRoot, ".vscodeignore"), "utf8")
	const esbuildScript = fs.readFileSync(path.join(projectRoot, "esbuild.mjs"), "utf8")
	const webviewViteConfig = fs.readFileSync(path.join(projectRoot, "webview-ui", "vite.config.ts"), "utf8")
	const nightlyPublisher = fs.readFileSync(path.join(projectRoot, "scripts", "publish-nightly.mjs"), "utf8")

	for (const [label, text] of [
		["CLI publish workflow", cliPublishWorkflow],
		["VS Code nightly publish workflow", nightlyPublishWorkflow],
		["VS Code stable publish workflow", stablePublishWorkflow],
		["VS Code GitHub release workflow", githubReleaseWorkflow],
	]) {
		assertReleaseTextIncludes(text, "github.repository == 'atnumridha/codevibe'", label)
		assertReleaseTextExcludes(text, "github.repository == 'cline/cline'", label)
		assertReleaseTextExcludes(text, "CLINE_ENVIRONMENT: production", label)
	}

	for (const forbidden of [
		"@cline/cli-",
		"${package_name#@cline/}",
		"npmjs.com/package/cline",
		"Publish cline",
	]) {
		assertReleaseTextExcludes(cliPublishWorkflow, forbidden, "CLI publish workflow")
	}
	for (const expected of [
		"@codevibe/cli-darwin-arm64",
		"@codevibe/cli-darwin-x64",
		"@codevibe/cli-linux-arm64",
		"@codevibe/cli-linux-x64",
		"@codevibe/cli-windows-arm64",
		"@codevibe/cli-windows-x64",
		"${package_name#@codevibe/}",
		"npmjs.com/package/codevibe",
	]) {
		assertReleaseTextIncludes(cliPublishWorkflow, expected, "CLI publish workflow")
	}

	for (const forbidden of [
		"CODEVIBE_ALLOW_LEGACY_CLINE_NIGHTLY",
		"cline-nightly",
		"Cline (Nightly)",
		"claude-dev",
	]) {
		assertReleaseTextExcludes(nightlyPublisher, forbidden, "VS Code nightly publish script")
	}
	assertReleaseTextIncludes(nightlyPublisher, 'nightlyName: "codevibe-nightly"', "VS Code nightly publish script")
	assertReleaseTextIncludes(nightlyPublisher, 'originalName: "codevibe"', "VS Code nightly publish script")
	assertReleaseTextIncludes(nightlyPublisher, 'nightlyDisplayName: "CodeVibe (Nightly)"', "VS Code nightly publish script")
	assertReleaseTextIncludes(nightlyPublisher, '"codevibe-nightly.vsix"', "VS Code nightly publish script")
	assertReleaseTextIncludes(nightlyPublisher, '"--no-dependencies"', "VS Code nightly publish script")
	assertReleaseTextIncludes(nightlyPublisher, '${config.nightlyName}-agent', "VS Code nightly publish script")
	assertReleaseTextIncludes(nightlyPublisher, '${config.nightlyName}-agent-chat', "VS Code nightly publish script")
	assertReleaseTextIncludes(vscodeIgnore, "package.json.backup", "VSIX ignore list")
	assertReleaseTextIncludes(esbuildScript, "process.env.CODEVIBE_ENVIRONMENT", "extension bundler")
	assertReleaseTextIncludes(webviewViteConfig, "CODEVIBE_ENVIRONMENT", "webview bundler")
}

function assertBuildOutputs() {
	assertFileExists(path.join(projectRoot, "dist", "extension.js"), "extension bundle dist/extension.js", {
		nonEmpty: true,
	})
	assertDirectoryHasFiles(path.join(projectRoot, "webview-ui", "build"), "webview-ui build")
}

function assertPackagedVsix(outPath, metadata) {
	assertFileExists(outPath, "GitHub VSIX artifact", { nonEmpty: true })
	if (fs.statSync(outPath).size < 1024) {
		throw new Error(`GitHub VSIX artifact is unexpectedly small: ${outPath}`)
	}
	const zip = listZipEntries(outPath)
	if (!zip.entries.has("extension/dist/extension.js")) {
		throw new Error("VSIX artifact is missing extension/dist/extension.js")
	}
	if (![...zip.entries.keys()].some((entryName) => entryName.startsWith("extension/webview-ui/build/"))) {
		throw new Error("VSIX artifact is missing extension/webview-ui/build assets")
	}
	for (const entryName of zip.entries.keys()) {
		if (entryName.endsWith(".vsix")) {
			throw new Error(`VSIX artifact must not include nested VSIX artifact ${entryName}`)
		}
		if (disallowedVsixEntries.has(entryName)) {
			throw new Error(`VSIX artifact must not include dev/test artifact ${entryName}`)
		}
		for (const prefix of disallowedVsixEntryPrefixes) {
			if (entryName.startsWith(prefix)) {
				throw new Error(`VSIX artifact must not include dev/test artifact ${entryName}`)
			}
		}
	}
	const packagedPackageJson = JSON.parse(readZipEntry(zip, "extension/package.json").toString("utf8"))
	if (packagedPackageJson.version !== metadata.version) {
		throw new Error(
			`VSIX artifact version mismatch: expected ${metadata.version}, found ${packagedPackageJson.version ?? "missing"}`,
		)
	}
	assertCursorParityManifest(packagedPackageJson, "packaged VSIX manifest")
	assertPackagedManifestNoDevMetadata(packagedPackageJson, "packaged VSIX manifest")
	for (const assetPath of collectManifestAssetPaths(packagedPackageJson)) {
		const entryName = `extension/${assetPath.replace(/\\/g, "/")}`
		if (!zipHasEntry(zip, entryName)) {
			throw new Error(`VSIX artifact is missing manifest asset ${entryName}`)
		}
	}
	for (const assetPath of packagedMarkdownAssetPaths) {
		const entryName = `extension/${assetPath.replace(/\\/g, "/")}`
		const text = readZipEntry(zip, entryName).toString("utf8")
		assertPackagedMarkdownTextBranded(text, `VSIX markdown asset ${entryName}`)
	}
	assertPackagedVisibleTextBranded(zip)
}

async function verifyInstallWithCode(outPath, metadata, codePath) {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codevibe-vsix-smoke-"))
	const userDataDir = path.join(tempRoot, "user-data")
	const extensionsDir = path.join(tempRoot, "extensions")
	fs.mkdirSync(userDataDir, { recursive: true })
	fs.mkdirSync(extensionsDir, { recursive: true })

	try {
		const codeInvocation = await resolveCodeInvocation(codePath)
		const codeCommand = [codeInvocation.command]
		const isolatedArgs = ["--user-data-dir", userDataDir, "--extensions-dir", extensionsDir]
		runCommand(codeCommand, [...codeInvocation.baseArgs, ...isolatedArgs, "--install-extension", outPath, "--force"], {
			timeoutMs: vsCodeSmokeInstallTimeoutMs,
		})
		const listResult = runCommand(
			codeCommand,
			[...codeInvocation.baseArgs, ...isolatedArgs, "--list-extensions", "--show-versions"],
			{
				capture: true,
				timeoutMs: vsCodeSmokeInstallTimeoutMs,
			},
		)
		const expectedExtension = `${metadata.extensionId}@${metadata.version}`
		verifyInstalledExtension(listResult.stdout ?? "", expectedExtension)
		const installedManifestPath = path.join(
			extensionsDir,
			`${metadata.extensionId.toLowerCase()}-${metadata.version.toLowerCase()}`,
			"package.json",
		)
		assertFileExists(installedManifestPath, "installed VSIX package.json", { nonEmpty: true })
		const installedPackageJson = JSON.parse(fs.readFileSync(installedManifestPath, "utf8"))
		assertCursorParityManifest(installedPackageJson, "installed VSIX package.json")
		assertNativeCodeVibeContributionIds(installedPackageJson, "installed VSIX package.json")
		assertPackagedManifestNoDevMetadata(installedPackageJson, "installed VSIX package.json")
		console.log(`VSIX smoke install verified ${expectedExtension} using isolated VS Code directories`)
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true })
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2))
	if (options.cleanLegacyViewStateOnly) {
		cleanLegacyCodeVibeViewState()
		return
	}
	if (options.preflight) {
		const githubVsixPackageJson = createGithubVsixPackageJson(readPackageJson())
		assertManifestInputs(githubVsixPackageJson)
		assertCodeVibeReleasePublishPaths()
		runCommand([process.execPath], ["scripts/check-codevibe-branding.mjs"])
		runCommand(
			[process.execPath],
			["scripts/check-local-release-prereqs.mjs", ...(options.requireReleaseGate ? ["--release"] : [])],
		)
		return
	}
	if (options.requireReleaseGate) {
		assertCursorParityReleaseGate("CodeVibe GitHub VSIX package")
	}
	const originalPackageJsonText = fs.readFileSync(packageJsonPath, "utf8")
	const originalPackageJson = JSON.parse(originalPackageJsonText)
	const githubVsixPackageJson = createGithubVsixPackageJson(originalPackageJson)
	const metadata = readPackageMetadata(githubVsixPackageJson)
	const outPath = resolveOutputPath(options, metadata)
	assertManifestInputs(githubVsixPackageJson)
	if (options.printMetadata) {
		console.log(
			JSON.stringify(
				{
					...metadata,
					displayName: githubVsixPackageJson.displayName,
					outPath,
					releaseGateRequired: options.requireReleaseGate,
					releaseGateSatisfied: options.requireReleaseGate
						? process.env.CODEVIBE_ALL_PARITY_VALIDATED === "true"
						: undefined,
					releaseGateEvidenceUrl: options.requireReleaseGate ? process.env.CODEVIBE_PARITY_EVIDENCE_URL : undefined,
				},
				null,
				2,
			),
		)
		return
	}

	let brandedMarkdownSnapshot
	const restorePackageInputs = () => {
		fs.writeFileSync(packageJsonPath, originalPackageJsonText)
		if (brandedMarkdownSnapshot) {
			restorePackagedMarkdownAssets(brandedMarkdownSnapshot)
		}
		restoreMarketplaceReadme()
	}
	const signalCleanup = installSignalCleanup(restorePackageInputs)
	try {
		swapInMarketplaceReadme()
		brandedMarkdownSnapshot = brandPackagedMarkdownAssets()
		writePackageJson(githubVsixPackageJson)
		assertPackageInputs(githubVsixPackageJson)
		fs.mkdirSync(path.dirname(outPath), { recursive: true })
		const packageArgs = ["package", "--allow-package-secrets", "sendgrid", "--no-dependencies", "--out", outPath]
		if (options.preRelease) {
			packageArgs.push("--pre-release")
		}
		runCommand(commandCandidates("vsce"), packageArgs)
		assertBuildOutputs()
		assertPackagedVsix(outPath, metadata)
		console.log(`VSIX packaged at ${outPath} with extension id ${metadata.extensionId}`)
		if (options.writeNativeAgentLauncher) {
			writeNativeAgentLauncher(outPath, metadata, options.code)
		}
		if (options.enableNativeAgentArgv) {
			enableNativeAgentInVSCodeArgv(metadata)
		}

		if (options.install) {
			runCommand(codeCommandCandidates(options.code), ["--install-extension", outPath, "--force"])
			enableNativeAgentInVSCodeArgv(metadata)
			pruneInstalledCodeVibeExtensionVersions(metadata)
			writeInstalledNativeAgentCache(metadata)
			try {
				cleanLegacyCodeVibeViewState()
			} catch (error) {
				console.warn(
					`package-github-vsix: installed VSIX but could not clean legacy CodeVibe sidebar state: ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
			}
			console.log(`VSIX installed into VS Code from ${outPath}`)
		}
		if (options.verifyInstall) {
			await verifyInstallWithCode(outPath, metadata, options.code)
		}
	} finally {
		signalCleanup.remove()
		if (!signalCleanup.interrupted) {
			restorePackageInputs()
		}
	}
}

try {
	await main()
} catch (error) {
	console.error(`package-github-vsix: ${error instanceof Error ? error.message : String(error)}`)
	process.exit(1)
}
