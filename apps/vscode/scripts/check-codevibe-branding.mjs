#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import zlib from "node:zlib"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.join(__dirname, "..")

const scannedRoots = [
	"README.md",
	"README.marketplace.md",
	"package.json",
	"walkthrough",
	"assets",
	"src/extension.ts",
	"src/hosts",
	"webview-ui/src",
]

const scannedExtensions = new Set([
	".css",
	".html",
	".js",
	".jsx",
	".json",
	".md",
	".mjs",
	".svg",
	".ts",
	".tsx",
])

const skippedPathFragments = [
	"/__snapshots__/",
	"/__tests__/",
	"/generated/",
	"/node_modules/",
	"/storybook-static/",
	"/test/",
	"/testing-platform/",
	".stories.",
	".spec.",
	".test.",
]

const disallowedFragments = [
	{ pattern: /\bCline\b/g, label: "visible Cline brand" },
	{ pattern: /cline\.bot/gi, label: "Cline service domain" },
	{ pattern: /github\.com\/cline\/cline/gi, label: "upstream Cline repository URL" },
	{ pattern: /saoudrizwan\.claude-dev/gi, label: "legacy extension id" },
	{ pattern: /claude-dev\.SidebarProvider/g, label: "legacy sidebar provider id" },
	{ pattern: /Legacy Panel/g, label: "stale legacy panel label" },
	{ pattern: /What can I do for you\?/g, label: "legacy welcome headline" },
	{ pattern: /Starter workflows/g, label: "legacy starter workflow copy" },
	{ pattern: /Workspace console/g, label: "legacy workspace console copy" },
]

const scannedVsixArtifacts = ["dist/e2e.vsix"]

function toPosix(filePath) {
	return filePath.split(path.sep).join("/")
}

function shouldSkip(filePath) {
	const rel = toPosix(path.relative(projectRoot, filePath))
	return skippedPathFragments.some((fragment) => rel.includes(fragment))
}

function collectFiles(entryPath, files = []) {
	if (!fs.existsSync(entryPath) || shouldSkip(entryPath)) {
		return files
	}
	const stat = fs.statSync(entryPath)
	if (stat.isDirectory()) {
		for (const entry of fs.readdirSync(entryPath)) {
			collectFiles(path.join(entryPath, entry), files)
		}
		return files
	}
	if (stat.isFile() && scannedExtensions.has(path.extname(entryPath))) {
		files.push(entryPath)
	}
	return files
}

function lineNumberForIndex(text, index) {
	let line = 1
	for (let cursor = 0; cursor < index; cursor++) {
		if (text.charCodeAt(cursor) === 10) {
			line++
		}
	}
	return line
}

const findings = []

function collectFindingsFromText(text, file) {
	for (const { pattern, label } of disallowedFragments) {
		pattern.lastIndex = 0
		for (const match of text.matchAll(pattern)) {
			findings.push({
				file,
				line: lineNumberForIndex(text, match.index ?? 0),
				label,
				value: match[0],
			})
		}
	}
}

for (const root of scannedRoots) {
	const absoluteRoot = path.join(projectRoot, root)
	for (const filePath of collectFiles(absoluteRoot)) {
		collectFindingsFromText(fs.readFileSync(filePath, "utf8"), toPosix(path.relative(projectRoot, filePath)))
	}
}

function findZipEndOfCentralDirectory(buffer) {
	const minimumOffset = Math.max(0, buffer.length - 22 - 0xffff)
	for (let offset = buffer.length - 22; offset >= minimumOffset; offset--) {
		if (buffer.readUInt32LE(offset) === 0x06054b50) {
			return offset
		}
	}
	throw new Error("VSIX artifact is not a readable zip archive")
}

function listZipEntries(zipPath) {
	const buffer = fs.readFileSync(zipPath)
	const eocdOffset = findZipEndOfCentralDirectory(buffer)
	const entryCount = buffer.readUInt16LE(eocdOffset + 10)
	const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16)
	const entries = new Map()
	let offset = centralDirectoryOffset
	for (let index = 0; index < entryCount; index++) {
		if (buffer.readUInt32LE(offset) !== 0x02014b50) {
			throw new Error(`VSIX central directory is corrupt at entry ${index}`)
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
		throw new Error(`VSIX artifact is missing ${entryName}`)
	}
	const { buffer } = zip
	if (buffer.readUInt32LE(entry.localHeaderOffset) !== 0x04034b50) {
		throw new Error(`VSIX local file header is corrupt for ${entryName}`)
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
	throw new Error(`VSIX entry ${entryName} uses unsupported compression method ${entry.compressionMethod}`)
}

for (const artifact of scannedVsixArtifacts) {
	const artifactPath = path.join(projectRoot, artifact)
	if (!fs.existsSync(artifactPath)) {
		continue
	}
	const packageJsonText = readZipEntry(listZipEntries(artifactPath), "extension/package.json").toString("utf8")
	collectFindingsFromText(packageJsonText, `${artifact}!/extension/package.json`)
}

if (findings.length > 0) {
	console.error("CodeVibe branding audit failed. Replace visible legacy branding or move compatibility-only text into tests/generated allow-listed paths.")
	for (const finding of findings) {
		console.error(`${finding.file}:${finding.line}: ${finding.label}: ${JSON.stringify(finding.value)}`)
	}
	process.exit(1)
}

console.log("CodeVibe branding audit passed")
