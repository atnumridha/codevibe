#!/usr/bin/env node

// Publish the same branded CodeVibe VSIX that the GitHub Release workflow
// packages. This avoids publishing the raw upstream source manifest while still
// keeping the source tree close to the CodeVibe/Cline base.

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

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

const version = readVersion()
const channel = isPrerelease ? "pre-release" : "release"
const vsixPath = path.join(projectRoot, "dist", `codevibe-marketplace-${channel}-${version}.vsix`)

try {
	run(process.execPath, [
		"scripts/package-github-vsix.mjs",
		"--out-file",
		vsixPath,
		...(isPrerelease ? ["--pre-release"] : []),
	])

	const vsceArgs = ["publish", "--packagePath", vsixPath, "--allow-package-secrets", "sendgrid"]
	if (isPrerelease) {
		vsceArgs.push("--pre-release")
	}
	run("vsce", vsceArgs)

	const ovsxArgs = ["ovsx", "publish", vsixPath]
	if (isPrerelease) {
		ovsxArgs.push("--pre-release")
	}
	run("npx", ovsxArgs)
} catch (error) {
	console.error(`publish-marketplace: ${error instanceof Error ? error.message : String(error)}`)
	process.exit(1)
}
