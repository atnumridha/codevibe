#!/usr/bin/env node

// Post-install script for CodeVibe CLI.
//
// Creates a hard link (or copy fallback) from the platform-specific binary
// to bin/.codevibe and bin/.cline for fast startup on subsequent runs.
//
// This script must use only Node.js APIs (no Bun) since it runs via
// "node script/postinstall.mjs" in the npm lifecycle.

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function main() {
	if (os.platform() === "win32") {
		// On Windows, npm creates .cmd shims from the bin field.
		// The resolver script handles binary lookup at runtime.
		console.log("Windows detected: skipping binary cache setup");
		return;
	}

	const platformMap = {
		darwin: "darwin",
		linux: "linux",
	};
	const platform = platformMap[os.platform()] || os.platform();
	const arch = os.arch();
	const packageNames = [
		`@codevibe/cli-${platform}-${arch}`,
		`@cline/cli-${platform}-${arch}`,
	];
	const binaryNames = ["codevibe", "cline"];

	let binaryPath;
	let resolvedPackageName;
	for (const packageName of packageNames) {
		try {
			const packageJsonPath = require.resolve(`${packageName}/package.json`);
			const packageDir = path.dirname(packageJsonPath);
			for (const binaryName of binaryNames) {
				const candidate = path.join(packageDir, "bin", binaryName);
				if (fs.existsSync(candidate)) {
					binaryPath = candidate;
					resolvedPackageName = packageName;
					break;
				}
			}
			if (binaryPath) {
				break;
			}
		} catch {
			// Try the next package name.
		}
	}
	if (!binaryPath) {
		// Platform package not available. The resolver script will find
		// it at runtime by walking node_modules. This is expected on
		// platforms we don't ship binaries for.
		console.log(
			`Note: ${packageNames.join(" or ")} not found, skipping binary cache`,
		);
		return;
	}

	const binDir =
		path.basename(__dirname) === "script"
			? path.join(__dirname, "..", "bin")
			: path.join(__dirname, "bin");
	const targets = [path.join(binDir, ".codevibe"), path.join(binDir, ".cline")];

	// Ensure bin directory exists
	if (!fs.existsSync(binDir)) {
		fs.mkdirSync(binDir, { recursive: true });
	}

	// Remove existing cached binary
	for (const target of targets) {
		if (fs.existsSync(target)) {
			fs.unlinkSync(target);
		}
	}

	// Hard link preferred (shares disk space), copy as fallback
	// (hard links fail on some filesystems like NFS or cross-device)
	for (const target of targets) {
		try {
			fs.linkSync(binaryPath, target);
		} catch {
			fs.copyFileSync(binaryPath, target);
		}
		fs.chmodSync(target, 0o755);
	}
	console.log(
		`Cached CodeVibe binary from ${resolvedPackageName} at ${targets.join(", ")}`,
	);
}

try {
	main();
} catch (error) {
	// postinstall failures should never block npm install.
	// The resolver script will find the binary at runtime.
	console.error(`postinstall: ${error.message}`);
	process.exit(0);
}
