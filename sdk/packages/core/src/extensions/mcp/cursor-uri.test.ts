import { describe, expect, it } from "vitest";
import {
	buildCursorAgentTaskRouteRequest,
	buildCursorRuleRouteRequest,
	buildCursorSettingsRouteRequest,
	buildCursorMcpInstallRequest,
	CursorMcpInstallError,
	CursorUriError,
	formatCursorMcpInstallDetail,
} from "./cursor-uri";

function route(params: Record<string, string>): string {
	return `vscode://cline.cline/mcp/install?${new URLSearchParams(params).toString()}`;
}

function encodeConfig(config: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(config), "utf8")
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

describe("Cursor MCP install URI parser", () => {
	it("builds a direct streamable HTTP server request", () => {
		const request = buildCursorMcpInstallRequest(
			route({ name: "docs", url: "https://mcp.example.com/context" }),
		);

		expect(request).toEqual({
			serverName: "docs",
			source: "direct",
			serverConfig: {
				url: "https://mcp.example.com/context",
				type: "streamableHttp",
				disabled: false,
				autoApprove: [],
			},
		});
	});

	it("derives stdio package installs from package-only deeplinks", () => {
		const request = buildCursorMcpInstallRequest(
			route({ package: "@modelcontextprotocol/server-filesystem" }),
		);

		expect(request.serverName).toBe("modelcontextprotocol-server-filesystem");
		expect(request.serverConfig).toMatchObject({
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-filesystem"],
			type: "stdio",
		});
	});

	it("selects one configured server from base64 config", () => {
		const config = encodeConfig({
			mcpServers: {
				linear: {
					command: "npx",
					args: ["-y", "@modelcontextprotocol/server-linear"],
					env: { LINEAR_API_KEY: "secret-value" },
				},
			},
		});

		const request = buildCursorMcpInstallRequest(route({ config }));
		const detail = formatCursorMcpInstallDetail(request);

		expect(request.serverName).toBe("linear");
		expect(request.serverConfig).toMatchObject({
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-linear"],
		});
		expect(detail).toContain("Environment keys: LINEAR_API_KEY");
		expect(detail).not.toContain("secret-value");
	});

	it("rejects unsafe server names and non-install routes", () => {
		expect(() =>
			buildCursorMcpInstallRequest(
				route({ name: "../bad", url: "https://mcp.example.com" }),
			),
		).toThrow(CursorMcpInstallError);

		expect(() =>
			buildCursorMcpInstallRequest("vscode://cline.cline/createchat?prompt=hi"),
		).toThrow("Expected /mcp/install route");
	});

	it("parses Cursor settings route query aliases", () => {
		expect(
			buildCursorSettingsRouteRequest(
				"vscode://cline.cline/settings?section=codex",
			),
		).toEqual({
			query: "codex",
			sourceParam: "section",
		});
	});

	it("normalizes safe Cursor rule file targets", () => {
		expect(
			buildCursorRuleRouteRequest("vscode://cline.cline/rule?name=team-style"),
		).toEqual({
			kind: "file",
			filename: "team-style.mdc",
			relativePath: ".cursor/rules/team-style.mdc",
		});

		expect(
			buildCursorRuleRouteRequest("vscode://cline.cline/rule?path=.cursorrules"),
		).toEqual({
			kind: "file",
			filename: ".cursorrules",
			relativePath: ".cursorrules",
		});
	});

	it("requires review for Cursor rule payloads and rejects unsafe paths", () => {
		expect(
			buildCursorRuleRouteRequest(
				"vscode://cline.cline/rule?name=team-style&content=Use%20small%20commits",
			),
		).toMatchObject({
			kind: "review",
			name: "team-style",
		});
		expect(
			buildCursorRuleRouteRequest(
				`vscode://cline.cline/rule?config=${encodeConfig({ content: "Use small commits" })}`,
			),
		).toMatchObject({
			kind: "review",
		});

		expect(() =>
			buildCursorRuleRouteRequest("vscode://cline.cline/rule?path=../bad.mdc"),
		).toThrow(CursorUriError);
	});

	it("builds standalone task prompts for prompt-like Cursor routes", () => {
		expect(
			buildCursorAgentTaskRouteRequest(
				"vscode://cline.cline/createchat?prompt=Review%20the%20diff",
			),
		).toMatchObject({
			kind: "createchat",
			path: "/createchat",
			prompt: "Review the diff",
			taskPrompt: "Review the diff",
		});

		const command = buildCursorAgentTaskRouteRequest(
			`vscode://cline.cline/command?command=npm%20install&config=${encodeConfig({ token: "secret" })}`,
		);
		expect(command.taskPrompt).toContain("Review it with the user before running it");
		expect(command.taskPrompt).toContain("```sh\nnpm install\n```");
		expect(command.taskPrompt).not.toContain("secret");
	});

	it("validates standalone task routes before producing prompts", () => {
		expect(() =>
			buildCursorAgentTaskRouteRequest("vscode://cline.cline/pr-review?repo=owner%2Frepo"),
		).toThrow("PR URL or repository plus PR number is required");

		expect(() =>
			buildCursorAgentTaskRouteRequest(
				"vscode://cline.cline/createchat?prompt=hi&extra=value",
			),
		).toThrow('/createchat does not accept query parameter "extra"');

		expect(() =>
			buildCursorAgentTaskRouteRequest("vscode://cline.cline/settings?query=codex"),
		).toThrow("Unsupported Cursor agent task route");
	});

	it("builds guarded prompts for PR review and plugin add routes", () => {
		const prReview = buildCursorAgentTaskRouteRequest(
			"vscode://cline.cline/pr-review?repo=owner%2Frepo&number=42&instructions=focus%20tests",
		);
		expect(prReview).toMatchObject({
			kind: "pr-review",
			path: "/pr-review",
		});
		expect(prReview.taskPrompt).toContain("pull request review");
		expect(prReview.taskPrompt).toContain("repo: owner/repo");
		expect(prReview.taskPrompt).toContain("number: 42");

		const pluginAdd = buildCursorAgentTaskRouteRequest(
			"vscode://cline.cline/plugin/add?id=docs-helper",
		);
		expect(pluginAdd.kind).toBe("plugin-add");
		expect(pluginAdd.taskPrompt).toContain("plugin add");
		expect(pluginAdd.taskPrompt).toContain("ask for confirmation");
	});

	it("allows empty glass routes as agent prompts", () => {
		const glass = buildCursorAgentTaskRouteRequest("vscode://cline.cline/glass");
		expect(glass).toMatchObject({
			kind: "glass",
			path: "/glass",
		});
		expect(glass.taskPrompt).toContain("ask me what to do next");
	});

	it("builds guarded prompts for git helper routes", () => {
		const checkout = buildCursorAgentTaskRouteRequest(
			"vscode://cline.cline/git/checkout?branch=feature%2Fcursor-parity",
		);
		expect(checkout).toMatchObject({
			kind: "git-checkout",
			path: "/git/checkout",
		});
		expect(checkout.taskPrompt).toContain("not permission to run it");
		expect(checkout.taskPrompt).toContain("- branch: feature/cursor-parity");

		const branch = buildCursorAgentTaskRouteRequest(
			"vscode://cline.cline/git/branch?name=feature%2Fsafe&baseBranch=main&checkout=yes",
		);
		expect(branch).toMatchObject({
			kind: "git-branch",
			path: "/git/branch",
		});
		expect(branch.taskPrompt).toContain("not permission to mutate git state");
		expect(branch.taskPrompt).toContain("- base: main");

		const commit = buildCursorAgentTaskRouteRequest(
			"vscode://cline.cline/git/commit?message=fix%3A%20safe%20git%20helpers&staged=true",
		);
		expect(commit).toMatchObject({
			kind: "git-commit",
			path: "/git/commit",
		});
		expect(commit.taskPrompt).toContain("not permission to stage files, commit, or push");
		expect(commit.taskPrompt).toContain("message: fix: safe git helpers");
	});

	it("rejects unsafe git helper route parameters", () => {
		expect(() =>
			buildCursorAgentTaskRouteRequest("vscode://cline.cline/git/checkout?branch=--detach"),
		).toThrow("Checkout branch cannot start with '-'");

		expect(() =>
			buildCursorAgentTaskRouteRequest("vscode://cline.cline/git/branch?name=HEAD"),
		).toThrow("Branch name must be a branch name");

		expect(() =>
			buildCursorAgentTaskRouteRequest("vscode://cline.cline/git/commit?staged=eventually"),
		).toThrow("staged must be one of true, false, 1, 0, yes, or no");
	});
});
