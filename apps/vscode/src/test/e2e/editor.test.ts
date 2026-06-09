import { expect } from "@playwright/test"
import { addSelectedCodeToClineWebview, openWorkspaceFile } from "./utils/common"
import { E2E_WORKSPACE_TYPES, e2e } from "./utils/helpers"

e2e.describe("Code Actions and Editor Panel", () => {
	E2E_WORKSPACE_TYPES.forEach(({ title, workspaceType }) => {
		e2e.extend({
			workspaceType,
		})(title, async ({ helper, page, sidebar }) => {
			sidebar = await helper.signin(sidebar, page)

			// Open a fixture file and select code from the editor.
			await openWorkspaceFile(page, "index.html")

			// CodeVibe should be opened and visible after adding code to CodeVibe.
			await addSelectedCodeToClineWebview(page)
			helper.clearCachedFrame()
			const updatedSidebar = await helper.getReadySidebar(page)
			const updatedSidebarInput = await helper.getChatInput(updatedSidebar)
			await expect(updatedSidebarInput).toBeVisible()
			await expect(updatedSidebarInput).toBeFocused()
		})
	})
})
