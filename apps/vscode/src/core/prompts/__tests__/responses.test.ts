import { expect } from "chai"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterEach, describe, it } from "mocha"
import "@/utils/path"
import { ClineIgnoreController, LOCK_TEXT_SYMBOL } from "../../ignore/ClineIgnoreController"
import { formatResponse } from "../responses"

describe("formatResponse.formatFilesList", () => {
	let tempDir: string | undefined

	afterEach(async () => {
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true })
			tempDir = undefined
		}
	})

	async function createCursorIgnoreController() {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-format-files-"))
		await fs.mkdir(path.join(tempDir, "private"), { recursive: true })
		await fs.mkdir(path.join(tempDir, "src"), { recursive: true })
		await fs.writeFile(path.join(tempDir, ".cursorindexingignore"), "private/\n*.snapshot\n!private/keep.snapshot\n")
		await fs.writeFile(path.join(tempDir, "private", "secret.txt"), "secret")
		await fs.writeFile(path.join(tempDir, "private", "keep.snapshot"), "keep")
		await fs.writeFile(path.join(tempDir, "src", "index.ts"), "export {}")

		const controller = new ClineIgnoreController(tempDir)
		await controller.initialize()
		return controller
	}

	it("marks ignored files by default", async () => {
		const controller = await createCursorIgnoreController()
		const files = [
			path.join(tempDir!, "private", "secret.txt"),
			path.join(tempDir!, "private", "keep.snapshot"),
			path.join(tempDir!, "src", "index.ts"),
		]

		const result = formatResponse.formatFilesList(tempDir!, files, false, controller)

		expect(result).to.contain(`${LOCK_TEXT_SYMBOL} private/secret.txt`)
		expect(result).to.contain("private/keep.snapshot")
		expect(result).to.contain("src/index.ts")
	})

	it("omits ignored files for Cursor retrieval privacy", async () => {
		const controller = await createCursorIgnoreController()
		const files = [
			path.join(tempDir!, "private", "secret.txt"),
			path.join(tempDir!, "private", "keep.snapshot"),
			path.join(tempDir!, "src", "index.ts"),
		]

		const result = formatResponse.formatFilesList(tempDir!, files, false, controller, {
			ignoredFilesBehavior: "omit",
		})

		expect(result).not.to.contain("private/secret.txt")
		expect(result).not.to.contain(LOCK_TEXT_SYMBOL)
		expect(result).to.contain("private/keep.snapshot")
		expect(result).to.contain("src/index.ts")
	})
})
