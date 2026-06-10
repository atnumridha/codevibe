import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { expect } from "@playwright/test"
import { e2e, E2ETestHelper } from "./utils/helpers"

const installedE2e = e2e.extend({
	extensionInstallMode: "installed" as const,
})

interface InstalledExtensionManifest {
	name?: string
	publisher?: string
	version?: string
	contributes?: {
		commands?: Array<{ command?: string; title?: string }>
		chatParticipants?: Array<{ id?: string; name?: string }>
		chatSessions?: Array<{ id?: string; type?: string; displayName?: string }>
		menus?: Record<string, Array<{ command?: string }>>
	}
}

function readJsonFile(filePath: string): InstalledExtensionManifest {
	return JSON.parse(readFileSync(filePath, "utf8")) as InstalledExtensionManifest
}

function findInstalledCodeVibeExtension(extensionsDir: string) {
	const extensionFolder = readdirSync(extensionsDir).find((entry) => entry.startsWith("atnumridha.codevibe-"))
	if (!extensionFolder) {
		return undefined
	}

	const extensionPath = path.join(extensionsDir, extensionFolder)
	return {
		extensionPath,
		manifest: readJsonFile(path.join(extensionPath, "package.json")),
	}
}

installedE2e("Installed VSIX native chat exposes CodeVibe agent commands", async ({ page, extensionsDir }) => {
	const sourceManifest = readJsonFile(path.join(E2ETestHelper.CODEBASE_ROOT_DIR, "package.json"))

	await expect
		.poll(() => findInstalledCodeVibeExtension(extensionsDir)?.manifest.version, {
			message: "CodeVibe VSIX should install into the isolated extensions dir",
			timeout: 60_000,
		})
		.toBe(sourceManifest.version)

	const installed = findInstalledCodeVibeExtension(extensionsDir)
	expect(installed).toBeDefined()
	const installedRelativePath = path.relative(extensionsDir, installed?.extensionPath ?? "")
	expect(installedRelativePath.startsWith("..")).toBe(false)
	expect(path.isAbsolute(installedRelativePath)).toBe(false)

	const manifest = installed?.manifest
	expect(manifest?.name).toBe("codevibe")
	expect(manifest?.publisher).toBe("atnumridha")
	expect(manifest?.contributes?.chatParticipants?.map((participant) => participant.id)).toEqual(["codevibe"])
	expect(manifest?.contributes?.chatSessions?.map((session) => session.type)).toEqual(["codevibe-agent"])
	expect(manifest?.contributes?.menus?.["chatSessions/newSession"]?.[0]?.command).toBe("codevibe.newNativeAgentSession")
	expect(manifest?.contributes?.commands?.some((command) => command.command === "codevibe.newNativeAgentSession")).toBe(true)
	expect(manifest?.contributes?.commands?.some((command) => command.command === "codevibe.nativeAgentDiagnostics")).toBe(true)

	const serializedContributions = JSON.stringify(manifest?.contributes ?? {})
	expect(serializedContributions).not.toContain("agent-host-codevibe")
	expect(serializedContributions).not.toContain("codevibe.agentPanel")
	expect(serializedContributions).not.toContain("codevibe.SidebarProvider")
	expect(serializedContributions).not.toContain("claude-dev.SidebarProvider")

	await E2ETestHelper.expectCommandPaletteItem(page, ">CodeVibe: New CodeVibe Agent", "New CodeVibe Agent")
	await E2ETestHelper.expectCommandPaletteItem(
		page,
		">CodeVibe: Show Native Agent Diagnostics",
		"Show Native Agent Diagnostics",
	)
	await E2ETestHelper.expectCommandPaletteNoItem(page, ">agent-host-codevibe", "agent-host-codevibe")
})
