import { expect } from "chai"
import type { HistoryItem } from "@shared/HistoryItem"
import {
	buildCodeVibeChatSessionLabel,
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

describe("native CodeVibe chat sessions", () => {
	it("builds new-session labels from requests", () => {
		expect(buildCodeVibeChatSessionLabel({ prompt: "  fix   native chat history  " })).to.equal("fix native chat history")
		expect(buildCodeVibeChatSessionLabel(undefined)).to.equal("New CodeVibe Session")
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
})
