import { expect, type Page } from "@playwright/test"

export const openTab = async (_page: Page, tabName: string) => {
	await _page
		.getByRole("tab", { name: new RegExp(`${tabName}`) })
		.locator("a")
		.click()
}

export const openWorkspaceFile = async (_page: Page, fileName: string) => {
	const closeModalButton = _page.getByRole("button", { name: /Close Modal Editor/ }).first()
	if (await closeModalButton.isVisible().catch(() => false)) {
		await closeModalButton.click({ delay: 50 })
	}

	const response = await fetch("http://127.0.0.1:9876/open-file", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ fileName }),
	}).catch(() => null)

	if (response?.ok) {
		await expect(_page.getByRole("tab", { name: new RegExp(fileName) })).toBeVisible()
		return
	}

	await _page.keyboard.press("ControlOrMeta+P")
	const quickInput = _page.locator(".quick-input-widget input").first()
	await quickInput.waitFor({ state: "visible" })
	await quickInput.fill(fileName)
	await _page.keyboard.press("Enter")
	await expect(_page.getByRole("tab", { name: new RegExp(fileName) })).toBeVisible()
}

export const addSelectedCodeToClineWebview = async (_page: Page) => {
	// Open Code Actions via keyboard for cross-platform reliability
	await _page.keyboard.press("ControlOrMeta+.")

	// Target the explicit action instead of pressing Enter on the first item.
	// The first item can vary by platform or diagnostics.
	const addToCline = _page.getByText(/Add to CodeVibe/i)
	await addToCline.waitFor({ state: "visible" })
	// For whatever reason, we need to move the mouse to make the context menu item clickable
	await _page.mouse.move(10, 10)
	await _page.mouse.move(20, 10)
	await addToCline.click()
}

export const toggleNotifications = async (_page: Page) => {
	await _page.waitForLoadState("domcontentloaded")
	await _page.keyboard.press("ControlOrMeta+Shift+p")
	const editorSearchBar = _page.getByRole("textbox")
	if (!editorSearchBar.isVisible()) {
		await _page.keyboard.press("ControlOrMeta+Shift+p")
	}
	await editorSearchBar.click({ delay: 100 }) // Ensure focus
	await editorSearchBar.fill("> Toggle Do Not Disturb Mode")
	await _page.keyboard.press("Enter")
	return _page
}
