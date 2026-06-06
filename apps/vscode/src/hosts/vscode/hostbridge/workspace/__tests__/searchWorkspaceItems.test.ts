import * as fs from "fs/promises"
import { afterEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import should from "should"
import { searchWorkspaceItems } from "@/hosts/vscode/hostbridge/workspace/searchWorkspaceItems"
import { SearchWorkspaceItemsRequest, SearchWorkspaceItemsRequest_SearchItemType } from "@/shared/proto/host/workspace"

describe("Hostbridge - Workspace - searchWorkspaceItems", () => {
	const tmpDirs: string[] = []

	afterEach(async () => {
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
})
