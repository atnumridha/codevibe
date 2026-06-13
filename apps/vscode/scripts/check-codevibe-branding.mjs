#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import zlib from "node:zlib"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.join(__dirname, "..")
const repoRoot = path.resolve(projectRoot, "../..")

const scannedRoots = [
	"README.md",
	"README.marketplace.md",
	"package.json",
	"walkthrough",
	"assets",
	"standalone/runtime-files/package.json",
	"src/extension.ts",
	"src/core/hooks",
	"src/core/task/tools/handlers/ReportBugHandler.ts",
	"src/hosts",
	"src/services/lg-cns-integration",
	"webview-ui/.storybook",
	"webview-ui/src",
]

const scannedRepoRoots = [
	"apps/cli/src/acp/auth.ts",
	"apps/cli/src/commands/cursor-mcp.ts",
	"apps/cli/src/commands/dashboard.ts",
	"apps/cli/src/commands/program.ts",
	"apps/cli/src/wizards/schedule/index.ts",
	"apps/cline-hub/src/server.ts",
	"apps/cline-hub/src/server/approvals.ts",
	"apps/cline-hub/src/server/http.ts",
	"apps/cline-hub/src/server/hub.ts",
	"apps/cline-hub/src/server/mcp.ts",
	"apps/cline-hub/src/server/sessions.ts",
	"apps/cline-hub/src/server/standalone-readiness.ts",
	"apps/cline-hub/src/server/utils.ts",
	"apps/cline-hub/src/webview/index.html",
	"apps/cline-hub/src/webview/src/App.tsx",
	"apps/cline-hub/src/webview/src/Chat.tsx",
	"apps/cline-hub/src/webview/src/components/ai-elements",
	"apps/cline-hub/src/webview/src/components/views/settings",
	"apps/cline-hub/src/webview/src/lib/provider-display.ts",
	"docs/api",
	"docs/enterprise-solutions",
	"docs/getting-started",
	"docs/overview.mdx",
	"docs/provider-config",
	"docs/sdk",
	"docs/vscode-vsix-release.md",
]

const requiredVisibleSurfaceEvidence = [
	{
		file: "apps/cline-hub/src/server.ts",
		fragments: [
			"Codie Agent Hub dashboard listening",
			"Codie Agent Hub public URL",
			"Codie Agent Hub invite URL",
		],
		label: "hub startup logs must use Codie Agent Hub",
	},
	{
		file: "apps/cline-hub/src/server/http.ts",
		fragments: [
			"<title>Codie Agent Hub</title>",
			"Codie Agent Hub webview is not built.",
		],
		label: "hub HTML shell must use Codie Agent Hub",
	},
	{
		file: "apps/cline-hub/src/webview/index.html",
		fragments: ["<title>Codie Agent Hub</title>"],
		label: "hub webview title must use Codie Agent Hub",
	},
	{
		file: "apps/cline-hub/src/server/hub.ts",
		fragments: [
			'displayName: "Codie Agent Hub Chat"',
			'displayName: "Codie Agent Hub Server"',
		],
		label: "hub client display names must use Codie Agent Hub",
	},
	{
		file: "apps/cline-hub/src/server/sessions.ts",
		fragments: ["Codie Agent Hub is ready."],
		label: "hub ready status must use Codie Agent Hub",
	},
	{
		file: "apps/cline-hub/src/server/standalone-readiness.ts",
		fragments: ['app: "Codie"'],
		label: "standalone readiness payload must expose Codie app branding",
	},
	{
		file: "apps/cline-hub/src/webview/src/lib/provider-display.ts",
			fragments: [
				'"Codie Agent"',
				'"Codie Local CLI"',
				'cline: "Codie Cloud"',
			],
		label: "hub provider display names must use Codie",
	},
	{
		file: "apps/cli/src/commands/program.ts",
		fragments: [
			'new Command("codevibe")',
			"Configuration directory (Codie data/settings path; legacy ~/.cline paths remain accepted)",
		],
		label: "CLI shell must keep stable codevibe command with Codie config help text",
	},
	{
		file: "apps/cli/src/commands/cursor-mcp.ts",
		fragments: [
			'clientType: "cli-cursor-background-agent"',
			'clientType: "cli-cursor-agent-task"',
			'source: "codevibe-cli-cursor-agent-task"',
		],
		label: "CLI Cursor route bridge must keep compatibility client/source IDs",
	},
]

const scannedExtensions = new Set([".css", ".html", ".js", ".jsx", ".json", ".md", ".mjs", ".svg", ".ts", ".tsx"])

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
	{ pattern: /\bCodeVibe\b/g, label: "visible CodeVibe brand; use Codie for product copy" },
	{ pattern: /\bCline\b/g, label: "visible Cline brand" },
	{ pattern: /\bClineCore\b/g, label: "legacy ClineCore SDK name; prefer CodieCore outside compatibility docs" },
	{ pattern: /cline\.bot/gi, label: "Cline service domain" },
	{ pattern: /\bCLINE_API_KEY\b/g, label: "legacy Cline API key environment variable" },
	{ pattern: /github\.com\/cline\/cline/gi, label: "upstream Cline repository URL" },
	{ pattern: /saoudrizwan\.claude-dev/gi, label: "legacy extension id" },
	{ pattern: /claude-dev\.SidebarProvider/g, label: "legacy sidebar provider id" },
	{ pattern: /Legacy Panel/g, label: "stale legacy panel label" },
	{ pattern: /What can I do for you\?/g, label: "legacy welcome headline" },
	{ pattern: /Starter workflows/g, label: "legacy starter workflow copy" },
	{ pattern: /Workspace console/g, label: "legacy workspace console copy" },
	{ pattern: /works best with Claude models/g, label: "Claude-first provider warning copy" },
	{ pattern: /Codie works best with[\s\S]{0,200}anthropic\/claude/g, label: "Claude-first model fallback copy" },
	{ pattern: /recommended to use Claude 4\.5 Sonnet/g, label: "Claude-first recovery prompt copy" },
	{ pattern: /models like Claude Sonnet/g, label: "Claude-first welcome copy" },
	{ pattern: /Anthropic, Gemini, OpenAI/g, label: "vendor-first walkthrough copy" },
	{ pattern: /Codex, GPT, Gemini, Claude/g, label: "vendor-first onboarding copy" },
	{ pattern: /Codex, OpenAI, Claude, Gemini/g, label: "vendor-first authorization copy" },
	{ pattern: /OpenAI-compatible, Anthropic, Gemini/g, label: "vendor-first provider picker copy" },
	{ pattern: /Claude Max\/Pro subscription/g, label: "provider subscription copy" },
	{ pattern: /GLM Coding Plans/g, label: "provider subscription-plan copy" },
	{ pattern: /subscription plans specifically designed/g, label: "provider subscription-plan copy" },
	{ pattern: /frontier provider/g, label: "provider marketing copy" },
	{ pattern: /competitive pricing/g, label: "provider marketing copy" },
	{ pattern: /AWS Marketplace Subscriptions/g, label: "provider subscription copy" },
	{ pattern: /Set Up AWS Marketplace Subscriptions/g, label: "provider subscription copy" },
	{ pattern: /Continue with ChatGPT/g, label: "vendor-first sign-in button copy" },
	{ pattern: /Sign in with ChatGPT/g, label: "vendor-first sign-in button copy" },
	{ pattern: /Signed in to ChatGPT/g, label: "vendor-first sign-in status copy" },
	{ pattern: /ChatGPT authorization/g, label: "vendor-first auth status copy" },
	{ pattern: /ChatGPT auth/g, label: "vendor-first auth copy" },
	{ pattern: /ChatGPT-backed/g, label: "vendor-first sidebar copy" },
	{ pattern: /Codex auth/g, label: "vendor-first auth copy" },
	{ pattern: /Open in ChatGPT/g, label: "external vendor chat launcher copy" },
	{ pattern: /Open in Claude/g, label: "external vendor chat launcher copy" },
	{ pattern: /Open in T3 Chat/g, label: "external vendor chat launcher copy" },
	{ pattern: /Open in v0/g, label: "external vendor chat launcher copy" },
	{ pattern: /Absolutely Free/g, label: "consumer-tier onboarding copy" },
	{ pattern: /Frontier Model/g, label: "vendor-tier onboarding copy" },
	{ pattern: /premium hosted/g, label: "premium-tier provider copy" },
	{ pattern: /View Billing & Usage/g, label: "billing-first account copy" },
	{ pattern: /Payment history/g, label: "payment-first account copy" },
	{ pattern: /No payment transactions/g, label: "payment-first account empty state" },
	{ pattern: /USAGE BALANCE/g, label: "usage-balance account headline" },
	{ pattern: /Manage Usage/g, label: "usage-management account CTA" },
	{ pattern: /Add Credits/g, label: "credits-first account copy" },
	{ pattern: /Buy Credits/g, label: "credits-first account copy" },
	{ pattern: /Credits Used/g, label: "credits-first account usage table copy" },
	{ pattern: /Credit Limit Reached/g, label: "credits-first error copy" },
	{ pattern: /Spend Limit Reached/g, label: "spend-first error copy" },
	{ pattern: /cursor:\/\/createchat/g, label: "Cursor-first deeplink placeholder" },
	{ pattern: /Cursor workspace/g, label: "Cursor-first MCP provenance label" },
	{ pattern: /Cursor global/g, label: "Cursor-first MCP provenance label" },
	{ pattern: /Current Cline extension version/g, label: "legacy hook metadata docs" },
	{ pattern: /Cline user ID/g, label: "legacy hook user metadata docs" },
	{ pattern: /Input:[\s\S]{0,160}clineVersion/g, label: "legacy hook template metadata" },
	{ pattern: /cline_version\s*[:=]/g, label: "legacy Cline version payload key" },
]

const scannedVsixArtifacts = ["dist/e2e.vsix"]
const scannedStandaloneArtifacts = ["dist-standalone/standalone.zip"]
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"))

const allowedVisibleCompatibilityPhrases = []

function toPosix(filePath) {
	return filePath.split(path.sep).join("/")
}

function shouldSkip(filePath, baseRoot = projectRoot) {
	const rel = toPosix(path.relative(baseRoot, filePath))
	return skippedPathFragments.some((fragment) => rel.includes(fragment))
}

function collectFiles(entryPath, files = [], baseRoot = projectRoot) {
	if (!fs.existsSync(entryPath) || shouldSkip(entryPath, baseRoot)) {
		return files
	}
	const stat = fs.statSync(entryPath)
	if (stat.isDirectory()) {
		for (const entry of fs.readdirSync(entryPath)) {
			collectFiles(path.join(entryPath, entry), files, baseRoot)
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

function isIdentifierCharacter(character) {
	return Boolean(character && /[A-Za-z0-9_$]/.test(character))
}

function isIdentifierOccurrence(text, index, length) {
	return isIdentifierCharacter(text[index - 1]) || isIdentifierCharacter(text[index + length])
}

function isAllowedVisibleCompatibilityText(text, file, index) {
	const surrounding = text.slice(Math.max(0, index - 140), index + 180)
	return allowedVisibleCompatibilityPhrases.some(
		({ file: allowedFile, phrase }) => file === allowedFile && surrounding.includes(phrase),
	)
}

function isAllowedCodeVibeInternalText(text, file, index) {
	const surrounding = text.slice(Math.max(0, index - 80), index + 120)
	return (
		isIdentifierOccurrence(text, index, "CodeVibe".length) ||
		isAllowedVisibleCompatibilityText(text, file, index) ||
		surrounding.includes("Documents/CodeVibe") ||
		surrounding.includes("Documents\\CodeVibe") ||
		(surrounding.includes("\"Documents\"") && surrounding.includes("\"CodeVibe\"")) ||
		(surrounding.includes("Join-Path") && surrounding.includes("\"CodeVibe\"")) ||
		file.includes("CodeVibeAuthContext.tsx") ||
		file.includes("CodeVibeMark.tsx")
	)
}

function isAllowedClineInternalText(text, file, index) {
	const surrounding = text.slice(Math.max(0, index - 120), index + 160)
	return (
		isIdentifierOccurrence(text, index, "Cline".length) ||
		surrounding.includes("@cline/") ||
		surrounding.includes("provider id as `cline`") ||
		surrounding.includes('id: "cline"') ||
		surrounding.includes('"value": "cline"') ||
		surrounding.includes("legacy ~/.cline") ||
		surrounding.includes("Documents/Cline") ||
		surrounding.includes("Documents\\Cline") ||
		(surrounding.includes("\"Documents\"") && surrounding.includes("\"Cline\""))
	)
}

function isAllowedClineCoreCompatibilityText(text, file, index) {
	const surrounding = text.slice(Math.max(0, index - 280), index + 520)
	const following = text.slice(index, index + 2_000)
	return (
		isIdentifierOccurrence(text, index, "ClineCore".length) ||
		surrounding.includes("compatibility") ||
		surrounding.includes("@cline/") ||
		surrounding.includes("@cline/core") ||
		following.includes('from "@cline/core"') ||
		following.includes("from '@cline/core'") ||
		surrounding.includes("existing imports") ||
		surrounding.includes("stable") ||
		surrounding.includes("upstream-compatible") ||
		surrounding.includes("ClineCore.create") ||
		surrounding.includes("ClineCore.subscribe")
	)
}

function isAllowedFinding(text, file, index, label) {
	if (label.startsWith("visible CodeVibe")) {
		return isAllowedCodeVibeInternalText(text, file, index)
	}
	if (label === "visible Cline brand") {
		return isAllowedClineInternalText(text, file, index)
	}
	if (label.startsWith("legacy ClineCore SDK name")) {
		return isAllowedClineCoreCompatibilityText(text, file, index)
	}
	return false
}

function collectFindingsFromText(text, file) {
	for (const { pattern, label } of disallowedFragments) {
		pattern.lastIndex = 0
		for (const match of text.matchAll(pattern)) {
			const matchIndex = match.index ?? 0
			if (isAllowedFinding(text, file, matchIndex, label)) {
				continue
			}
			findings.push({
				file,
				line: lineNumberForIndex(text, matchIndex),
				label,
				value: match[0],
			})
		}
	}

	if (file.startsWith("webview-ui/src/") && file !== "webview-ui/src/context/ClineAuthContext.tsx") {
		const legacyAuthImportPattern = /from\s+["'][^"']*ClineAuthContext["']/g
		for (const match of text.matchAll(legacyAuthImportPattern)) {
			findings.push({
				file,
				line: lineNumberForIndex(text, match.index ?? 0),
				label: "legacy auth context import",
				value: match[0],
			})
		}
	}

	if (
		!file.endsWith("ClineProvider.tsx") &&
		!file.endsWith("ClineAccountInfoCard.tsx") &&
		!file.endsWith("ClineModelPicker.tsx") &&
		!file.endsWith("ClineRulesToggleModal.tsx")
	) {
		const legacySettingsProviderImportPattern =
			/from\s+["'][^"']*(?:providers\/ClineProvider|ClineAccountInfoCard|ClineModelPicker|ClineRulesToggleModal)["']/g
		for (const match of text.matchAll(legacySettingsProviderImportPattern)) {
			findings.push({
				file,
				line: lineNumberForIndex(text, match.index ?? 0),
				label: "legacy CodeVibe shim import",
				value: match[0],
			})
		}
	}

	if (!file.includes("webview-ui/src/components/cline-rules/")) {
		const legacyRulesModalImportPattern =
			/from\s+["'][^"']*cline-rules\/(?:CodeVibeRulesToggleModal|HookRow|NewRuleRow|RuleRow|RulesToggleList)["']/g
		for (const match of text.matchAll(legacyRulesModalImportPattern)) {
			findings.push({
				file,
				line: lineNumberForIndex(text, match.index ?? 0),
				label: "legacy rules import path",
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

for (const root of scannedRepoRoots) {
	const absoluteRoot = path.join(repoRoot, root)
	for (const filePath of collectFiles(absoluteRoot, [], repoRoot)) {
		collectFindingsFromText(fs.readFileSync(filePath, "utf8"), toPosix(path.relative(repoRoot, filePath)))
	}
}

for (const { file, fragments, label } of requiredVisibleSurfaceEvidence) {
	const absoluteFile = path.join(repoRoot, file)
	if (!fs.existsSync(absoluteFile)) {
		findings.push({
			file,
			line: 1,
			label,
			value: "required audit evidence file is missing",
		})
		continue
	}
	const text = fs.readFileSync(absoluteFile, "utf8")
	for (const fragment of fragments) {
		if (!text.includes(fragment)) {
			findings.push({
				file,
				line: 1,
				label,
				value: `missing ${JSON.stringify(fragment)}`,
			})
		}
	}
}

function collectStandaloneMetadataFindings(manifestText, runtimePackageText, fileLabel) {
	collectFindingsFromText(manifestText, `${fileLabel}!/standalone-manifest.json`)
	collectFindingsFromText(runtimePackageText, `${fileLabel}!/package.json`)
	const manifest = JSON.parse(manifestText)
	const runtimePackage = JSON.parse(runtimePackageText)
	if (manifest.product?.name !== "Codie") {
		findings.push({
			file: `${fileLabel}!/standalone-manifest.json`,
			line: 1,
			label: "standalone product branding",
			value: `${manifest.product?.name ?? "missing"} != Codie`,
		})
	}
	if (runtimePackage.description !== "Codie standalone core runtime") {
		findings.push({
			file: `${fileLabel}!/package.json`,
			line: 1,
			label: "standalone runtime branding",
			value: `${runtimePackage.description ?? "missing"} != Codie standalone core runtime`,
		})
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
	const zip = listZipEntries(artifactPath)
	const packageJsonText = readZipEntry(zip, "extension/package.json").toString("utf8")
	const artifactPackageJson = JSON.parse(packageJsonText)
	collectFindingsFromText(packageJsonText, `${artifact}!/extension/package.json`)
	if (artifactPackageJson.version !== packageJson.version) {
		findings.push({
			file: `${artifact}!/extension/package.json`,
			line: 1,
			label: "stale VSIX artifact version",
			value: `${artifactPackageJson.version} != ${packageJson.version}`,
		})
	}
	const manifestText = readZipEntry(zip, "extension.vsixmanifest").toString("utf8")
	if (!manifestText.includes(`Version="${packageJson.version}"`)) {
		findings.push({
			file: `${artifact}!/extension.vsixmanifest`,
			line: 1,
			label: "stale VSIX manifest version",
			value: `expected ${packageJson.version}`,
		})
	}
}

const standaloneManifestPath = path.join(projectRoot, "dist-standalone", "standalone-manifest.json")
const standaloneRuntimePackagePath = path.join(projectRoot, "dist-standalone", "package.json")
if (fs.existsSync(standaloneManifestPath) && fs.existsSync(standaloneRuntimePackagePath)) {
	collectStandaloneMetadataFindings(
		fs.readFileSync(standaloneManifestPath, "utf8"),
		fs.readFileSync(standaloneRuntimePackagePath, "utf8"),
		"dist-standalone",
	)
}

for (const artifact of scannedStandaloneArtifacts) {
	const artifactPath = path.join(projectRoot, artifact)
	if (!fs.existsSync(artifactPath)) {
		continue
	}
	const zip = listZipEntries(artifactPath)
	collectStandaloneMetadataFindings(
		readZipEntry(zip, "standalone-manifest.json").toString("utf8"),
		readZipEntry(zip, "package.json").toString("utf8"),
		artifact,
	)
}

const iconCheck = spawnSync(process.execPath, [path.join("scripts", "render-codevibe-icon.mjs"), "--check"], {
	cwd: projectRoot,
	encoding: "utf8",
})
if (iconCheck.status !== 0) {
	findings.push({
		file: "assets/icons/icon.png",
		line: 1,
		label: "stale CodeVibe icon PNG",
		value: (iconCheck.stderr || iconCheck.stdout || "icon check failed").trim(),
	})
}

if (findings.length > 0) {
	console.error(
		"Codie branding audit failed. Replace visible legacy branding or move compatibility-only text into tests/generated allow-listed paths.",
	)
	for (const finding of findings) {
		console.error(`${finding.file}:${finding.line}: ${finding.label}: ${JSON.stringify(finding.value)}`)
	}
	process.exit(1)
}

console.log("Codie branding audit passed")
