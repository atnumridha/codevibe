import { expect } from "chai"
import type { HistoryItem } from "@shared/HistoryItem"
import {
	buildCodeVibeChatSessionLabel,
	buildCodeVibeNativeChatSessionHistory,
	buildCodeVibeNativeSessionDescriptor,
	buildCodeVibeNativeSessionDescriptors,
	getCodeVibeNativeSessionTaskIdFromPath,
} from "../native-chat-session"

const historyItem = (overrides: Partial<HistoryItem>): HistoryItem => ({
	id: "task-1",
	ts: 1000,
	task: "Build the thing",
	tokensIn: 10,
	tokensOut: 20,
	totalCost: 0.5,
	...overrides,
})

describe("native Codie chat sessions", () => {
	it("builds new-session labels from requests", () => {
		expect(buildCodeVibeChatSessionLabel({ prompt: "  fix   native chat history  " })).to.equal("fix native chat history")
		expect(buildCodeVibeChatSessionLabel(undefined)).to.equal("New Codie Session")
	})

	it("truncates long request labels for native Chat pickers", () => {
		const label = buildCodeVibeChatSessionLabel({ prompt: "x".repeat(100) })
		expect(label).to.have.length(80)
		expect(label.endsWith("...")).to.be.true
	})

	it("maps a task history item into a native session descriptor", () => {
		const descriptor = buildCodeVibeNativeSessionDescriptor(
			historyItem({
				id: "task/slash",
				cwdOnTaskInitialization: "/repo/from-task",
				modelId: "gpt-5.5-pro",
				isFavorited: true,
			}),
			{ workspacePath: "/repo/fallback" },
		)

		expect(descriptor.resourcePath).to.equal("/task%2Fslash")
		expect(descriptor.metadata).to.include({
			source: "codevibe.taskHistory",
			taskId: "task/slash",
			workingDirectoryPath: "/repo/from-task",
			modelId: "gpt-5.5-pro",
			isFavorited: true,
		})
		expect(descriptor.timing.created).to.equal(1000)
		expect(descriptor.tooltip).to.include("Task ID: task/slash")
	})

	it("sorts valid task history by recency and applies a limit", () => {
		const descriptors = buildCodeVibeNativeSessionDescriptors(
			[
				historyItem({ id: "old", ts: 1, task: "Old task" }),
				historyItem({ id: "invalid-empty-task", ts: 3, task: "   " }),
				historyItem({ id: "new", ts: 4, task: "New task" }),
				historyItem({ id: "middle", ts: 2, task: "Middle task" }),
			],
			{ limit: 2 },
		)

		expect(descriptors.map((item) => item.taskId)).to.deep.equal(["new", "middle"])
	})

	it("decodes task ids from native session resource paths", () => {
		expect(getCodeVibeNativeSessionTaskIdFromPath("/task%2Fslash")).to.equal("task/slash")
		expect(getCodeVibeNativeSessionTaskIdFromPath("/")).to.equal(undefined)
	})

	it("maps persisted Codie UI messages into native Chat transcript turns", () => {
		const history = buildCodeVibeNativeChatSessionHistory(
			[
				{ type: "say", say: "task", text: "Build the feature", ts: 1 },
				{ type: "say", say: "api_req_started", text: "{}", ts: 2 },
				{ type: "say", say: "reasoning", text: "I should inspect files first.", ts: 3 },
				{ type: "say", say: "task_progress", text: "- [x] Inspect files", ts: 4 },
				{
					type: "say",
					say: "tool",
					text: JSON.stringify({ tool: "readFile", path: "src/app.ts", content: "export const value = 1" }),
					ts: 5,
				},
				{ type: "say", say: "completion_result", text: "Done.", ts: 6 },
			],
			{ participantId: "codevibe" },
		)

		expect(history).to.have.length(5)
		expect(history[0]).to.deep.include({
			prompt: "Build the feature",
			participant: "codevibe",
		})
		expect(JSON.stringify(history[1])).to.include("Reasoning")
		expect(JSON.stringify(history[2])).to.include("Progress")
		expect(JSON.stringify(history[3])).to.include("Tool: `readFile`")
		expect(JSON.stringify(history[4])).to.include("Done.")
	})

	it("includes user feedback as native request turns", () => {
		const history = buildCodeVibeNativeChatSessionHistory(
			[{ type: "say", say: "user_feedback", text: "Please keep going", ts: 1 }],
			{ participantId: "codevibe" },
		)

		expect(history[0]).to.deep.include({
			prompt: "User feedback:\n\nPlease keep going",
			participant: "codevibe",
		})
	})

	it("limits transcript turn count and markdown length", () => {
		const history = buildCodeVibeNativeChatSessionHistory(
			[
				{ type: "say", say: "text", text: "older", ts: 1 },
				{ type: "say", say: "tool", text: JSON.stringify({ tool: "readFile", content: "x".repeat(200) }), ts: 2 },
			],
			{ participantId: "codevibe", maxTurns: 1, maxMarkdownLength: 80 },
		)

		expect(history).to.have.length(1)
		expect(JSON.stringify(history[0])).to.include("transcript truncated")
		expect(JSON.stringify(history[0])).not.to.include("older")
	})
})
