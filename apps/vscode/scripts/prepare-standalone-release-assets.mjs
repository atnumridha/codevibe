#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import zlib from "node:zlib"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.join(__dirname, "..")
const standaloneDir = path.join(projectRoot, "dist-standalone")
const standaloneZipPath = path.join(standaloneDir, "standalone.zip")
const standaloneManifestPath = path.join(standaloneDir, "standalone-manifest.json")
const standaloneChecksumPath = `${standaloneZipPath}.sha256`
const sourcePackageJsonPath = path.join(projectRoot, "package.json")

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

function readJsonFile(filePath) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function getSourceVersion() {
	const version = readJsonFile(sourcePackageJsonPath).version
	if (typeof version !== "string" || !version.trim()) {
		throw new Error(`Source package.json is missing a version at ${sourcePackageJsonPath}`)
	}
	return version.trim()
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
		entries.set(fileName, { compressionMethod, compressedSize, localHeaderOffset })
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

function readZipJsonEntry(zip, entryName) {
	return JSON.parse(readZipEntry(zip, entryName).toString("utf8"))
}

function readChecksumFile() {
	if (!fs.existsSync(standaloneChecksumPath)) {
		return null
	}
	const [hash] = fs.readFileSync(standaloneChecksumPath, "utf8").trim().split(/\s+/)
	return /^[a-f0-9]{64}$/i.test(hash ?? "") ? hash.toLowerCase() : null
}

function hashStandaloneZip() {
	return createHash("sha256").update(fs.readFileSync(standaloneZipPath)).digest("hex")
}

function inspectStandaloneReleaseAssets({ requireChecksum = true } = {}) {
	const expectedVersion = getSourceVersion()
	const issues = []
	let zipHash = null

	if (!fs.existsSync(standaloneZipPath)) {
		issues.push("standalone.zip is missing")
	} else {
		zipHash = hashStandaloneZip()
		try {
			const zip = listZipEntries(standaloneZipPath)
			if (zip.entries.has("standalone.zip.sha256")) {
				issues.push("standalone.zip contains standalone.zip.sha256")
			}
			const zipManifest = readZipJsonEntry(zip, "standalone-manifest.json")
			const extensionPackage = readZipJsonEntry(zip, "extension/package.json")
			if (zipManifest.product?.extensionVersion !== expectedVersion) {
				issues.push(
					`standalone.zip manifest version ${zipManifest.product?.extensionVersion ?? "missing"} does not match ${expectedVersion}`,
				)
			}
			if (extensionPackage.version !== expectedVersion) {
				issues.push(
					`standalone.zip extension/package.json version ${extensionPackage.version ?? "missing"} does not match ${expectedVersion}`,
				)
			}
		} catch (error) {
			issues.push(`standalone.zip metadata could not be read: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	if (!fs.existsSync(standaloneManifestPath)) {
		issues.push("standalone-manifest.json is missing")
	} else {
		const manifest = readJsonFile(standaloneManifestPath)
		if (manifest.product?.extensionVersion !== expectedVersion) {
			issues.push(
				`standalone-manifest.json version ${manifest.product?.extensionVersion ?? "missing"} does not match ${expectedVersion}`,
			)
		}
	}

	if (requireChecksum) {
		const recordedChecksum = readChecksumFile()
		if (!recordedChecksum) {
			issues.push("standalone.zip.sha256 is missing or malformed")
		} else if (zipHash && recordedChecksum !== zipHash) {
			issues.push(`standalone.zip.sha256 ${recordedChecksum} does not match actual ${zipHash}`)
		}
	}

	return { expectedVersion, issues, reusable: issues.length === 0, zipHash }
}

function ensureStandaloneZip() {
	const current = inspectStandaloneReleaseAssets({ requireChecksum: true })
	if (current.reusable) {
		return { rebuilt: false, reason: "existing standalone release assets are current" }
	}
	console.log(`Regenerating standalone release assets: ${current.issues.join("; ")}`)
	runCommand("npm", ["run", "compile-standalone"])
	const rebuilt = inspectStandaloneReleaseAssets({ requireChecksum: false })
	if (rebuilt.issues.length > 0) {
		throw new Error(`Regenerated standalone assets are still invalid: ${rebuilt.issues.join("; ")}`)
	}
	return { rebuilt: true, reason: current.issues.join("; ") }
}

function verifyStandaloneZip() {
	runCommand(process.execPath, ["scripts/verify-standalone-package.mjs", "--zip", standaloneZipPath])
	if (!fs.existsSync(standaloneManifestPath)) {
		throw new Error(`Standalone manifest was not found at ${standaloneManifestPath}`)
	}
	const status = inspectStandaloneReleaseAssets({ requireChecksum: false })
	if (status.issues.length > 0) {
		throw new Error(`Standalone release assets are invalid: ${status.issues.join("; ")}`)
	}
}

function writeChecksum() {
	const hash = hashStandaloneZip()
	fs.writeFileSync(standaloneChecksumPath, `${hash}  standalone.zip\n`, "utf8")
	return hash
}

function main() {
	const build = ensureStandaloneZip()
	verifyStandaloneZip()
	const sha256 = writeChecksum()
	const finalStatus = inspectStandaloneReleaseAssets({ requireChecksum: true })
	if (finalStatus.issues.length > 0) {
		throw new Error(`Standalone release assets failed final verification: ${finalStatus.issues.join("; ")}`)
	}
	console.log(
		JSON.stringify(
			{
				standaloneZip: path.relative(projectRoot, standaloneZipPath),
				standaloneManifest: path.relative(projectRoot, standaloneManifestPath),
				checksum: path.relative(projectRoot, standaloneChecksumPath),
				sha256,
				rebuilt: build.rebuilt,
				reason: build.reason,
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
