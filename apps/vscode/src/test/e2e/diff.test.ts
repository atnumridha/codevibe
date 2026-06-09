import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect } from "@playwright/test"
import { E2E_WORKSPACE_TYPES, e2e } from "./utils/helpers"

e2e.describe("Auto-Applied File Edit", () => {
	E2E_WORKSPACE_TYPES.forEach(({ title, workspaceType }) => {
		e2e.extend({
			workspaceType,
		})(title, async ({ helper, page, sidebar, workspaceDir }) => {
			const testFilePath = path.join(workspaceDir, "test.ts")
			await writeFile(testFilePath, 'export const name = "john"\n', "utf8")

			sidebar = await helper.signin(sidebar, page)
			sidebar = await helper.ensureActMode(page, sidebar)

			// Submit a file edit request
			await helper.submitChatMessage(page, sidebar, "edit_request")

			await expect
				.poll(async () => readFile(testFilePath, "utf8"), {
					timeout: 30_000,
				})
				.toContain('export const name = "cline"')
		})
	})
})
