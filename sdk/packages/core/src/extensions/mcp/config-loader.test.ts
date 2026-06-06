import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	hasMcpSettingsFile,
	listMcpServerOAuthStatuses,
	loadMcpSettingsFile,
	registerMcpServersFromSettingsFile,
	resolveCursorMcpSettingsPath,
	resolveMcpServerRegistrationSources,
	resolveMcpServerRegistrations,
	resolveMcpSettingsPaths,
	setMcpServerDisabled,
	updateMcpServerOAuthState,
} from "./config-loader";

describe("mcp config loader", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots.map((directory) =>
				rm(directory, { recursive: true, force: true }),
			),
		);
		tempRoots.length = 0;
	});

	it("loads and validates mcp server registrations from JSON", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {
						docs: {
							transport: {
								type: "stdio",
								command: "npx",
								args: ["-y", "@modelcontextprotocol/server-filesystem"],
							},
						},
						search: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.example.com",
							},
							disabled: true,
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		expect(hasMcpSettingsFile({ filePath })).toBe(true);
		expect(
			loadMcpSettingsFile({ filePath }).mcpServers.docs.transport.type,
		).toBe("stdio");

		const registrations = resolveMcpServerRegistrations({ filePath });
		expect(registrations).toEqual([
			{
				name: "docs",
				transport: {
					type: "stdio",
					command: "npx",
					args: ["-y", "@modelcontextprotocol/server-filesystem"],
				},
				disabled: undefined,
				metadata: undefined,
				oauth: undefined,
			},
			{
				name: "search",
				transport: {
					type: "streamableHttp",
					url: "https://mcp.example.com",
				},
				disabled: true,
				metadata: undefined,
				oauth: undefined,
			},
		]);
	});

	it("registers loaded servers with an mcp manager", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {
						docs: {
							transport: {
								type: "stdio",
								command: "node",
							},
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const registered: Array<{ name: string }> = [];
		const manager = {
			registerServer: async (registration: { name: string }) => {
				registered.push(registration);
			},
		};

		await registerMcpServersFromSettingsFile(manager, { filePath });
		expect(registered).toEqual([
			{
				name: "docs",
				transport: {
					type: "stdio",
					command: "node",
				},
				disabled: undefined,
				metadata: undefined,
				oauth: undefined,
			},
		]);
	});

	it("resolves Cursor workspace MCP settings paths", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const cursorPath = resolveCursorMcpSettingsPath(tempRoot);

		expect(cursorPath).toBe(join(tempRoot, ".cursor", "mcp.json"));
		expect(
			resolveMcpSettingsPaths({
				filePaths: [cursorPath, cursorPath, "  "],
				workspaceRoot: tempRoot,
			}),
		).toEqual([cursorPath]);
	});

	it("merges native and Cursor MCP settings while preserving first-file precedence", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const nativePath = join(tempRoot, "cline_mcp_settings.json");
		const cursorPath = resolveCursorMcpSettingsPath(tempRoot);
		await mkdir(join(tempRoot, ".cursor"), { recursive: true });
		await writeFile(
			nativePath,
			JSON.stringify(
				{
					mcpServers: {
						docs: {
							transport: {
								type: "stdio",
								command: "node",
								args: ["native-server.js"],
							},
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);
		await writeFile(
			cursorPath,
			JSON.stringify(
				{
					mcpServers: {
						docs: {
							transport: {
								type: "stdio",
								command: "node",
								args: ["cursor-server.js"],
							},
						},
						browser: {
							url: "https://mcp.example.com",
							transportType: "http",
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const sources = resolveMcpServerRegistrationSources({
			filePaths: [nativePath, cursorPath],
		});

		expect(sources).toEqual([
			{
				filePath: nativePath,
				registrations: [
					{
						name: "docs",
						transport: {
							type: "stdio",
							command: "node",
							args: ["native-server.js"],
						},
						disabled: undefined,
						metadata: undefined,
						oauth: undefined,
					},
				],
			},
			{
				filePath: cursorPath,
				registrations: [
					{
						name: "browser",
						transport: {
							type: "streamableHttp",
							url: "https://mcp.example.com",
						},
						disabled: undefined,
						metadata: undefined,
						oauth: undefined,
					},
				],
			},
		]);
	});

	it("normalizes Cursor MCP aliases and variables", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const cursorPath = resolveCursorMcpSettingsPath(tempRoot);
		const homeRoot = join(tempRoot, "home");
		await mkdir(join(tempRoot, ".cursor"), { recursive: true });
		await writeFile(
			cursorPath,
			JSON.stringify(
				{
					mcpServers: {
						remote: {
							transport: {
								type: "streamable-http",
								url: "https://${env:MCP_HOST}/${workspaceFolderBasename}",
								headers: {
									Authorization: "Bearer ${env:MCP_TOKEN}",
								},
							},
						},
						local: {
							type: "stdio",
							command: "${userHome}${/}bin${/}server",
							args: [
								"--cwd",
								"${workspaceFolder}",
								"--sep",
								"${pathSeparator}",
							],
							env: {
								ROOT: "${workspaceFolder}",
							},
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const registrations = resolveMcpServerRegistrations({
			filePath: cursorPath,
			env: {
				MCP_HOST: "mcp.example.com",
				MCP_TOKEN: "secret-token",
			},
			userHome: homeRoot,
			workspaceRoot: tempRoot,
		});

		expect(registrations).toEqual([
			{
				name: "remote",
				transport: {
					type: "streamableHttp",
					url: `https://mcp.example.com/${basename(tempRoot)}`,
					headers: {
						Authorization: "Bearer secret-token",
					},
				},
				disabled: undefined,
				metadata: undefined,
				oauth: undefined,
			},
			{
				name: "local",
				transport: {
					type: "stdio",
					command: `${homeRoot}${sep}bin${sep}server`,
					args: ["--cwd", tempRoot, "--sep", sep],
					env: {
						ROOT: tempRoot,
					},
				},
				disabled: undefined,
				metadata: undefined,
				oauth: undefined,
			},
		]);
	});

	it("registers servers from multiple MCP settings files", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const firstPath = join(tempRoot, "first.json");
		const secondPath = join(tempRoot, "second.json");
		await writeFile(
			firstPath,
			JSON.stringify({ mcpServers: { first: { command: "node" } } }),
			"utf8",
		);
		await writeFile(
			secondPath,
			JSON.stringify({ mcpServers: { second: { command: "python" } } }),
			"utf8",
		);

		const registered: Array<{ name: string }> = [];
		const manager = {
			registerServer: async (registration: { name: string }) => {
				registered.push(registration);
			},
		};

		await registerMcpServersFromSettingsFile(manager, {
			filePaths: [firstPath, secondPath],
		});
		expect(registered.map((registration) => registration.name)).toEqual([
			"first",
			"second",
		]);
	});

	it("throws a clear error for invalid config", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {
						broken: {
							transport: {
								type: "stdio",
								command: "",
							},
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		expect(() => resolveMcpServerRegistrations({ filePath })).toThrow(
			"Invalid MCP settings",
		);
	});

	it("accepts legacy flat stdio format", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {
						docs: {
							command: "node",
							args: ["server.js"],
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const registrations = resolveMcpServerRegistrations({ filePath });
		expect(registrations).toEqual([
			{
				name: "docs",
				transport: {
					type: "stdio",
					command: "node",
					args: ["server.js"],
				},
				disabled: undefined,
				metadata: undefined,
				oauth: undefined,
			},
		]);
	});

	it("accepts legacy flat url format and preserves explicit transportType", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {
						legacySse: {
							url: "https://sse.example.com",
						},
						legacyHttp: {
							url: "https://http.example.com",
							transportType: "http",
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const registrations = resolveMcpServerRegistrations({ filePath });
		expect(registrations).toEqual([
			{
				name: "legacySse",
				transport: {
					type: "sse",
					url: "https://sse.example.com",
				},
				disabled: undefined,
				metadata: undefined,
				oauth: undefined,
			},
			{
				name: "legacyHttp",
				transport: {
					type: "streamableHttp",
					url: "https://http.example.com",
				},
				disabled: undefined,
				metadata: undefined,
				oauth: undefined,
			},
		]);
	});

	it("updates disabled state while preserving legacy server shape and top-level settings", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					otherSetting: true,
					mcpServers: {
						docs: {
							command: "node",
							args: ["server.js"],
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		setMcpServerDisabled({ filePath, name: "docs", disabled: true });
		const disabled = JSON.parse(await readFile(filePath, "utf8")) as {
			otherSetting?: boolean;
			mcpServers?: Record<
				string,
				{ command?: string; args?: string[]; disabled?: boolean }
			>;
		};
		expect(disabled.otherSetting).toBe(true);
		expect(disabled.mcpServers?.docs).toEqual({
			command: "node",
			args: ["server.js"],
			disabled: true,
		});

		setMcpServerDisabled({ filePath, name: "docs", disabled: false });
		const enabled = JSON.parse(await readFile(filePath, "utf8")) as {
			mcpServers?: Record<string, { disabled?: boolean }>;
		};
		expect(enabled.mcpServers?.docs?.disabled).toBeUndefined();
	});

	it("loads and updates sdk-managed oauth state in server entries", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {
						linear: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.linear.app/mcp",
							},
							oauth: {
								tokens: {
									access_token: "old-token",
									token_type: "Bearer",
								},
								lastAuthenticatedAt: 123,
							},
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const registrations = resolveMcpServerRegistrations({ filePath });
		expect(registrations[0]?.oauth?.tokens?.access_token).toBe("old-token");
		expect(listMcpServerOAuthStatuses({ filePath })).toEqual([
			{
				serverName: "linear",
				oauthSupported: true,
				oauthConfigured: true,
				lastError: undefined,
				lastAuthenticatedAt: 123,
			},
		]);

		updateMcpServerOAuthState(
			"linear",
			(current) => ({
				...current,
				tokens: {
					access_token: "new-token",
					token_type: "Bearer",
				},
				lastError: undefined,
			}),
			{ filePath },
		);

		const written = JSON.parse(await readFile(filePath, "utf8")) as {
			mcpServers: {
				linear: {
					oauth?: {
						tokens?: Record<string, unknown>;
						lastAuthenticatedAt?: number;
					};
				};
			};
		};
		expect(written.mcpServers.linear.oauth?.tokens?.access_token).toBe(
			"new-token",
		);
		expect(written.mcpServers.linear.oauth?.lastAuthenticatedAt).toBe(123);
	});

	it("rejects inherited server names when updating oauth state", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-config-loader-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {},
				},
				null,
				2,
			),
			"utf8",
		);

		const objectPrototype = Object.prototype as { oauth?: unknown };
		const originalOauth = objectPrototype.oauth;
		try {
			expect(() =>
				updateMcpServerOAuthState(
					"__proto__",
					() => ({
						tokens: {
							access_token: "bad-token",
						},
					}),
					{ filePath },
				),
			).toThrow("Unknown MCP server: __proto__");
			expect(objectPrototype.oauth).toBe(originalOauth);
		} finally {
			if (originalOauth === undefined) {
				delete objectPrototype.oauth;
			} else {
				objectPrototype.oauth = originalOauth;
			}
		}
	});
});
