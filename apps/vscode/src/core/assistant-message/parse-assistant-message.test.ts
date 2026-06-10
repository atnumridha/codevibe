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

	it("parses browser_screenshot tool calls and capture options", () => {
		const blocks = parseAssistantMessageV2(`Need pixels only.

<browser_screenshot>
<tab_id>active</tab_id>
<full_page>true</full_page>
</browser_screenshot>`)

		expect(blocks).to.have.length(2)
		expect(blocks[0]).to.include({
			type: "text",
			content: "Need pixels only.",
			partial: false,
		})
		expect(blocks[1]).to.include({
			type: "tool_use",
			name: ClineDefaultTool.BROWSER_SCREENSHOT,
			partial: false,
		})
		expect(blocks[1]).to.have.nested.property("params.tab_id", "active")
		expect(blocks[1]).to.have.nested.property("params.full_page", "true")
	})

	it("parses the eighth subagent prompt", () => {
		const blocks = parseAssistantMessageV2(`<use_subagents>
<prompt_1>map auth flow</prompt_1>
<prompt_8>audit standalone workspace diffs</prompt_8>
<prompt_9>should not parse</prompt_9>
</use_subagents>`)

		expect(blocks).to.have.length(1)
		expect(blocks[0]).to.include({
			type: "tool_use",
			name: ClineDefaultTool.USE_SUBAGENTS,
			partial: false,
		})
		expect(blocks[0]).to.have.nested.property("params.prompt_1", "map auth flow")
		expect(blocks[0]).to.have.nested.property("params.prompt_8", "audit standalone workspace diffs")
		expect(blocks[0]).to.not.have.nested.property("params.prompt_9")
	})
})
