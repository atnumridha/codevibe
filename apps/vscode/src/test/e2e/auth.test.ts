import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("Views - can seed auth and navigate to Chat", async ({ helper, page, sidebar }) => {
	// Use the page object to interact with editor outside the sidebar
	// Verify initial state. Some E2E runs start with seeded Codie auth already applied.
	const codieButton = sidebar.getByRole("button", { name: "Sign in to Codie" })
	const startsInOnboarding = await codieButton.isVisible().catch(() => false)

	if (startsInOnboarding) {
		await expect(codieButton).toBeVisible()
		await expect(sidebar.getByText("Bring my own API key")).toBeVisible()
		sidebar = await helper.signin(sidebar, page)
	}

	const chatInputBox = await helper.getChatInput(sidebar)
	await expect(chatInputBox).toBeVisible()
})
