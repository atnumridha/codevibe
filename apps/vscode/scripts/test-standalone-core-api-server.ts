#!/usr/bin/env npx tsx

/**
 * Simple CodeVibe gRPC Server
 *
 * This script provides a minimal way to run the CodeVibe core gRPC service
 * without requiring the full installation, while automatically mocking all external services. Simply run:
 *
 *   # One-time setup (generates protobuf files)
 *	 npm run compile-standalone
 *   npm run test:sca-server
 *
 * The following components are started automatically:
 *   1. HostBridge test server
 *   2. CodeVibeApiServerMock (mock implementation of the CodeVibe API)
 *   3. AuthServiceMock (activated if E2E_TEST="true")
 *
 * Environment Variables for Customization:
 *   PROJECT_ROOT - Override project root directory (default: parent of scripts dir)
 *   CODEVIBE_DIST_DIR - Override distribution directory (default: PROJECT_ROOT/dist-standalone)
 *   CODEVIBE_CORE_FILE - Override core file name (default: codevibe-core.js)
 *   CLINE_DIST_DIR / CLINE_CORE_FILE - Legacy aliases for the same values
 *   PROTOBUS_PORT - gRPC server port (default: 26040)
 *   HOSTBRIDGE_PORT - HostBridge server port (default: 26041)
 *   WORKSPACE_DIR - Working directory (default: current directory)
 *   E2E_TEST - Enable E2E test mode (default: true)
 *   CODEVIBE_ENVIRONMENT - Environment setting (default: local)
 *   CLINE_ENVIRONMENT - Legacy environment alias
 *
 * Ideal for local development, testing, or lightweight E2E scenarios.
 */

import * as fs from "node:fs"
import { mkdtempSync, rmSync } from "node:fs"
import * as os from "node:os"
import { ChildProcess, execSync, spawn } from "child_process"
import * as path from "path"
import { CodeVibeApiServerMock } from "../src/test/e2e/fixtures/server/index"

const PROTOBUS_PORT = process.env.PROTOBUS_PORT || "26040"
const HOSTBRIDGE_PORT = process.env.HOSTBRIDGE_PORT || "26041"
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || process.cwd()
const E2E_TEST = process.env.E2E_TEST || "true"
const CODEVIBE_ENVIRONMENT = process.env.CODEVIBE_ENVIRONMENT || process.env.CLINE_ENVIRONMENT || "local"
const USE_C8 = process.env.USE_C8 === "true"

// Locate the standalone build directory and core file with flexible path resolution
const projectRoot = process.env.PROJECT_ROOT || path.resolve(__dirname, "..")
const distDir = process.env.CODEVIBE_DIST_DIR || process.env.CLINE_DIST_DIR || path.join(projectRoot, "dist-standalone")
const codeVibeCoreFile = process.env.CODEVIBE_CORE_FILE || process.env.CLINE_CORE_FILE || "codevibe-core.js"
const coreFile = path.join(distDir, codeVibeCoreFile)

const childProcesses: ChildProcess[] = []

async function main(): Promise<void> {
	console.log("Starting Simple CodeVibe gRPC Server...")
	console.log(`Project Root: ${projectRoot}`)
	console.log(`Workspace: ${WORKSPACE_DIR}`)
	console.log(`ProtoBus Port: ${PROTOBUS_PORT}`)
	console.log(`HostBridge Port: ${HOSTBRIDGE_PORT}`)

	console.log(`Looking for standalone build at: ${coreFile}`)

	if (!fs.existsSync(coreFile)) {
		console.error(`Standalone build not found at: ${coreFile}`)
		console.error("Available environment variables for customization:")
		console.error("  PROJECT_ROOT - Override project root directory")
		console.error("  CODEVIBE_DIST_DIR - Override distribution directory")
		console.error("  CODEVIBE_CORE_FILE - Override core file name")
		console.error("  CLINE_DIST_DIR / CLINE_CORE_FILE - Legacy aliases")
		console.error("")
		console.error("To build the standalone version, run: npm run compile-standalone")
		process.exit(1)
	}

	try {
		await CodeVibeApiServerMock.startGlobalServer()
		console.log("CodeVibe API Server started in-process")
	} catch (error) {
		console.error("Failed to start CodeVibe API Server:", error)
		process.exit(1)
	}

	const extensionsDir = path.join(distDir, "vsce-extension")
	const userDataDir = mkdtempSync(path.join(os.tmpdir(), "vsce"))
	const codeVibeTestWorkspace = mkdtempSync(path.join(os.tmpdir(), "codevibe-test-workspace-"))

	console.log("Starting HostBridge test server...")
	const hostbridge: ChildProcess = spawn("npx", ["tsx", path.join(__dirname, "test-hostbridge-server.ts")], {
		stdio: "pipe",
		env: {
			...process.env,
			TEST_HOSTBRIDGE_WORKSPACE_DIR: codeVibeTestWorkspace,
			HOST_BRIDGE_ADDRESS: `127.0.0.1:${HOSTBRIDGE_PORT}`,
		},
	})
	childProcesses.push(hostbridge)

	console.log(`Temp user data dir: ${userDataDir}`)
	console.log(`Temp extensions dir: ${extensionsDir}`)
	// Extract standalone.zip if needed
	const standaloneZipPath = path.join(distDir, "standalone.zip")
	if (!fs.existsSync(standaloneZipPath)) {
		console.error(`standalone.zip not found at: ${standaloneZipPath}`)
		process.exit(1)
	}

	console.log("Extracting standalone.zip to extensions directory...")
	try {
		if (!fs.existsSync(extensionsDir)) {
			execSync(`unzip -o -q "${standaloneZipPath}" -d "${extensionsDir}"`, { stdio: "inherit" })
		}
		console.log(`Successfully extracted standalone.zip to: ${extensionsDir}`)
	} catch (error) {
		console.error("Failed to extract standalone.zip:", error)
		process.exit(1)
	}

	const covDir = path.join(projectRoot, `coverage/coverage-core-${PROTOBUS_PORT}`)

	const baseArgs = ["--enable-source-maps", coreFile]

	const spawnArgs = USE_C8 ? ["c8", "--report-dir", covDir, "node", ...baseArgs] : ["node", ...baseArgs]

	console.log(`Starting CodeVibe Core Service... (useC8=${USE_C8})`)

	const coreService: ChildProcess = spawn("npx", spawnArgs, {
		cwd: projectRoot,
		env: {
			...process.env,
			NODE_PATH: "./node_modules",
			DEV_WORKSPACE_FOLDER: WORKSPACE_DIR,
			PROTOBUS_ADDRESS: `127.0.0.1:${PROTOBUS_PORT}`,
			HOST_BRIDGE_ADDRESS: `localhost:${HOSTBRIDGE_PORT}`,
			E2E_TEST,
			CODEVIBE_ENVIRONMENT,
			CLINE_ENVIRONMENT: CODEVIBE_ENVIRONMENT,
			CODEVIBE_DIR: userDataDir,
			CLINE_DIR: userDataDir,
			INSTALL_DIR: extensionsDir,
		},
		stdio: "inherit",
	})
	childProcesses.push(coreService)

	const shutdown = async () => {
		console.log("\nShutting down services...")

		while (childProcesses.length > 0) {
			const child = childProcesses.pop()
			if (child && !child.killed) child.kill("SIGINT")
		}

		await CodeVibeApiServerMock.stopGlobalServer()

		try {
			rmSync(userDataDir, { recursive: true, force: true })
			rmSync(codeVibeTestWorkspace, { recursive: true, force: true })
			console.log("Cleaned up temporary directories")
		} catch (err) {
			console.warn("Failed to cleanup temp directories:", err)
		}

		process.exit(0)
	}

	process.on("SIGINT", shutdown)
	process.on("SIGTERM", shutdown)

	coreService.on("exit", (code) => {
		console.log(`Core service exited with code ${code}`)
		shutdown()
	})
	hostbridge.on("exit", (code) => {
		console.log(`HostBridge exited with code ${code}`)
		shutdown()
	})

	console.log(`CodeVibe gRPC Server is running on 127.0.0.1:${PROTOBUS_PORT}`)
	console.log("Press Ctrl+C to stop")
}

if (require.main === module) {
	main().catch((err) => {
		console.error("Failed to start simple CodeVibe server:", err)
		process.exit(1)
	})
}
