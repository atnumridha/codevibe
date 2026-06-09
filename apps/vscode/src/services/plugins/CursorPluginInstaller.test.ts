import { expect } from "chai"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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

	it("installs a local plugin file into the workspace .codevibe plugin directory", async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), "codevibe-vscode-plugin-"))
		tempDirs.push(workspaceRoot)
		const pluginPath = join(workspaceRoot, "cursor-plugin.ts")
		await writeFile(
			pluginPath,
			"export default { name: 'cursor-plugin', manifest: { capabilities: ['tools'] } }",
			"utf8",
		)

		const result = await installPlugin({ source: pluginPath, cwd: workspaceRoot })

		expect(result.source).to.equal(pluginPath)
		expect(result.installPath).to.contain(join(workspaceRoot, ".codevibe", "plugins"))
		expect(result.entryPaths).to.have.length(1)
		expect(await readFile(result.entryPaths[0], "utf8")).to.contain("cursor-plugin")
	})

	it("replaces an existing local plugin only when force is enabled", async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), "codevibe-vscode-plugin-"))
		tempDirs.push(workspaceRoot)
		const pluginPath = join(workspaceRoot, "cursor-plugin.ts")
		await writeFile(pluginPath, "export default { name: 'cursor-plugin-v1' }", "utf8")

		const first = await installPlugin({ source: pluginPath, cwd: workspaceRoot })
		await writeFile(pluginPath, "export default { name: 'cursor-plugin-v2' }", "utf8")

		let blockedError: unknown
		try {
			await installPlugin({ source: pluginPath, cwd: workspaceRoot })
		} catch (error) {
			blockedError = error
		}
		expect(blockedError).to.be.instanceOf(Error)
		expect(String((blockedError as Error).message)).to.contain("Use --force to replace it")

		const replaced = await installPlugin({ source: pluginPath, cwd: workspaceRoot, force: true })
		expect(replaced.installPath).to.equal(first.installPath)
		expect(await readFile(replaced.entryPaths[0], "utf8")).to.contain("cursor-plugin-v2")
	})

	it("writes CodeVibe and legacy plugin wrapper manifests for local packages", async () => {
		const workspaceRoot = await mkdtemp(join(tmpdir(), "codevibe-vscode-plugin-"))
		tempDirs.push(workspaceRoot)
		const pluginDir = join(workspaceRoot, "cursor-plugin-package")
		await mkdir(pluginDir, { recursive: true })
		await writeFile(
			join(pluginDir, "index.ts"),
			"export default { name: 'cursor-plugin-package', manifest: { capabilities: ['tools'] } }",
			"utf8",
		)

		const result = await installPlugin({ source: pluginDir, cwd: workspaceRoot })
		const manifest = JSON.parse(await readFile(join(result.installPath, "package.json"), "utf8"))

		expect(result.installPath).to.contain(join(workspaceRoot, ".codevibe", "plugins"))
		expect(manifest.codevibe.plugins[0].paths).to.deep.equal(["./package/index.ts"])
		expect(manifest.cline.plugins[0].paths).to.deep.equal(["./package/index.ts"])
	})
})
