import type { AgentToolContext } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebSearchExecutor } from "./web-search";

const ctx: AgentToolContext = {
	agentId: "agent-1",
	conversationId: "conv-1",
	iteration: 1,
};

describe("createWebSearchExecutor", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("blocks search requests denied by Cursor sandbox policy", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const webSearch = createWebSearchExecutor({
			searchEndpoint: "https://search.example.com/html/",
		});

		await expect(
			webSearch("codie docs", 5, {
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
			"Network access to search.example.com is blocked by .cursor/sandbox.json networkPolicy",
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("formats HTML search results", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				return new Response(
					`
					<div class="result">
						<h2><a class="result__a" href="https://example.com/docs">Codie Docs</a></h2>
						<a class="result__snippet">Use Codie with browser and web search tools.</a>
					</div></div>
					`,
					{ status: 200, headers: { "content-type": "text/html" } },
				);
			}),
		);

		const webSearch = createWebSearchExecutor({
			searchEndpoint: "https://search.example.com/html/",
		});
		const result = await webSearch("codie docs", 5, ctx);

		expect(result).toContain("Search query: codie docs");
		expect(result).toContain("1. Codie Docs");
		expect(result).toContain("URL: https://example.com/docs");
		expect(result).toContain("Snippet: Use Codie with browser and web search tools.");
	});
});
