import { expect } from "@playwright/test"
import { addSelectedCodeToClineWebview, openWorkspaceFile, toggleNotifications } from "./utils/common"
import { E2E_WORKSPACE_TYPES, e2e } from "./utils/helpers"

e2e.describe("Code Actions and Editor Panel", () => {
	E2E_WORKSPACE_TYPES.forEach(({ title, workspaceType }) => {
		e2e.extend({
			workspaceType,
		})(title, async ({ helper, page, sidebar }) => {
			sidebar = await helper.signin(sidebar, page)
			// Sidebar - input should start empty
			const sidebarInput = sidebar.getByTestId("chat-input")
			await sidebarInput.click()
			await toggleNotifications(page)
			await expect(sidebarInput).toBeEmpty()

			// Open a fixture file and select code from the editor.
			await openWorkspaceFile(page, "index.html")

			// CodeVibe should be opened and visible after adding code to CodeVibe.
			await addSelectedCodeToClineWebview(page)
			helper.clearCachedFrame()
			const updatedSidebar = await helper.getSidebar(page)
			const updatedSidebarInput = updatedSidebar.getByTestId("chat-input")
			await expect(updatedSidebarInput).toBeVisible()
			await expect(updatedSidebarInput).toBeFocused()
		})
	})
})
