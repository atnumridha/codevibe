#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(scriptDir, "..")
const repoRoot = path.resolve(appRoot, "../..")

const failures = []

function read(relativePath) {
	const absolutePath = path.resolve(repoRoot, relativePath)
	try {
		return fs.readFileSync(absolutePath, "utf8")
	} catch (error) {
		fail(relativePath, `file must be readable: ${error.message}`)
		return ""
	}
}

function fail(relativePath, message) {
	failures.push(`${relativePath}: ${message}`)
}

function requireIncludes(relativePath, literals) {
	const content = read(relativePath)
	for (const literal of literals) {
		if (!content.includes(literal)) {
			fail(relativePath, `missing literal ${JSON.stringify(literal)}`)
		}
	}
}

function readJson(relativePath) {
	const content = read(relativePath)
	try {
		return JSON.parse(content)
	} catch (error) {
		fail(relativePath, `invalid JSON: ${error.message}`)
		return undefined
	}
}

function requireJsonValue(relativePath, selector, expected) {
	const parsed = readJson(relativePath)
	if (!parsed) {
		return
	}

	try {
		const actual = selector(parsed)
		if (actual !== expected) {
			fail(relativePath, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
		}
	} catch (error) {
		fail(relativePath, `invalid JSON or selector failure: ${error.message}`)
	}
}

function requireJsonArrayItem(relativePath, selector, description, predicate) {
	const parsed = readJson(relativePath)
	if (!parsed) {
		return
	}

	try {
		const actual = selector(parsed)
		if (!Array.isArray(actual) || !actual.some(predicate)) {
			fail(relativePath, `missing ${description}`)
		}
	} catch (error) {
		fail(relativePath, `selector failure for ${description}: ${error.message}`)
	}
}

function parseFrontmatter(relativePath) {
	const content = read(relativePath)
	const match = content.match(/^---\n([\s\S]*?)\n---/)
	if (!match) {
		fail(relativePath, "missing YAML frontmatter")
		return {}
	}

	return Object.fromEntries(
		match[1]
			.split("\n")
			.map((line) => line.match(/^([^:#]+):\s*(.*)$/))
			.filter(Boolean)
			.map(([, key, value]) => [key.trim(), value.trim()]),
	)
}

function requireFrontmatterValue(relativePath, key, expected) {
	const frontmatter = parseFrontmatter(relativePath)
	const actual = frontmatter[key]
	if (actual !== expected) {
		fail(relativePath, `frontmatter ${key} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
	}
}

requireJsonValue("apps/vscode/package.json", (pkg) => pkg.name, "codevibe")
requireJsonValue("apps/vscode/package.json", (pkg) => pkg.publisher, "atnumridha")
requireJsonValue("apps/vscode/package.json", (pkg) => pkg.scripts?.["upstream:base:plan"], "node scripts/prepare-upstream-base-patch.mjs")
requireJsonValue(
	"apps/vscode/package.json",
	(pkg) => pkg.scripts?.["upstream:base:fetch"],
	"node scripts/prepare-upstream-base-patch.mjs --fetch --write-report",
)
requireJsonValue(
	"apps/vscode/package.json",
	(pkg) => pkg.scripts?.["upstream:base:export-patch"],
	"node scripts/prepare-upstream-base-patch.mjs --export-patch --write-report",
)
requireIncludes(".gitignore", [".codevibe/upstream-base/"])
requireJsonArrayItem(
	"apps/vscode/package.json",
	(pkg) => pkg.activationEvents,
	"activation event onChatParticipant:codevibe",
	(event) => event === "onChatParticipant:codevibe",
)
requireJsonArrayItem(
	"apps/vscode/package.json",
	(pkg) => pkg.activationEvents,
	"activation event onChatSession:codevibe-agent",
	(event) => event === "onChatSession:codevibe-agent",
)
requireJsonArrayItem(
	"apps/vscode/package.json",
	(pkg) => pkg.activationEvents,
	"activation event onView:codevibe-agent-chat",
	(event) => event === "onView:codevibe-agent-chat",
)
requireJsonArrayItem(
	"apps/vscode/package.json",
	(pkg) => pkg.contributes?.chatAgents,
	"chat agent codevibe-agent / codie",
	(agent) => agent?.id === "codevibe-agent" && agent?.name === "codie",
)
requireJsonArrayItem(
	"apps/vscode/package.json",
	(pkg) => pkg.contributes?.chatSessions,
	"chat session codevibe-agent",
	(session) => session?.id === "codevibe-agent" && session?.type === "codevibe-agent",
)
requireJsonArrayItem(
	"apps/vscode/package.json",
	(pkg) => pkg.contributes?.chatParticipants,
	"chat participant codevibe",
	(participant) => participant?.id === "codevibe" && participant?.name === "codevibe",
)

requireIncludes("apps/vscode/package.json", [
	"codevibe.",
	"cursor.ndjsonIngest.start",
	"cursor-deeplink.debug.triggerDeeplink",
	"codevibe.compatibility.ndjson.start",
	"codevibe.compatibility.deeplink.debug.trigger",
	"codevibe.compatibility.enabled",
	"codevibe.cursorCompatibility.enabled",
])

requireFrontmatterValue("apps/vscode/agents/00-codevibe-agent.agent.md", "id", "codevibe-agent")
requireFrontmatterValue("apps/vscode/agents/00-codevibe-agent.agent.md", "name", "Codie Agent")

requireIncludes("apps/vscode/proto/cline/common.proto", ["package cline;"])
requireIncludes("apps/vscode/proto/cline/state.proto", ["package cline;"])
requireIncludes("apps/vscode/src/core/controller/ui/openNativeAgentSession.ts", ["@shared/proto/cline/common"])
requireIncludes("apps/vscode/package.json", ["proto/cline/state.proto"])
requireIncludes("docs/upstream-base-patching.md", [
	"CODEVIBE_AJCURSORCLONE_PATH",
	"CODEVIBE_CURSOR_UPSTREAM_PATH",
	"CODEVIBE_COPILOT_UPSTREAM_PATH",
	"--profile ajcursorclone",
	"--profile cursor-local",
	"--profile copilot-local",
	"--profile vibecode",
	"npm --prefix apps/vscode run upstream:base:fetch",
	"npm --prefix apps/vscode run upstream:base:export-patch",
])

requireJsonArrayItem(
	"apps/vscode/src/shared/providers/providers.json",
	(providers) => providers.list,
	"provider value openai-codex",
	(provider) => provider?.value === "openai-codex",
)
requireJsonArrayItem(
	"apps/vscode/src/shared/providers/providers.json",
	(providers) => providers.list,
	"provider value cline",
	(provider) => provider?.value === "cline",
)
requireIncludes("sdk/packages/llms/src/providers/builtins.ts", ['id: "openai-codex"', 'id: "cline"'])

requireIncludes("apps/vscode/src/services/uri/CursorUriRoutes.ts", [
	'"/createchat"',
	'"/mcp/install"',
	'"/background-agent"',
	'"/settings"',
	'"/prompt"',
	'"/command"',
	'"/rule"',
	'"/pr-review"',
	'"/plugin/add"',
	'"/glass"',
	'"/automation/ingest"',
	'"/git/checkout"',
	'"/git/branch"',
	'"/git/commit"',
	'"anysphere.cursor-deeplink"',
	'"anysphere.cursor-mcp"',
	'"atnumridha.codevibe"',
	'"cline.cline"',
	'"codevibe"',
	'protocol === "cursor:"',
	'protocol === "codevibe:"',
	'protocol === "codie:"',
])

requireIncludes("apps/vscode/src/services/uri/SharedUriHandler.ts", [
	'"cursor-compatibility"',
	'"cursor-links"',
	'"deep-links"',
	'"deeplinks"',
	'"retrieval-indexing"',
	'"indexing"',
	'"privacy-gate"',
	'"sandbox"',
	'"sandbox-policy"',
	'"codex-auth"',
	'"openai-codex-auth"',
	'"openai-codex"',
	'"codex"',
	'"browser-evaluate"',
	'"safe-browser-evaluate"',
	"GlobalFileNames.cursorRulesFile",
	"GlobalFileNames.cursorRulesDir",
	"GlobalFileNames.cursorCommandsDir",
])

requireIncludes("apps/vscode/src/core/storage/disk.ts", [
	'cursorCommandsDir: ".cursor/commands"',
	'cursorRulesDir: ".cursor/rules"',
	'cursorRulesFile: ".cursorrules"',
])

requireIncludes("apps/vscode/src/core/ignore/ClineIgnoreController.ts", ['".cursorignore"', '".cursorindexingignore"'])
requireIncludes("apps/vscode/src/services/mcp/McpHub.ts", ['path.join(".cursor", "mcp.json")'])
requireIncludes("apps/vscode/src/core/config/cursor-sandbox.ts", [
	'path.join(".codie", "sandbox.json")',
	'path.join(".cursor", "sandbox.json")',
])
requireIncludes("apps/vscode/src/hosts/vscode/VscodeWebviewProvider.ts", [
	'"**/.codie/sandbox.json"',
	'"**/.cursor/sandbox.json"',
])

if (failures.length > 0) {
	console.error("Compatibility contract check failed:")
	for (const failure of failures) {
		console.error(`- ${failure}`)
	}
	process.exit(1)
}

console.log("Compatibility contract check passed.")
