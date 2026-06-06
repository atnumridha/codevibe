import { expect } from "chai"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, it } from "mocha"
import { installPlugin, parsePluginSource } from "./CursorPluginInstaller"

describe("CursorPluginInstaller", () => {
	const tempDirs: string[] = []

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
	})

	it("parses Cursor plugin id routes as official plugin slugs", () => {
		expect(parsePluginSource("docs-helper")).to.deep.equal({
			type: "official",
			slug: "docs-helper",
		})
	})

	it("installs a local plugin file into the workspace .cline plugin directory", async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), "cline-vscode-plugin-"))
		tempDirs.push(workspaceRoot)
		const pluginPath = join(workspaceRoot, "cursor-plugin.ts")
		await writeFile(
			pluginPath,
			"export default { name: 'cursor-plugin', manifest: { capabilities: ['tools'] } }",
			"utf8",
		)

		const result = await installPlugin({ source: pluginPath, cwd: workspaceRoot })

		expect(result.source).to.equal(pluginPath)
		expect(result.installPath).to.contain(join(workspaceRoot, ".cline", "plugins"))
		expect(result.entryPaths).to.have.length(1)
		expect(await readFile(result.entryPaths[0], "utf8")).to.contain("cursor-plugin")
	})
})
