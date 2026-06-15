import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("Chat - opens input and exposes Act mode", async ({ helper, page, sidebar }) => {
	// Sign in
	sidebar = await helper.signin(sidebar, page)
	sidebar = await helper.ensureActMode(page, sidebar)

	// Makes sure the mode switch is visible and the chat can be driven in Act mode.
	const modeSwitch = await helper.getModeSwitch(sidebar)
	const activeMode = await helper.getActiveMode(modeSwitch)
	await expect(activeMode).toHaveText("Act", { timeout: 5_000 })

	// Enter a message. The edit e2e covers actual agent submission and tool execution.
	sidebar = await helper.enterChatMessage(page, sidebar, "Hello, CodeVibe!")
	const inputbox = await helper.getChatInput(sidebar)
	await expect(inputbox).toBeVisible()
	await expect(inputbox).toHaveValue("Hello, CodeVibe!", { timeout: 5_000 })
})
