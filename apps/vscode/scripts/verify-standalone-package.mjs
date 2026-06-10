#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import zlib from "node:zlib"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.join(__dirname, "..")

function parseArgs(argv) {
	const options = {
		zip: path.join(projectRoot, "dist-standalone", "standalone.zip"),
	}
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index]
		if (arg === "--zip") {
			const value = argv[++index]
			if (!value) {
				throw new Error("--zip requires a value")
			}
			options.zip = path.resolve(process.cwd(), value)
		} else if (arg === "-h" || arg === "--help") {
			console.log("Usage: verify-standalone-package.mjs [--zip <path>]")
			process.exit(0)
		} else {
			throw new Error(`Unknown argument: ${arg}`)
		}
	}
	return options
}

function findZipEndOfCentralDirectory(buffer) {
	const minimumOffset = Math.max(0, buffer.length - 22 - 0xffff)
	for (let offset = buffer.length - 22; offset >= minimumOffset; offset--) {
		if (buffer.readUInt32LE(offset) === 0x06054b50) {
			return offset
		}
	}
	throw new Error("standalone.zip is not a readable zip archive")
}

function listZipEntries(zipPath) {
	const buffer = fs.readFileSync(zipPath)
	const eocdOffset = findZipEndOfCentralDirectory(buffer)
	const entryCount = buffer.readUInt16LE(eocdOffset + 10)
	const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16)
	const entries = new Map()
	let offset = centralDirectoryOffset
	for (let index = 0; index < entryCount; index += 1) {
		if (buffer.readUInt32LE(offset) !== 0x02014b50) {
			throw new Error(`standalone.zip central directory is corrupt at entry ${index}`)
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

function readZipEntry(zip, entryName) {
	const entry = zip.entries.get(entryName)
	if (!entry) {
		throw new Error(`standalone.zip is missing ${entryName}`)
	}
	const { buffer } = zip
	if (buffer.readUInt32LE(entry.localHeaderOffset) !== 0x04034b50) {
		throw new Error(`standalone.zip local file header is corrupt for ${entryName}`)
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
	throw new Error(`standalone.zip entry ${entryName} uses unsupported compression method ${entry.compressionMethod}`)
}

function readJsonEntry(zip, entryName) {
	return JSON.parse(readZipEntry(zip, entryName).toString("utf8"))
}

function hasEntry(zip, entryName) {
	return zip.entries.has(entryName)
}

function hasEntryUnder(zip, entryPrefix) {
	for (const entryName of zip.entries.keys()) {
		if (entryName.startsWith(entryPrefix)) {
			return true
		}
	}
	return false
}

function assert(condition, message, failures) {
	if (!condition) {
		failures.push(message)
	}
}

function verifyStandalonePackage(zipPath) {
	const zip = listZipEntries(zipPath)
	const failures = []
	const manifest = readJsonEntry(zip, "standalone-manifest.json")
	const runtimePackage = readJsonEntry(zip, "package.json")
	const extensionPackage = readJsonEntry(zip, "extension/package.json")

	assert(manifest.schemaVersion === 1, "manifest.schemaVersion must be 1", failures)
	assert(manifest.product?.name === "CodeVibe", "manifest.product.name must be CodeVibe", failures)
	assert(
		manifest.product?.extensionVersion === extensionPackage.version,
		"manifest.product.extensionVersion must match extension/package.json",
		failures,
	)
	assert(
		manifest.product?.runtimeVersion === runtimePackage.version,
		"manifest.product.runtimeVersion must match runtime package.json",
		failures,
	)
	assert(
		manifest.product?.runtimeName === runtimePackage.name,
		"manifest.product.runtimeName must match runtime package.json",
		failures,
	)
	assert(
		manifest.package?.coreEntry === runtimePackage.main,
		"manifest.package.coreEntry must match runtime package main",
		failures,
	)
	assert(hasEntry(zip, manifest.package?.coreEntry), `standalone.zip must include ${manifest.package?.coreEntry}`, failures)
	assert(hasEntry(zip, "node_modules/vscode/package.json"), "standalone.zip must include the local vscode shim", failures)
	assert(
		hasEntry(zip, manifest.uiContract?.descriptorSetPath),
		`standalone.zip must include ${manifest.uiContract?.descriptorSetPath}`,
		failures,
	)
	assert(manifest.services?.hostBridge?.required === true, "manifest.services.hostBridge.required must be true", failures)
	assert(manifest.services?.hostBridge?.bundled === false, "manifest.services.hostBridge.bundled must be false", failures)
	assert(
		manifest.uiContract?.requiresExternalHostBridge === true,
		"manifest.uiContract.requiresExternalHostBridge must be true",
		failures,
	)
	assert(manifest.uiContract?.selfContainedApp === false, "manifest.uiContract.selfContainedApp must be false", failures)
	assert(
		manifest.uiContract?.providesCoreGrpcServer === true,
		"manifest.uiContract.providesCoreGrpcServer must be true",
		failures,
	)
	assert(
		manifest.uiContract?.providesHostBridgeServer === false,
		"manifest.uiContract.providesHostBridgeServer must be false",
		failures,
	)
	assert(
		manifest.uiContract?.resourceHostname === "internal.resources",
		"manifest.uiContract.resourceHostname is wrong",
		failures,
	)
	assert(
		hasEntry(zip, `${manifest.uiContract?.webviewBuildPath}/index.html`),
		"standalone.zip must include webview index.html",
		failures,
	)
	assert(
		hasEntry(zip, `${manifest.uiContract?.webviewBuildPath}/assets/index.js`),
		"standalone.zip must include webview index.js",
		failures,
	)
	assert(
		hasEntry(zip, `${manifest.uiContract?.webviewBuildPath}/assets/index.css`),
		"standalone.zip must include webview index.css",
		failures,
	)
	assert(
		hasEntry(zip, "extension/node_modules/@vscode/codicons/dist/codicon.css"),
		"standalone.zip must include codicon.css for external webviews",
		failures,
	)
	assert(
		hasEntry(zip, "extension/node_modules/@vscode/codicons/dist/codicon.ttf"),
		"standalone.zip must include codicon.ttf for external webviews",
		failures,
	)
	assert(manifest.launch?.command === "node", "manifest.launch.command must be node", failures)
	assert(
		Array.isArray(manifest.launch?.args) && manifest.launch.args.includes(manifest.package?.coreEntry),
		"manifest.launch.args must include the core entrypoint",
		failures,
	)
	assert(
		manifest.launch?.nodePath === "{target.binariesPath}:./node_modules",
		"manifest.launch.nodePath must describe native binary module resolution",
		failures,
	)

	if (manifest.binaryModules?.universalBuild) {
		for (const target of manifest.targets ?? []) {
			assert(
				hasEntryUnder(zip, `${target.binariesPath}/`),
				`standalone.zip must include packaged binary module path ${target.binariesPath}`,
				failures,
			)
		}
	}

	if (failures.length > 0) {
		throw new Error(`Standalone package verification failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`)
	}
	console.log(`Standalone package verified: ${zipPath}`)
}

const options = parseArgs(process.argv.slice(2))
verifyStandalonePackage(options.zip)
