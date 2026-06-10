#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.join(__dirname, "..")
const standaloneDir = path.join(projectRoot, "dist-standalone")
const standaloneZipPath = path.join(standaloneDir, "standalone.zip")
const standaloneManifestPath = path.join(standaloneDir, "standalone-manifest.json")
const standaloneChecksumPath = `${standaloneZipPath}.sha256`

function runCommand(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? projectRoot,
		encoding: "utf8",
		stdio: options.capture ? "pipe" : "inherit",
		shell: false,
	})
	if (result.error) {
		throw result.error
	}
	if (result.status !== 0) {
		const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
		throw new Error(`${[command, ...args].join(" ")} failed with exit ${result.status ?? 1}${output ? `\n${output}` : ""}`)
	}
	return result
}

function ensureStandaloneZip() {
	if (fs.existsSync(standaloneZipPath)) {
		return
	}
	runCommand("npm", ["run", "compile-standalone"])
}

function verifyStandaloneZip() {
	runCommand(process.execPath, ["scripts/verify-standalone-package.mjs", "--zip", standaloneZipPath])
	if (!fs.existsSync(standaloneManifestPath)) {
		throw new Error(`Standalone manifest was not found at ${standaloneManifestPath}`)
	}
}

function writeChecksum() {
	const hash = createHash("sha256").update(fs.readFileSync(standaloneZipPath)).digest("hex")
	fs.writeFileSync(standaloneChecksumPath, `${hash}  standalone.zip\n`, "utf8")
	return hash
}

function main() {
	ensureStandaloneZip()
	verifyStandaloneZip()
	const sha256 = writeChecksum()
	console.log(
		JSON.stringify(
			{
				standaloneZip: path.relative(projectRoot, standaloneZipPath),
				standaloneManifest: path.relative(projectRoot, standaloneManifestPath),
				checksum: path.relative(projectRoot, standaloneChecksumPath),
				sha256,
			},
			null,
			2,
		),
	)
}

try {
	main()
} catch (error) {
	console.error(`prepare-standalone-release-assets: ${error instanceof Error ? error.message : String(error)}`)
	process.exit(1)
}
