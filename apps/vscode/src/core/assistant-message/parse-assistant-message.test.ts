import { expect } from "chai"
import { describe, it } from "mocha"
import { ClineDefaultTool } from "@shared/tools"
import { parseAssistantMessageV2 } from "./parse-assistant-message"

describe("parseAssistantMessageV2", () => {
	it("parses browser_snapshot tool calls and capture options", () => {
		const blocks = parseAssistantMessageV2(`Inspecting the active tab.

<browser_snapshot>
<tab_id>active</tab_id>
<include_screenshot>false</include_screenshot>
<include_logs>0</include_logs>
</browser_snapshot>`)

		expect(blocks).to.have.length(2)
		expect(blocks[0]).to.include({
			type: "text",
			content: "Inspecting the active tab.",
			partial: false,
		})
		expect(blocks[1]).to.include({
			type: "tool_use",
			name: ClineDefaultTool.BROWSER_SNAPSHOT,
			partial: false,
		})
		expect(blocks[1]).to.have.nested.property("params.tab_id", "active")
		expect(blocks[1]).to.have.nested.property("params.include_screenshot", "false")
		expect(blocks[1]).to.have.nested.property("params.include_logs", "0")
	})

	it("keeps an unfinished browser_snapshot call partial", () => {
		const blocks = parseAssistantMessageV2(`<browser_snapshot><include_screenshot>true</include_screenshot>`)

		expect(blocks).to.have.length(1)
		expect(blocks[0]).to.include({
			type: "tool_use",
			name: ClineDefaultTool.BROWSER_SNAPSHOT,
			partial: true,
		})
		expect(blocks[0]).to.have.nested.property("params.include_screenshot", "true")
	})
})
