import { expect } from "chai"
import {
	buildCodeVibeNativeChatEmptyPromptMarkdown,
	buildCodeVibeNativeChatFallbackMarkdown,
	buildCodeVibeNativeChatStartedMarkdown,
	buildCodeVibeNativeChatTaskText,
} from "../native-chat-adapter"

describe("native Codie chat adapter", () => {
	it("passes a normal prompt through unchanged after trimming", () => {
		expect(buildCodeVibeNativeChatTaskText({ prompt: "  update the tests  " })).to.equal("update the tests")
	})

	it("rewrites plan commands into Plan-first task text", () => {
		expect(buildCodeVibeNativeChatTaskText({ command: "plan", prompt: "add browser automation" })).to.equal(
			"Plan this task first before editing.\n\nadd browser automation",
		)
	})

	it("rewrites review commands into review-oriented task text", () => {
		expect(buildCodeVibeNativeChatTaskText({ command: "review", prompt: "check this branch" })).to.equal(
			"Review this request and prioritize bugs, risks, regressions, and missing tests.\n\ncheck this branch",
		)
	})

	it("builds started task markdown with the task id", () => {
		const markdown = buildCodeVibeNativeChatStartedMarkdown("task-123")
		expect(markdown).to.include("`task-123`")
		expect(markdown).to.include("real planner")
	})

	it("builds empty prompt guidance for native Chat", () => {
		expect(buildCodeVibeNativeChatEmptyPromptMarkdown()).to.include("native Chat route starts")
	})

	it("builds fallback markdown without dropping the startup detail", () => {
		const markdown = buildCodeVibeNativeChatFallbackMarkdown("Task locked", true)
		expect(markdown).to.include("prompt was moved")
		expect(markdown).to.include("Task locked")
	})
})
