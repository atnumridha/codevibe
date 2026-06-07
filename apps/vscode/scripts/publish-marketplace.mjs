#!/usr/bin/env node

// Publish the same branded CodeVibe VSIX that the GitHub Release workflow
// packages. This avoids publishing the raw upstream source manifest while still
// keeping the source tree close to the CodeVibe/Cline base.

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assertCursorParityReleaseGate } from "./assert-cursor-parity-release-gate.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.join(__dirname, "..")
const isPrerelease = process.argv.includes("--pre-release")
const knownFlags = new Set(["--pre-release", "--help", "-h"])

function usage() {
	console.error("Usage: publish-marketplace.mjs [--pre-release]")
}

for (const arg of process.argv.slice(2)) {
	if (!knownFlags.has(arg)) {
		console.error(`publish-marketplace: Unknown argument: ${arg}`)
		usage()
		process.exit(2)
	}
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
	usage()
	process.exit(0)
}

function run(command, args) {
	execFileSync(command, args, {
		cwd: projectRoot,
		stdio: "inherit",
	})
}

function readVersion() {
	const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"))
	if (typeof packageJson.version !== "string" || !packageJson.version.trim()) {
		throw new Error("apps/vscode/package.json is missing a version")
	}
	return packageJson.version.trim()
}

function commandCandidates(name) {
	const executableName = process.platform === "win32" ? `${name}.cmd` : name
	const localBin = path.join(projectRoot, "node_modules", ".bin", executableName)
	return fs.existsSync(localBin)
		? [localBin, executableName]
		: [executableName]
}

function runAny(candidates, args) {
	let lastError
	for (const command of candidates) {
		try {
			run(command, args)
			return
		} catch (error) {
			lastError = error
			if (error?.code !== "ENOENT") {
				throw error
			}
		}
	}
	throw lastError ?? new Error(`Unable to find command: ${candidates.join(" or ")}`)
}

try {
	assertCursorParityReleaseGate("CodeVibe marketplace publish")
	const version = readVersion()
	const channel = isPrerelease ? "pre-release" : "release"
	const vsixPath = path.join(projectRoot, "dist", `codevibe-marketplace-${channel}-${version}.vsix`)
	run(process.execPath, [
		"scripts/package-github-vsix.mjs",
		"--out-file",
		vsixPath,
		"--require-release-gate",
		...(isPrerelease ? ["--pre-release"] : []),
	])

	const vsceArgs = ["publish", "--packagePath", vsixPath, "--allow-package-secrets", "sendgrid"]
	if (isPrerelease) {
		vsceArgs.push("--pre-release")
	}
	runAny(commandCandidates("vsce"), vsceArgs)

	const ovsxArgs = ["publish", vsixPath]
	if (isPrerelease) {
		ovsxArgs.push("--pre-release")
	}
	runAny(commandCandidates("ovsx"), ovsxArgs)
} catch (error) {
	console.error(`publish-marketplace: ${error instanceof Error ? error.message : String(error)}`)
	process.exit(1)
}
