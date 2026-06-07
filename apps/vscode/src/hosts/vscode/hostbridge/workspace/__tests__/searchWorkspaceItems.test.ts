import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import should from "should"
import { searchWorkspaceItems } from "@/hosts/vscode/hostbridge/workspace/searchWorkspaceItems"
import { SearchWorkspaceItemsRequest, SearchWorkspaceItemsRequest_SearchItemType } from "@/shared/proto/host/workspace"

describe("Hostbridge - Workspace - searchWorkspaceItems", () => {
	const tmpDirs: string[] = []
	let originalGetConfiguration: typeof vscode.workspace.getConfiguration

	beforeEach(() => {
		originalGetConfiguration = vscode.workspace.getConfiguration
	})

	afterEach(async () => {
		vscode.workspace.getConfiguration = originalGetConfiguration
		await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
	})

	it("searches from the VS Code host index path and honors Cursor ignore negations", async () => {
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "host-workspace-search-"))
		tmpDirs.push(workspace)
		await fs.mkdir(path.join(workspace, "generated"), { recursive: true })
		await fs.writeFile(path.join(workspace, ".cursorindexingignore"), "generated/\n!generated/keep.ts\n")
		await fs.writeFile(path.join(workspace, "generated", "drop.ts"), "drop\n")
		await fs.writeFile(path.join(workspace, "generated", "keep.ts"), "keep\n")

		const response = await searchWorkspaceItems(
			SearchWorkspaceItemsRequest.create({
				query: "",
				workspacePath: workspace,
				limit: 20,
				selectedType: SearchWorkspaceItemsRequest_SearchItemType.FILE,
			}),
		)

		const paths = response.items.map((item) => item.path)
		paths.should.containEql("generated/keep.ts")
		paths.should.not.containEql("generated/drop.ts")
		should(response.items.every((item) => item.type === SearchWorkspaceItemsRequest_SearchItemType.FILE)).be.true()
	})

	it("keeps Cursor-ignored files filtered when includeIgnored is requested and the privacy gate is enabled", async () => {
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "host-workspace-search-ignored-"))
		tmpDirs.push(workspace)
		await fs.mkdir(path.join(workspace, "private"), { recursive: true })
		await fs.mkdir(path.join(workspace, "src"), { recursive: true })
		await fs.writeFile(path.join(workspace, ".cursorignore"), "private/\n")
		await fs.writeFile(path.join(workspace, "private", "secret.ts"), "secret\n")
		await fs.writeFile(path.join(workspace, "src", "main.ts"), "main\n")

		const response = await searchWorkspaceItems(
			SearchWorkspaceItemsRequest.create({
				query: "",
				workspacePath: workspace,
				limit: 20,
				selectedType: SearchWorkspaceItemsRequest_SearchItemType.FILE,
				includeIgnored: true,
			}),
		)

		const paths = response.items.map((item) => item.path)
		paths.should.not.containEql("private/secret.ts")
		paths.should.containEql("src/main.ts")
	})

	it("can include Cursor-ignored files when the privacy gate is disabled by settings", async () => {
		vscode.workspace.getConfiguration = () =>
			({
				get: (key: string, defaultValue?: unknown) => {
					if (key === "cursorCompatibility.enabled") {
						return true
					}
					if (key === "cursorCompatibility.retrievalIndexing.privacyGate") {
						return false
					}
					return defaultValue
				},
			}) as any

		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "host-workspace-search-ignored-off-"))
		tmpDirs.push(workspace)
		await fs.mkdir(path.join(workspace, "private"), { recursive: true })
		await fs.mkdir(path.join(workspace, "src"), { recursive: true })
		await fs.writeFile(path.join(workspace, ".cursorignore"), "private/\n")
		await fs.writeFile(path.join(workspace, "private", "secret.ts"), "secret\n")
		await fs.writeFile(path.join(workspace, "src", "main.ts"), "main\n")

		const response = await searchWorkspaceItems(
			SearchWorkspaceItemsRequest.create({
				query: "",
				workspacePath: workspace,
				limit: 20,
				selectedType: SearchWorkspaceItemsRequest_SearchItemType.FILE,
				includeIgnored: true,
			}),
		)

		const paths = response.items.map((item) => item.path)
		paths.should.containEql("private/secret.ts")
		paths.should.containEql("src/main.ts")
	})
})
