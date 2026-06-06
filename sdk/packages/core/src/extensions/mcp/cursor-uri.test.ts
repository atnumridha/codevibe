import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildCursorAgentTaskRouteRequest,
	buildCursorPluginAddRouteRequest,
	buildCursorRuleRouteRequest,
	buildCursorSettingsRouteRequest,
	buildCursorMcpInstallRequest,
	CursorMcpInstallError,
	CursorUriError,
	formatCursorMcpInstallDetail,
	resolveCursorCommandFileRouteRequest,
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

	it("normalizes nested Cursor MCP transport aliases from base64 config", () => {
		const config = encodeConfig({
			mcpServers: {
				docs: {
					transport: {
						type: "streamable-http",
						url: "https://mcp.example.com/context",
						headers: {
							Authorization: "Bearer secret-value",
						},
					},
				},
			},
		});

		const request = buildCursorMcpInstallRequest(route({ config }));
		const detail = formatCursorMcpInstallDetail(request);

		expect(request).toMatchObject({
			serverName: "docs",
			source: "config",
			serverConfig: {
				type: "streamableHttp",
				url: "https://mcp.example.com/context",
			},
		});
		expect(detail).toContain("Transport: streamableHttp");
		expect(detail).toContain("URL: https://mcp.example.com/context");
		expect(detail).not.toContain("secret-value");
	});

	it("selects one configured server from Cursor bare config maps", () => {
		const config = encodeConfig({
			postgres: {
				command: "node",
				args: ["postgres-mcp.js"],
				env: { POSTGRES_TOKEN: "secret-value" },
			},
		});

		const request = buildCursorMcpInstallRequest(
			route({ name: "postgres", config }),
		);
		const detail = formatCursorMcpInstallDetail(request);

		expect(request.serverName).toBe("postgres");
		expect(request.source).toBe("config");
		expect(request.serverConfig).toMatchObject({
			command: "node",
			args: ["postgres-mcp.js"],
		});
		expect(detail).toContain("Environment keys: POSTGRES_TOKEN");
		expect(detail).not.toContain("secret-value");
	});

	it("requires a selector for multi-server Cursor bare config maps", () => {
		const config = encodeConfig({
			alpha: { command: "node" },
			beta: { command: "node" },
		});

		expect(() => buildCursorMcpInstallRequest(route({ config }))).toThrow(
			"multiple servers",
		);
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

	it("rejects unknown Cursor MCP install route parameters", () => {
		expect(() =>
			buildCursorMcpInstallRequest(
				route({
					name: "docs",
					url: "https://mcp.example.com/context",
					extra: "ignored-before",
				}),
			),
		).toThrow('/mcp/install does not accept query parameter "extra"');
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

	it("rejects unknown Cursor settings route parameters", () => {
		expect(() =>
			buildCursorSettingsRouteRequest(
				"vscode://cline.cline/settings?section=codex&extra=ignored-before",
			),
		).toThrow('/settings does not accept query parameter "extra"');
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

	it("rejects unknown Cursor rule route parameters", () => {
		expect(() =>
			buildCursorRuleRouteRequest(
				"vscode://cline.cline/rule?name=team-style&extra=ignored-before",
			),
		).toThrow('/rule does not accept query parameter "extra"');
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

	it("resolves standalone Cursor command files when a workspace root is provided", () => {
		const root = mkdtempSync(join(tmpdir(), "cline-cursor-command-"));
		try {
			const commandsDir = join(root, ".cursor", "commands");
			mkdirSync(commandsDir, { recursive: true });
			writeFileSync(
				join(commandsDir, "review-code.md"),
				"Review the staged diff and call out risky changes.",
				"utf8",
			);

			const request = buildCursorAgentTaskRouteRequest(
				"vscode://cline.cline/command?name=review-code",
			);
			const resolved = resolveCursorCommandFileRouteRequest(request, {
				workspaceRoot: root,
			});

			expect(resolved).toMatchObject({
				kind: "command-file",
				commandName: "review-code",
				filename: "review-code.md",
				relativePath: ".cursor/commands/review-code.md",
			});
			expect(resolved?.taskPrompt).toContain(
				"Review the staged diff and call out risky changes.",
			);
			expect(resolved?.taskPrompt).toContain("normal permission boundaries");
			expect(resolved?.taskPrompt).not.toContain("```sh");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("does not resolve unsafe or symlinked standalone Cursor command files", () => {
		const root = mkdtempSync(join(tmpdir(), "cline-cursor-command-"));
		try {
			const commandsDir = join(root, ".cursor", "commands");
			mkdirSync(commandsDir, { recursive: true });
			writeFileSync(join(commandsDir, ".md"), "SHOULD_NOT_LOAD", "utf8");
			writeFileSync(join(root, "outside-command.md"), "SHOULD_NOT_LOAD", "utf8");
			symlinkSync(
				join(root, "outside-command.md"),
				join(commandsDir, "review-code.md"),
			);

			const unsafe = buildCursorAgentTaskRouteRequest(
				"vscode://cline.cline/command?name=..%2Foutside-command",
			);
			expect(
				resolveCursorCommandFileRouteRequest(unsafe, { workspaceRoot: root }),
			).toBeUndefined();

			const dotOnly = buildCursorAgentTaskRouteRequest(
				"vscode://cline.cline/command?name=.",
			);
			expect(
				resolveCursorCommandFileRouteRequest(dotOnly, { workspaceRoot: root }),
			).toBeUndefined();

			const symlinked = buildCursorAgentTaskRouteRequest(
				"vscode://cline.cline/command?name=review-code",
			);
			expect(
				resolveCursorCommandFileRouteRequest(symlinked, { workspaceRoot: root }),
			).toBeUndefined();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
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

	it("builds guarded prompts for PR review routes", () => {
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
	});

	it("builds explicit plugin add route requests", () => {
		const byId = buildCursorPluginAddRouteRequest(
			"vscode://cline.cline/plugin/add?id=docs-helper",
		);
		expect(byId).toMatchObject({
			kind: "plugin-add",
			source: "docs-helper",
			sourceParam: "id",
			requiresReview: false,
		});
		expect(byId.detail).toContain("Plugin source: docs-helper");

		const byUrl = buildCursorPluginAddRouteRequest(
			"vscode://cline.cline/plugin/add?url=https%3A%2F%2Fexample.com%2Fplugin.js",
		);
		expect(byUrl).toMatchObject({
			source: "https://example.com/plugin.js",
			sourceParam: "url",
			requiresReview: false,
		});

		const configOnly = buildCursorPluginAddRouteRequest(
			`vscode://cline.cline/plugin/add?config=${encodeConfig({ token: "secret-value", source: "docs-helper" })}`,
		);
		expect(configOnly).toMatchObject({
			requiresReview: true,
		});
		expect(configOnly.detail).toContain("Config keys: source, token");
		expect(configOnly.detail).not.toContain("secret-value");

		expect(() =>
			buildCursorPluginAddRouteRequest("vscode://cline.cline/plugin/add"),
		).toThrow("plugin identifier or config is required");
		expect(() =>
			buildCursorAgentTaskRouteRequest(
				"vscode://cline.cline/plugin/add?id=docs-helper",
			),
		).toThrow("Unsupported Cursor agent task route");
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
