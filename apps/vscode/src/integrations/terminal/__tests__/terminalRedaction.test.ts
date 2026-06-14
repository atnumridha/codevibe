import assert from "node:assert/strict"
import { describe, it } from "mocha"
import { redactCommandForLogging } from "../terminalRedaction"

describe("terminal command log redaction", () => {
	it("redacts sensitive env assignments without changing non-sensitive values", () => {
		const redacted = redactCommandForLogging(
			`OPENAI_API_KEY=sk-live-secret PATH=/usr/bin CODEVIBE_ACCESS_TOKEN='access-secret' npm test`,
		)

		assert.equal(redacted.includes("sk-live-secret"), false)
		assert.equal(redacted.includes("access-secret"), false)
		assert.match(redacted, /OPENAI_API_KEY=<redacted>/)
		assert.match(redacted, /CODEVIBE_ACCESS_TOKEN='<redacted>'/)
		assert.match(redacted, /PATH=\/usr\/bin/)
	})

	it("redacts sensitive long flag values", () => {
		const redacted = redactCommandForLogging(
			`curl --api-key abc123 --password='hunter2' --authorization BearerValue --port 3000`,
		)

		assert.equal(redacted.includes("abc123"), false)
		assert.equal(redacted.includes("hunter2"), false)
		assert.equal(redacted.includes("BearerValue"), false)
		assert.match(redacted, /--api-key <redacted>/)
		assert.match(redacted, /--password='<redacted>'/)
		assert.match(redacted, /--authorization <redacted>/)
		assert.match(redacted, /--port 3000/)
	})

	it("redacts auth headers and bearer tokens", () => {
		const redacted = redactCommandForLogging(`curl -H "Authorization: Bearer abc.def.ghi" -H 'X-Trace: keep'`)

		assert.equal(redacted.includes("abc.def.ghi"), false)
		assert.match(redacted, /Authorization: Bearer <redacted>/)
		assert.match(redacted, /X-Trace: keep/)
	})

	it("redacts JSON-ish token fields", () => {
		const redacted = redactCommandForLogging(`curl -d '{"refresh_token":"rt-secret","ok":"keep"}'`)

		assert.equal(redacted.includes("rt-secret"), false)
		assert.match(redacted, /"refresh_token":"<redacted>"/)
		assert.match(redacted, /"ok":"keep"/)
	})

	it("redacts URL credentials and common token-looking strings", () => {
		const redacted = redactCommandForLogging(
			`git clone https://user:pass@example.com/repo && echo ghp_abcdefghijklmnopqrstuvwxyz`,
		)

		assert.equal(redacted.includes(":pass@"), false)
		assert.equal(redacted.includes("ghp_abcdefghijklmnopqrstuvwxyz"), false)
		assert.match(redacted, /https:\/\/user:<redacted>@example\.com/)
	})
})
