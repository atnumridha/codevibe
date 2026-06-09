import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("Chat - can send messages and switch between modes", async ({ helper, page, sidebar }) => {
	// Sign in
	sidebar = await helper.signin(sidebar, page)
	let inputbox = sidebar.getByTestId("chat-input")

	// Makes sure the act and plan switches are working correctly
	let modeSwitch = sidebar.getByTestId("mode-switch")
	let activeMode = modeSwitch.locator("[aria-current='true']")

	// Act button should be active by default.
	await expect(activeMode).toHaveText("Act")

	await modeSwitch.click()
	sidebar = await helper.getReadySidebar(page)
	inputbox = sidebar.getByTestId("chat-input")
	modeSwitch = sidebar.getByTestId("mode-switch")
	activeMode = modeSwitch.locator("[aria-current='true']")
	await expect(activeMode).toHaveText("Plan", { timeout: 5_000 })

	await modeSwitch.click()
	sidebar = await helper.getReadySidebar(page)
	inputbox = sidebar.getByTestId("chat-input")
	modeSwitch = sidebar.getByTestId("mode-switch")
	activeMode = modeSwitch.locator("[aria-current='true']")
	await expect(activeMode).toHaveText("Act", { timeout: 5_000 })

	// Submit a message
	await expect(inputbox).toBeVisible()
	await inputbox.fill("Hello, CodeVibe!")
	await expect(inputbox).toHaveValue("Hello, CodeVibe!")
	const sendButton = sidebar.getByTestId("send-button")
	await expect(sendButton).toBeEnabled({ timeout: 5_000 })
	await inputbox.press("Enter")
	await expect(inputbox).toHaveValue("", { timeout: 10_000 })
})
