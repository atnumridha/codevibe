#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"

const allowedArgs = new Set(["--help", "-h", "--context"])

function usage() {
	console.error(`Usage: assert-cursor-parity-release-gate.mjs [--context <label>]

Requires CODEVIBE_ALL_PARITY_VALIDATED=true before any CodeVibe release or marketplace publish path may proceed.`)
}

function parseArgs(argv) {
	const options = {
		context: "CodeVibe release",
	}

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index]
		if (!allowedArgs.has(arg)) {
			throw new Error(`Unknown argument: ${arg}`)
		}
		if (arg === "--help" || arg === "-h") {
			usage()
			process.exit(0)
		}
		if (arg === "--context") {
			const context = argv[++index]
			if (!context) {
				throw new Error("--context requires a value")
			}
			options.context = context
		}
	}

	return options
}

export function assertCursorParityReleaseGate(context = "CodeVibe release") {
	if (process.env.CODEVIBE_ALL_PARITY_VALIDATED !== "true") {
		throw new Error(
			`${context} is blocked until local, CI, e2e, VSIX install, and installed-VS-Code Cursor-parity validation pass. Set CODEVIBE_ALL_PARITY_VALIDATED=true only after that gate is complete.`,
		)
	}
}

function main() {
	const options = parseArgs(process.argv.slice(2))
	assertCursorParityReleaseGate(options.context)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	try {
		main()
	} catch (error) {
		console.error(`assert-cursor-parity-release-gate: ${error instanceof Error ? error.message : String(error)}`)
		process.exit(1)
	}
}
