#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.join(__dirname, "..")
const packageJsonPath = path.join(projectRoot, "package.json")

const githubVsixManifestOverrides = {
	name: "codevibe",
	displayName: "CodeVibe",
	description:
		"CodeVibe Cursor-parity coding agent for VS Code, with Codex auth, planning, tools, MCP, browser automation, and background workflows.",
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

function usage() {
	console.error(
		"Usage: package-github-vsix.mjs [--out-dir <dir>] [--install] [--verify-install] [--code <path>] [--print-metadata]",
	)
}

function parseArgs(argv) {
	const options = {
		outDir: "dist",
		install: false,
		verifyInstall: false,
		code: undefined,
		printMetadata: false,
	}

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index]
		if (arg === "--out-dir") {
			const outDir = argv[++index]
			if (!outDir) {
				throw new Error("--out-dir requires a value")
			}
			options.outDir = outDir
		} else if (arg === "--install") {
			options.install = true
		} else if (arg === "--verify-install") {
			options.verifyInstall = true
		} else if (arg === "--code") {
			const code = argv[++index]
			if (!code) {
				throw new Error("--code requires a value")
			}
			options.code = code
		} else if (arg === "--print-metadata") {
			options.printMetadata = true
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

function codeCommandCandidates(codePath) {
	if (codePath) {
		return [codePath]
	}
	if (process.env.CODEVIBE_VSCODE_CLI) {
		return [process.env.CODEVIBE_VSCODE_CLI]
	}
	return commandCandidates("code")
}

function findExistingCodeInvocation(codePath) {
	for (const command of codeCommandCandidates(codePath)) {
		const result = spawnSync(command, ["--version"], {
			cwd: projectRoot,
			encoding: "utf8",
			stdio: "pipe",
			shell: false,
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

function runCommand(candidates, args, options = {}) {
	let lastError
	for (const command of candidates) {
		const result = spawnSync(command, args, {
			cwd: projectRoot,
			encoding: "utf8",
			stdio: options.capture ? "pipe" : "inherit",
			shell: false,
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
		if (result.error.code !== "ENOENT") {
			throw result.error
		}
	}

	throw lastError ?? new Error(`Unable to find command: ${candidates.join(" or ")}`)
}

function readPackageJson() {
	return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
}

function writePackageJson(packageJson) {
	fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, "\t")}\n`)
}

function createGithubVsixPackageJson(packageJson) {
	return {
		...packageJson,
		...githubVsixManifestOverrides,
		keywords: Array.from(new Set(["codevibe", ...(Array.isArray(packageJson.keywords) ? packageJson.keywords : [])])),
	}
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
		runCommand(codeCommand, [...codeInvocation.baseArgs, ...isolatedArgs, "--install-extension", outPath, "--force"])
		const listResult = runCommand(
			codeCommand,
			[...codeInvocation.baseArgs, ...isolatedArgs, "--list-extensions", "--show-versions"],
			{
				capture: true,
			},
		)
		const expectedExtension = `${metadata.extensionId}@${metadata.version}`
		verifyInstalledExtension(listResult.stdout ?? "", expectedExtension)
		console.log(`VSIX smoke install verified ${expectedExtension} using isolated VS Code directories`)
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true })
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2))
	const originalPackageJsonText = fs.readFileSync(packageJsonPath, "utf8")
	const originalPackageJson = JSON.parse(originalPackageJsonText)
	const githubVsixPackageJson = createGithubVsixPackageJson(originalPackageJson)
	const metadata = readPackageMetadata(githubVsixPackageJson)
	const outDir = path.resolve(projectRoot, options.outDir)
	const outPath = path.join(outDir, `codevibe-${metadata.version}.vsix`)
	if (options.printMetadata) {
		console.log(
			JSON.stringify(
				{
					...metadata,
					displayName: githubVsixPackageJson.displayName,
					outPath,
				},
				null,
				2,
			),
		)
		return
	}

	try {
		writePackageJson(githubVsixPackageJson)
		fs.mkdirSync(outDir, { recursive: true })
		runCommand(commandCandidates("vsce"), ["package", "--allow-package-secrets", "sendgrid", "--out", outPath])
		console.log(`VSIX packaged at ${outPath} with extension id ${metadata.extensionId}`)

		if (options.install) {
			runCommand(codeCommandCandidates(options.code), ["--install-extension", outPath, "--force"])
			console.log(`VSIX installed into VS Code from ${outPath}`)
		}
		if (options.verifyInstall) {
			await verifyInstallWithCode(outPath, metadata, options.code)
		}
	} finally {
		fs.writeFileSync(packageJsonPath, originalPackageJsonText)
	}
}

try {
	await main()
} catch (error) {
	console.error(`package-github-vsix: ${error instanceof Error ? error.message : String(error)}`)
	process.exit(1)
}
