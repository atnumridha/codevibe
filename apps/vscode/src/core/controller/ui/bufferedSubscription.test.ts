import { expect } from "chai"

const { createBufferedSubscription } = require("./bufferedSubscription") as typeof import("./bufferedSubscription")

describe("createBufferedSubscription", () => {
	it("delivers events sent before the webview subscribes", async () => {
		const subscription = createBufferedSubscription<{ value: string }>({
			logLabel: "test",
			registryType: "test_subscription",
		})
		const delivered: string[] = []

		await subscription.send({ value: "queued" })
		await subscription.subscribe(async (event) => {
			delivered.push(event.value)
		})

		expect(delivered).to.deep.equal(["queued"])
	})

	it("delivers live events to active subscribers", async () => {
		const subscription = createBufferedSubscription<{ value: string }>({
			logLabel: "test",
			registryType: "test_subscription",
		})
		const delivered: string[] = []

		await subscription.subscribe(async (event) => {
			delivered.push(event.value)
		})
		await subscription.send({ value: "live" })

		expect(delivered).to.deep.equal(["live"])
	})
})
