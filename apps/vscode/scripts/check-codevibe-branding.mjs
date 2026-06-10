#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

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
	{ pattern: /What can I do for you\?/g, label: "legacy welcome headline" },
	{ pattern: /Starter workflows/g, label: "legacy starter workflow copy" },
	{ pattern: /Workspace console/g, label: "legacy workspace console copy" },
]

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
for (const root of scannedRoots) {
	const absoluteRoot = path.join(projectRoot, root)
	for (const filePath of collectFiles(absoluteRoot)) {
		const text = fs.readFileSync(filePath, "utf8")
		for (const { pattern, label } of disallowedFragments) {
			pattern.lastIndex = 0
			for (const match of text.matchAll(pattern)) {
				findings.push({
					file: toPosix(path.relative(projectRoot, filePath)),
					line: lineNumberForIndex(text, match.index ?? 0),
					label,
					value: match[0],
				})
			}
		}
	}
}

if (findings.length > 0) {
	console.error("CodeVibe branding audit failed. Replace visible legacy branding or move compatibility-only text into tests/generated allow-listed paths.")
	for (const finding of findings) {
		console.error(`${finding.file}:${finding.line}: ${finding.label}: ${JSON.stringify(finding.value)}`)
	}
	process.exit(1)
}

console.log("CodeVibe branding audit passed")
