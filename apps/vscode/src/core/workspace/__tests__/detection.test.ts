import { execFileSync } from "child_process"
import { mkdir, mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import os from "os"
import path from "path"
import { VcsType } from "@shared/multi-root/types"
import { expect } from "chai"
import sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import * as pathUtils from "@/utils/path"
import { detectWorkspaceRoots } from "../detection"

function initGitRepo(dirPath: string) {
	execFileSync("git", ["init"], {
		cwd: dirPath,
		stdio: "ignore",
	})
}

describe("detectWorkspaceRoots", () => {
	const sandbox = sinon.createSandbox()
	let tempRoot = ""
	let homeDir = ""
	let desktopDir = ""
	let documentsDir = ""
	let downloadsDir = ""
	let getWorkspacePaths: sinon.SinonStub

	beforeEach(async () => {
		tempRoot = await mkdtemp(path.join(tmpdir(), "codevibe-workspace-detection-"))
		homeDir = path.join(tempRoot, "home")
		desktopDir = path.join(homeDir, "Desktop")
		documentsDir = path.join(homeDir, "Documents")
		downloadsDir = path.join(homeDir, "Downloads")
		await mkdir(desktopDir, { recursive: true })
		await mkdir(documentsDir, { recursive: true })
		await mkdir(downloadsDir, { recursive: true })

		getWorkspacePaths = sandbox.stub().resolves({ paths: [] })
		sandbox.stub(HostProvider, "workspace").value({
			getWorkspacePaths,
		} as any)
		sandbox.stub(os, "homedir").returns(homeDir)
		sandbox.stub(pathUtils, "getDesktopDir").returns(desktopDir as any)
		sandbox.stub(pathUtils, "getCwd").resolves(desktopDir as any)
	})

	afterEach(async () => {
		sandbox.restore()
		if (tempRoot) {
			await rm(tempRoot, { recursive: true, force: true })
		}
	})

	it("discovers direct child Git repositories when a protected folder is opened", async () => {
		const apiRepo = path.join(desktopDir, "api")
		const webRepo = path.join(desktopDir, "web")
		const notesDir = path.join(desktopDir, "notes")
		await mkdir(apiRepo)
		await mkdir(webRepo)
		await mkdir(notesDir)
		initGitRepo(apiRepo)
		initGitRepo(webRepo)
		getWorkspacePaths.resolves({ paths: [desktopDir] })

		const roots = await detectWorkspaceRoots()

		expect(roots.map((root) => root.path)).to.deep.equal([apiRepo, webRepo])
		expect(roots.map((root) => root.vcs)).to.deep.equal([VcsType.Git, VcsType.Git])
	})

	it("keeps a protected folder when no direct child repositories are found", async () => {
		await mkdir(path.join(documentsDir, "notes"))
		getWorkspacePaths.resolves({ paths: [documentsDir] })

		const roots = await detectWorkspaceRoots()

		expect(roots).to.deep.equal([
			{
				path: documentsDir,
				name: "Documents",
				vcs: VcsType.None,
				commitHash: undefined,
			},
		])
	})

	it("does not scan children when the protected folder is itself a repository", async () => {
		const childRepo = path.join(downloadsDir, "child")
		await mkdir(childRepo)
		initGitRepo(downloadsDir)
		initGitRepo(childRepo)
		getWorkspacePaths.resolves({ paths: [downloadsDir] })

		const roots = await detectWorkspaceRoots()

		expect(roots.map((root) => root.path)).to.deep.equal([downloadsDir])
		expect(roots[0].vcs).to.equal(VcsType.Git)
	})

	it("does not scan children for ordinary workspace folders", async () => {
		const workspace = path.join(tempRoot, "workspace")
		const childRepo = path.join(workspace, "child")
		await mkdir(childRepo, { recursive: true })
		initGitRepo(childRepo)
		getWorkspacePaths.resolves({ paths: [workspace] })

		const roots = await detectWorkspaceRoots()

		expect(roots).to.deep.equal([
			{
				path: workspace,
				name: "workspace",
				vcs: VcsType.None,
				commitHash: undefined,
			},
		])
	})

	it("discovers child repositories when cwd falls back to a protected folder", async () => {
		const projectRepo = path.join(desktopDir, "project")
		await mkdir(projectRepo)
		initGitRepo(projectRepo)
		getWorkspacePaths.resolves({ paths: [] })
		;(pathUtils.getCwd as sinon.SinonStub).resolves(desktopDir)

		const roots = await detectWorkspaceRoots()

		expect(roots.map((root) => root.path)).to.deep.equal([projectRepo])
		expect(roots[0].vcs).to.equal(VcsType.Git)
	})
})
