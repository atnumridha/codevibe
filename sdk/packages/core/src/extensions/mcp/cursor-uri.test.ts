import { describe, expect, it } from "vitest";
import {
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
});
