#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.join(__dirname, "..")

function usage() {
	console.error("Usage: package-github-vsix.mjs [--out-dir <dir>] [--install]")
}

function parseArgs(argv) {
	const options = {
		outDir: "dist",
		install: false,
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

function runCommand(candidates, args) {
	let lastError
	for (const command of candidates) {
		const result = spawnSync(command, args, {
			cwd: projectRoot,
			stdio: "inherit",
			shell: false,
		})

		if (!result.error) {
			if (result.status !== 0) {
				process.exit(result.status ?? 1)
			}
			return
		}

		lastError = result.error
		if (result.error.code !== "ENOENT") {
			throw result.error
		}
	}

	throw lastError ?? new Error(`Unable to find command: ${candidates.join(" or ")}`)
}

function readPackageVersion() {
	const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"))
	if (typeof packageJson.version !== "string" || !packageJson.version.trim()) {
		throw new Error("apps/vscode/package.json is missing a version")
	}
	return packageJson.version.trim()
}

try {
	const options = parseArgs(process.argv.slice(2))
	const version = readPackageVersion()
	const outDir = path.resolve(projectRoot, options.outDir)
	const outPath = path.join(outDir, `codevibe-${version}.vsix`)

	fs.mkdirSync(outDir, { recursive: true })
	runCommand(commandCandidates("vsce"), ["package", "--allow-package-secrets", "sendgrid", "--out", outPath])
	console.log(`VSIX packaged at ${outPath}`)

	if (options.install) {
		runCommand(commandCandidates("code"), ["--install-extension", outPath, "--force"])
		console.log(`VSIX installed into VS Code from ${outPath}`)
	}
} catch (error) {
	console.error(`package-github-vsix: ${error instanceof Error ? error.message : String(error)}`)
	process.exit(1)
}
