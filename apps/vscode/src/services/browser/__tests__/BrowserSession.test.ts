import { expect } from "chai"
import { BrowserSession } from "../BrowserSession"

type Listener = (...args: any[]) => void

class FakePage {
	private listeners = new Map<string, Set<Listener>>()

	on(event: string, listener: Listener) {
		const listeners = this.listeners.get(event) ?? new Set<Listener>()
		listeners.add(listener)
		this.listeners.set(event, listeners)
		return this
	}

	off(event: string, listener: Listener) {
		this.listeners.get(event)?.delete(listener)
		return this
	}

	emit(event: string, ...args: any[]) {
		for (const listener of this.listeners.get(event) ?? []) {
			listener(...args)
		}
	}

	listenerCount(event: string): number {
		return this.listeners.get(event)?.size ?? 0
	}

	url(): string {
		return "https://example.com"
	}
}

describe("BrowserSession", () => {
	it("captures and detaches Puppeteer console logs during actions", async () => {
		const session = new BrowserSession({} as any)
		const page = new FakePage()
		;(session as any).page = page

		const result = await session.doAction(
			async (activePage: any) => {
				activePage.emit("console", {
					type: () => "error",
					text: () => "Something happened",
				})
			},
			{ includeScreenshot: false },
		)

		expect(result.logs).to.equal("[error] Something happened")
		expect(page.listenerCount("console")).to.equal(0)
		expect(page.listenerCount("pageerror")).to.equal(0)
	})
})
