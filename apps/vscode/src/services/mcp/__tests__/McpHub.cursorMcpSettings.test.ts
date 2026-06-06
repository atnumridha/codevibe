import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { McpHub } from "../McpHub"

type FakeConnection = {
	server: { name: string; config: string; status: string; disabled: boolean }
	client: Record<string, unknown>
	transport: Record<string, unknown>
}

function makeConnection(name: string): FakeConnection {
	return {
		server: {
			name,
			config: JSON.stringify({ type: "stdio", command: name, timeout: 60 }),
			status: "connected",
			disabled: false,
		},
		client: {},
		transport: {},
	}
}

function createHub(settingsDir: string, workspaceRoots: string[]): McpHub {
	const hub = Object.create(McpHub.prototype) as McpHub
	;(hub as any).getSettingsDirectoryPath = async () => settingsDir
	;(hub as any).getWorkspaceRootPaths = async () => workspaceRoots
	;(hub as any).serverSettingsFiles = new Map<string, string>()
	;(hub as any).lastServerOrder = []
	;(hub as any).isUpdatingClineSettings = false
	;(hub as any).connections = []
	return hub
}

describe("McpHub Cursor MCP settings", () => {
	let tempDir: string
	let settingsDir: string
	let workspaceRoot: string
	let nativeSettingsPath: string
	let cursorSettingsPath: string

	const writeJson = async (filePath: string, value: unknown) => {
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, JSON.stringify(value, null, 2))
	}

	beforeEach(async () => {
		tempDir = path.join(os.tmpdir(), `mcp-cursor-settings-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		settingsDir = path.join(tempDir, "settings")
		workspaceRoot = path.join(tempDir, "workspace")
		nativeSettingsPath = path.join(settingsDir, "cline_mcp_settings.json")
		cursorSettingsPath = path.join(workspaceRoot, ".cursor", "mcp.json")
		await fs.mkdir(settingsDir, { recursive: true })
		await fs.mkdir(workspaceRoot, { recursive: true })
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("merges workspace .cursor/mcp.json after native settings with native duplicate names winning", async () => {
		await writeJson(nativeSettingsPath, {
			mcpServers: {
				alpha: { type: "stdio", command: "native-alpha" },
				duplicate: { type: "stdio", command: "native-duplicate" },
			},
		})
		await writeJson(cursorSettingsPath, {
			mcpServers: {
				beta: { type: "stdio", command: "cursor-beta" },
				duplicate: { type: "stdio", command: "cursor-duplicate" },
			},
		})

		const hub = createHub(settingsDir, [workspaceRoot])
		const settings = await (hub as any).readAndValidateMcpSettingsFile()

		Object.keys(settings.mcpServers).should.deepEqual(["alpha", "duplicate", "beta"])
		settings.mcpServers.duplicate.command.should.equal("native-duplicate")
		settings.mcpServers.beta.command.should.equal("cursor-beta")
		;(hub as any).serverSettingsFiles.get("alpha").should.equal(nativeSettingsPath)
		;(hub as any).serverSettingsFiles.get("beta").should.equal(cursorSettingsPath)
		;(hub as any).lastServerOrder.should.deepEqual(["alpha", "duplicate", "beta"])
	})

	it("writes Cursor-imported server disabled state back to .cursor/mcp.json", async () => {
		await writeJson(nativeSettingsPath, {
			mcpServers: {
				alpha: { type: "stdio", command: "native-alpha" },
			},
		})
		await writeJson(cursorSettingsPath, {
			mcpServers: {
				beta: { type: "stdio", command: "cursor-beta", disabled: false },
			},
		})

		const hub = createHub(settingsDir, [workspaceRoot])
		;(hub as any).connections = [makeConnection("alpha"), makeConnection("beta")]
		await (hub as any).readAndValidateMcpSettingsFile()

		await hub.toggleServerDisabledRPC("beta", true)

		const nativeSettings = JSON.parse(await fs.readFile(nativeSettingsPath, "utf-8"))
		const cursorSettings = JSON.parse(await fs.readFile(cursorSettingsPath, "utf-8"))
		;(nativeSettings.mcpServers.beta === undefined).should.be.true()
		cursorSettings.mcpServers.beta.disabled.should.equal(true)
	})

	it("writes Cursor-imported auto approve updates back to .cursor/mcp.json", async () => {
		await writeJson(nativeSettingsPath, {
			mcpServers: {
				alpha: { type: "stdio", command: "native-alpha" },
			},
		})
		await writeJson(cursorSettingsPath, {
			mcpServers: {
				beta: { type: "stdio", command: "cursor-beta", autoApprove: [] },
			},
		})

		const hub = createHub(settingsDir, [workspaceRoot])
		;(hub as any).connections = [makeConnection("alpha"), makeConnection("beta")]
		await (hub as any).readAndValidateMcpSettingsFile()

		await hub.toggleToolAutoApproveRPC("beta", ["search"], true)

		const nativeSettings = JSON.parse(await fs.readFile(nativeSettingsPath, "utf-8"))
		const cursorSettings = JSON.parse(await fs.readFile(cursorSettingsPath, "utf-8"))
		;(nativeSettings.mcpServers.beta === undefined).should.be.true()
		cursorSettings.mcpServers.beta.autoApprove.should.deepEqual(["search"])
	})
})
