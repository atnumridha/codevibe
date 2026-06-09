import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { GlobalFileNames } from "@core/storage/disk"
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

function createHub(settingsDir: string, workspaceRoots: string[], cursorSettingsPaths?: string[]): McpHub {
	const hub = Object.create(McpHub.prototype) as McpHub
	;(hub as any).getSettingsDirectoryPath = async () => settingsDir
	;(hub as any).getWorkspaceRootPaths = async () => workspaceRoots
	;(hub as any).getCursorMcpSettingsFilePaths = async () =>
		cursorSettingsPaths ??
		workspaceRoots.map((root) => path.join(root, ".cursor", "mcp.json"))
	;(hub as any).serverSettingsFiles = new Map<string, string>()
	;(hub as any).serverSettingsSources = new Map<string, string>()
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
		nativeSettingsPath = path.join(settingsDir, GlobalFileNames.mcpSettings)
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

	it("merges global Cursor MCP settings after workspace settings", async () => {
		const globalCursorSettingsPath = path.join(tempDir, "home", ".cursor", "mcp.json")
		await writeJson(nativeSettingsPath, {
			mcpServers: {
				alpha: { type: "stdio", command: "native-alpha" },
			},
		})
		await writeJson(cursorSettingsPath, {
			mcpServers: {
				shared: { type: "stdio", command: "workspace-shared" },
				beta: { type: "stdio", command: "workspace-beta" },
			},
		})
		await writeJson(globalCursorSettingsPath, {
			mcpServers: {
				shared: { type: "stdio", command: "global-shared" },
				gamma: { type: "stdio", command: "global-gamma" },
			},
		})

		const hub = createHub(settingsDir, [workspaceRoot], [
			cursorSettingsPath,
			globalCursorSettingsPath,
		])
		const settings = await (hub as any).readAndValidateMcpSettingsFile()

		Object.keys(settings.mcpServers).should.deepEqual(["alpha", "shared", "beta", "gamma"])
		settings.mcpServers.shared.command.should.equal("workspace-shared")
		settings.mcpServers.gamma.command.should.equal("global-gamma")
		;(hub as any).serverSettingsFiles.get("shared").should.equal(cursorSettingsPath)
		;(hub as any).serverSettingsFiles.get("gamma").should.equal(globalCursorSettingsPath)
		;(hub as any).lastServerOrder.should.deepEqual(["alpha", "shared", "beta", "gamma"])
	})

	it("surfaces native, workspace Cursor, and global Cursor MCP settings sources", async () => {
		const globalCursorSettingsPath = path.join(tempDir, "home", ".cursor", "mcp.json")
		await writeJson(nativeSettingsPath, {
			mcpServers: {
				alpha: { type: "stdio", command: "native-alpha" },
			},
		})
		await writeJson(cursorSettingsPath, {
			mcpServers: {
				beta: { type: "stdio", command: "workspace-beta" },
			},
		})
		await writeJson(globalCursorSettingsPath, {
			mcpServers: {
				gamma: { type: "stdio", command: "global-gamma" },
			},
		})

		const hub = createHub(settingsDir, [workspaceRoot], [
			cursorSettingsPath,
			globalCursorSettingsPath,
		])
		await (hub as any).readAndValidateMcpSettingsFile()
		;(hub as any).connections = [makeConnection("alpha"), makeConnection("beta"), makeConnection("gamma")]

		const servers = (hub as any).getSortedMcpServers(["alpha", "beta", "gamma"])

		servers.map((server: { name: string }) => server.name).should.deepEqual(["alpha", "beta", "gamma"])
		servers[0].settingsSource.should.equal("cline")
		servers[0].settingsPath.should.equal(nativeSettingsPath)
		servers[1].settingsSource.should.equal("cursor-workspace")
		servers[1].settingsPath.should.equal(cursorSettingsPath)
		servers[2].settingsSource.should.equal("cursor-global")
		servers[2].settingsPath.should.equal(globalCursorSettingsPath)
	})

	it("expands Cursor workspace variables from .cursor/mcp.json", async () => {
		await writeJson(nativeSettingsPath, {
			mcpServers: {},
		})
		await writeJson(cursorSettingsPath, {
			mcpServers: {
				beta: {
					type: "stdio",
					command: "${workspaceFolder}${/}bin${/}cursor-beta",
					args: [
						"--name",
						"${workspaceFolderBasename}",
						"--sep",
						"${pathSeparator}",
					],
					env: {
						ROOT: "${workspaceFolder}",
					},
				},
			},
		})

		const hub = createHub(settingsDir, [workspaceRoot])
		const settings = await (hub as any).readAndValidateMcpSettingsFile()

		settings.mcpServers.beta.command.should.equal(path.join(workspaceRoot, "bin", "cursor-beta"))
		settings.mcpServers.beta.args.should.deepEqual([
			"--name",
			path.basename(workspaceRoot),
			"--sep",
			path.sep,
		])
		settings.mcpServers.beta.env.should.deepEqual({ ROOT: workspaceRoot })
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

	it("adds full MCP server configs to native settings", async () => {
		await writeJson(nativeSettingsPath, {
			mcpServers: {
				alpha: { type: "stdio", command: "native-alpha" },
			},
		})

		const hub = createHub(settingsDir, [workspaceRoot])
		;(hub as any).connections = [makeConnection("alpha")]
		;(hub as any).reloadMcpServersFromSettings = async () => {
			await (hub as any).readAndValidateMcpSettingsFile()
		}
		await (hub as any).readAndValidateMcpSettingsFile()

		await hub.addServerFromConfig("beta", {
			type: "stdio",
			command: "node",
			args: ["server.js"],
			env: { TOKEN: "secret" },
		} as any)

		const nativeSettings = JSON.parse(await fs.readFile(nativeSettingsPath, "utf-8"))
		nativeSettings.mcpServers.beta.command.should.equal("node")
		nativeSettings.mcpServers.beta.args.should.deepEqual(["server.js"])
		nativeSettings.mcpServers.beta.env.should.deepEqual({ TOKEN: "secret" })
	})
})
