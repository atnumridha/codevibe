import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("Views - can seed auth and navigate to Chat", async ({ helper, page, sidebar }) => {
	// Use the page object to interact with editor outside the sidebar
	// Verify initial state
	await expect(sidebar.getByRole("button", { name: "Login to CodeVibe" })).toBeVisible()
	await expect(sidebar.getByText("Bring my own API key")).toBeVisible()

	sidebar = await helper.signin(sidebar, page)
	const chatInputBox = await helper.getChatInput(sidebar)
	await expect(chatInputBox).toBeVisible()
})
