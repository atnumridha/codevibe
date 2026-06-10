#!/usr/bin/env node

import archiver from "archiver"
import { execFileSync, execSync } from "child_process"
import fs from "fs"
import { cp } from "fs/promises"
import { fileURLToPath } from "url"
import { glob } from "glob"
import minimatch from "minimatch"
import os from "os"
import path from "path"
import { rmrf } from "./file-utils.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.join(__dirname, "..")

process.chdir(PROJECT_ROOT)

const BUILD_DIR = "dist-standalone"
const BINARIES_DIR = `${BUILD_DIR}/binaries`
const RUNTIME_DEPS_DIR = "standalone/runtime-files"
const IS_DEBUG_BUILD = process.env.IS_DEBUG_BUILD === "true"
const CODEVIBE_CORE_ENTRY = "codevibe-core.js"
const STANDALONE_MANIFEST_FILE = "standalone-manifest.json"
const DEFAULT_PROTOBUS_PORT = 26040
const DEFAULT_HOSTBRIDGE_PORT = 26041

// This should match the node version packaged with the JetBrains plugin.
const TARGET_NODE_VERSION = "22.15.0"
const TARGET_PLATFORMS = [
	{ platform: "win32", arch: "x64", targetDir: "win-x64" },
	{ platform: "darwin", arch: "x64", targetDir: "darwin-x64" },
	{ platform: "darwin", arch: "arm64", targetDir: "darwin-arm64" },
	{ platform: "linux", arch: "x64", targetDir: "linux-x64" },
	{ platform: "linux", arch: "arm64", targetDir: "linux-aarch64" },
]
const SUPPORTED_BINARY_MODULES = ["better-sqlite3"]

const UNIVERSAL_BUILD = !process.argv.includes("-s")
const IS_VERBOSE = process.argv.includes("-v") || process.argv.includes("--verbose")
const PRINT_MANIFEST = process.argv.includes("--print-manifest")

async function main() {
	if (PRINT_MANIFEST) {
		console.log(JSON.stringify(createStandaloneManifest(), null, 2))
		return
	}

	await installNodeDependencies()
	if (UNIVERSAL_BUILD) {
		console.log("Building universal package for all platforms...")
		await packageAllBinaryDeps()
	} else {
		console.log(`Building package for ${os.platform()}-${os.arch()}...`)
	}
	writeStandaloneManifest()
	await zipDistribution()
	verifyStandalonePackage()
}

async function installNodeDependencies() {
	// Clean modules from any previous builds
	await rmrf(path.join(BUILD_DIR, "node_modules"))
	await rmrf(path.join(BINARIES_DIR))

	await cpr(RUNTIME_DEPS_DIR, BUILD_DIR)

	console.log("Running npm install in distribution directory...")
	execSync("npm install", { stdio: "inherit", cwd: BUILD_DIR })

	// Move the vscode directory into node_modules.
	// It can't be installed using npm because it will create a symlink which cannot be unzipped correctly on windows.
	fs.renameSync(`${BUILD_DIR}/vscode`, `${BUILD_DIR}/node_modules/vscode`)
}

/**
 * Downloads prebuilt binaries for each platform for the modules that include binaries. It uses `npx prebuild-install`
 * to download the binary.
 *
 * The modules are downloaded to dist-standalone/binaries/{os}-{platform}/.
 * When CodeVibe core is installed, the installer should use the correct module for the current platform.
 */
async function packageAllBinaryDeps() {
	// Check for native .node modules.
	const allNativeModules = await glob("**/*.node", { cwd: path.join(BUILD_DIR, "node_modules"), nodir: true })
	const isAllowed = (path) => SUPPORTED_BINARY_MODULES.some((allowed) => path.includes(allowed))
	const blocked = allNativeModules.filter((x) => !isAllowed(x))

	if (blocked.length > 0) {
		console.error(`Error: Native node modules cannot be included in the standalone distribution:\n\n${blocked.join("\n")}`)
		console.error(
			"\nThese modules must support prebuilt-install and be added to the supported list in scripts/package-standalone.mjs",
		)
		process.exit(1)
	}

	for (const module of SUPPORTED_BINARY_MODULES) {
		console.log(`Installing binaries for ${module}...`)
		const src = path.join(BUILD_DIR, "node_modules", module)
		if (!fs.existsSync(src)) {
			console.warn(`Warning: Trying to install binaries for the module '${module}', but it is not being used by CodeVibe.`)
			continue
		}

		for (const { platform, arch, targetDir } of TARGET_PLATFORMS) {
			const binaryDir = `${BINARIES_DIR}/${targetDir}/node_modules`
			fs.mkdirSync(binaryDir, { recursive: true })

			// Copy the module from the build dir
			const dest = path.join(binaryDir, module)
			await cpr(src, dest)

			// Download the binary libs
			const v = IS_VERBOSE ? "--verbose" : ""
			const cmd = `npx prebuild-install --platform=${platform} --arch=${arch} --target=${TARGET_NODE_VERSION} ${v}`
			log_verbose(`${module}: ${cmd}`)
			execSync(cmd, { cwd: dest, stdio: "inherit" })
			log_verbose("")
		}
		// Remove the original module with the host platform binaries installed directly into node_modules.
		log_verbose(`Cleaning up host version of ${module}`)
		await rmrf(src)
		log_verbose("")
	}
}

function readPackageJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function createStandaloneManifest() {
	const extensionPackage = readPackageJson("package.json")
	const runtimePackage = readPackageJson(path.join(RUNTIME_DEPS_DIR, "package.json"))

	return {
		schemaVersion: 1,
		product: {
			name: "CodeVibe",
			extensionId: `${extensionPackage.publisher}.${extensionPackage.name}`,
			extensionVersion: extensionPackage.version,
			runtimeName: runtimePackage.name,
			runtimeVersion: runtimePackage.version,
		},
		package: {
			artifact: "standalone.zip",
			format: "zip",
			entryDirectory: ".",
			extensionDirectory: "extension",
			runtimePackageFile: "package.json",
			coreEntry: CODEVIBE_CORE_ENTRY,
			nodeTargetVersion: TARGET_NODE_VERSION,
			debugBuild: IS_DEBUG_BUILD,
		},
		services: {
			protobus: {
				protocol: "grpc",
				defaultHost: "127.0.0.1",
				defaultPort: DEFAULT_PROTOBUS_PORT,
				addressEnv: "PROTOBUS_ADDRESS",
				portArg: "--port",
				healthService: "grpc.health.v1.Health",
			},
			hostBridge: {
				protocol: "grpc",
				required: true,
				bundled: false,
				defaultHost: "127.0.0.1",
				defaultPort: DEFAULT_HOSTBRIDGE_PORT,
				addressEnv: "HOST_BRIDGE_ADDRESS",
				portArg: "--host-bridge-port",
				healthService: "grpc.health.v1.Health",
			},
		},
		uiContract: {
			requiresExternalHostBridge: true,
			selfContainedApp: false,
			providesCoreGrpcServer: true,
			providesHostBridgeServer: false,
			providesExtensionAssets: true,
			webviewBuildPath: "extension/webview-ui/build",
			descriptorSetPath: "proto/descriptor_set.pb",
			resourceHostname: "internal.resources",
		},
		launch: {
			command: "node",
			args: [CODEVIBE_CORE_ENTRY],
			nodePath: "{target.binariesPath}:./node_modules",
			environment: {
				PROTOBUS_ADDRESS: `127.0.0.1:${DEFAULT_PROTOBUS_PORT}`,
				HOST_BRIDGE_ADDRESS: `127.0.0.1:${DEFAULT_HOSTBRIDGE_PORT}`,
				CODEVIBE_DIR: "~/.codevibe",
				CODEVIBE_DATA_DIR: "~/.codevibe/data",
				INSTALL_DIR: ".",
			},
		},
		targets: TARGET_PLATFORMS.map(({ platform, arch, targetDir }) => ({
			platform,
			arch,
			targetDir,
			binariesPath: `binaries/${targetDir}/node_modules`,
		})),
		binaryModules: {
			supported: SUPPORTED_BINARY_MODULES,
			universalBuild: UNIVERSAL_BUILD,
		},
	}
}

function writeStandaloneManifest() {
	const manifestPath = path.join(BUILD_DIR, STANDALONE_MANIFEST_FILE)
	fs.writeFileSync(manifestPath, `${JSON.stringify(createStandaloneManifest(), null, 2)}\n`)
	console.log(`Wrote ${manifestPath}`)
}

async function zipDistribution() {
	// Zip the build directory (excluding any pre-existing output zip).
	const zipPath = path.join(BUILD_DIR, "standalone.zip")
	await rmrf(path.join(BUILD_DIR, "standalone.zip.sha256"))
	const output = fs.createWriteStream(zipPath)
	const startTime = Date.now()
	const archive = archiver("zip", { zlib: { level: 6 } })

	const closed = new Promise((resolve, reject) => {
		output.on("close", () => {
			const endTime = Date.now()
			const duration = (endTime - startTime) / 1000
			console.log(
				`Created ${zipPath} (${(archive.pointer() / 1024 / 1024).toFixed(1)} MB) in ${duration.toFixed(2)} seconds`,
			)
			resolve(undefined)
		})
		output.on("error", reject)
	})
	archive.on("warning", (err) => {
		console.warn(`Warning: ${err}`)
	})
	archive.on("error", (err) => {
		throw err
	})

	archive.pipe(output)
	// Add all the files from the standalone build dir.
	archive.glob("**/*", {
		cwd: BUILD_DIR,
		ignore: ["standalone.zip", "standalone.zip.sha256"],
	})

	// Exclude the same files as the VCE vscode extension packager.
	// Also ignore the dist directory, the build directory for the extension.
	const isIgnored = createIsIgnored(["dist/**"])

	// Add the whole cline directory under "extension", except the for the ignored files.
	archive.directory(process.cwd(), "extension", (entry) => {
		if (isIgnored(entry.name)) {
			//log_verbose("Ignoring", entry.name)
			return false
		}
		return entry
	})

	console.log("Zipping package...")
	await archive.finalize()
	await closed
}

function verifyStandalonePackage() {
	execFileSync(process.execPath, ["scripts/verify-standalone-package.mjs", "--zip", path.join(BUILD_DIR, "standalone.zip")], {
		cwd: process.cwd(),
		stdio: "inherit",
	})
}

/**
 * This is based on https://github.com/microsoft/vscode-vsce/blob/fafad8a63e9cf31179f918eb7a4eeb376834c904/src/package.ts#L1695
 * because the .vscodeignore format is not compatible with the `ignore` npm module.
 */
function createIsIgnored(standaloneIgnores) {
	const MinimatchOptions = { dot: true }
	const defaultIgnore = [
		".vscodeignore",
		"package-lock.json",
		"npm-debug.log",
		"yarn.lock",
		"yarn-error.log",
		"npm-shrinkwrap.json",
		".editorconfig",
		".npmrc",
		".yarnrc",
		".gitattributes",
		"*.todo",
		"tslint.yaml",
		".eslintrc*",
		".babelrc*",
		".prettierrc*",
		"biome.json*",
		".cz-config.js",
		".commitlintrc*",
		"webpack.config.js",
		"ISSUE_TEMPLATE.md",
		"CONTRIBUTING.md",
		"PULL_REQUEST_TEMPLATE.md",
		"CODE_OF_CONDUCT.md",
		".github",
		".travis.yml",
		"appveyor.yml",
		"**/.git",
		"**/.git/**",
		"**/*.vsix",
		"**/.DS_Store",
		"**/*.vsixmanifest",
		"**/.vscode-test/**",
		"**/.vscode-test-web/**",
	]

	const rawIgnore = fs.readFileSync(".vscodeignore", "utf8")

	// Parse raw ignore by splitting output into lines and filtering out empty lines and comments
	const parsedIgnore = rawIgnore
		.split(/[\n\r]/)
		.map((s) => s.trim())
		.filter((s) => !!s)
		.filter((i) => !/^\s*#/.test(i))

	// Add '/**' to possible folder names
	const expandedIgnore = [
		...parsedIgnore,
		...parsedIgnore.filter((i) => !/(^|\/)[^/]*\*[^/]*$/.test(i)).map((i) => (/\/$/.test(i) ? `${i}**` : `${i}/**`)),
	]

	// Combine with default ignore list
	// Also ignore the dist directory- the build directory for the extension.
	let allIgnore = [...defaultIgnore, ...expandedIgnore, ...standaloneIgnores]

	// Map files need to be included in the debug build. Remove .map ignores when IS_DEBUG_BUILD is set
	if (IS_DEBUG_BUILD) {
		allIgnore = allIgnore.filter((pattern) => !pattern.endsWith(".map"))
		console.log("Debug build: Including .map files in package")
	}

	// Split into ignore and negate list
	const [ignore, negate] = allIgnore.reduce(
		(r, e) => (!/^\s*!/.test(e) ? [[...r[0], e], r[1]] : [r[0], [...r[1], e]]),
		[[], []],
	)

	function isIgnored(f) {
		return (
			ignore.some((i) => minimatch(f, i, MinimatchOptions)) &&
			!negate.some((i) => minimatch(f, i.substr(1), MinimatchOptions))
		)
	}
	return isIgnored
}

/* cp -r */
async function cpr(source, dest) {
	log_verbose(`Copying ${source} -> ${dest}`)
	await cp(source, dest, {
		recursive: true,
		preserveTimestamps: true,
		dereference: false, // preserve symlinks instead of following them
	})
}

function log_verbose(...args) {
	if (IS_VERBOSE) {
		console.log(...args)
	}
}

await main()
