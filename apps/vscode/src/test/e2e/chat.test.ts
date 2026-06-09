import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("Chat - opens input and exposes Act mode", async ({ helper, page, sidebar }) => {
	// Sign in
	sidebar = await helper.signin(sidebar, page)
	sidebar = await helper.ensureActMode(page, sidebar)
	const inputbox = await helper.getChatInput(sidebar)

	// Makes sure the mode switch is visible and the chat can be driven in Act mode.
	const modeSwitch = await helper.getModeSwitch(sidebar)
	let activeMode = modeSwitch.locator("[aria-current='true']")
	await expect(activeMode).toHaveText("Act", { timeout: 5_000 })

	// Enter a message. The edit e2e covers actual agent submission and tool execution.
	await expect(inputbox).toBeVisible()
	await inputbox.evaluate((element, value) => {
		const textarea = element as HTMLTextAreaElement
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set
		setter?.call(textarea, value)
		textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }))
		textarea.dispatchEvent(new Event("change", { bubbles: true }))
	}, "Hello, CodeVibe!")
	await expect(inputbox).toHaveValue("Hello, CodeVibe!", { timeout: 5_000 })
})
