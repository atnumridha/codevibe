import type { AgentToolContext } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebFetchExecutor } from "./web-fetch";

const ctx: AgentToolContext = {
	agentId: "agent-1",
	conversationId: "conv-1",
	iteration: 1,
};

describe("createWebFetchExecutor", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("blocks network fetches denied by Cursor sandbox policy", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const webFetch = createWebFetchExecutor();

		await expect(
			webFetch("https://blocked.example.com/docs", "summarize", {
				...ctx,
				metadata: {
					cursorSandboxPolicy: {
						source: "cursor-sandbox",
						readablePaths: [],
						writablePaths: [],
						networkPolicy: { default: "deny", allow: ["api.example.com"] },
					},
				},
			}),
		).rejects.toThrow(
			"Network access to blocked.example.com is blocked by .cursor/sandbox.json networkPolicy",
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
