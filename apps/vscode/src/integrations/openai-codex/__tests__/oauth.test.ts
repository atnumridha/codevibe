import { expect } from "chai";
import { mkdir, mkdtemp, writeFile } from "fs/promises";
import * as http from "http";
import { tmpdir } from "os";
import { join } from "path";
import sinon from "sinon";
import { StateManager } from "@/core/storage/StateManager";
import { HostProvider } from "@/hosts/host-provider";
import { mockFetchForTesting } from "@/shared/net";
import { Logger } from "@/shared/services/Logger";
import {
	buildAuthorizationUrl,
	exchangeCodeForTokens,
	loadCodexHomeCredentials,
	type OpenAiCodexAuthSource,
	refreshAccessToken,
	OpenAiCodexOAuthManager,
	parseJwtClaims,
	type OpenAiCodexCredentials,
} from "../oauth";

const vscode = require("vscode") as typeof import("vscode");

function jwt(payload: Record<string, unknown>): string {
	const encode = (value: Record<string, unknown>) =>
		Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

function vscodeSecretCredentialsJson(
	accessToken: string,
	refreshToken = "vscode-refresh-secret",
): string {
	return JSON.stringify({
		type: "openai-codex",
		access_token: accessToken,
		refresh_token: refreshToken,
		expires: Date.now() + 60_000,
		tokenSource: "oauth",
	});
}

async function createCodexHome(
	accessToken: string,
	refreshToken = "codex-refresh-secret",
): Promise<string> {
	const codexHome = await mkdtemp(join(tmpdir(), "codevibe-codex-home-"));
	await writeFile(
		join(codexHome, "auth.json"),
		JSON.stringify({
			auth_mode: "chatgpt",
			tokens: {
				access_token: accessToken,
				refresh_token: refreshToken,
			},
		}),
	);
	return codexHome;
}

async function createWorkspaceCodexHome(
	accessToken: string,
	refreshToken = "workspace-refresh-secret",
): Promise<{ workspaceRoot: string; codexHome: string }> {
	const workspaceRoot = await mkdtemp(join(tmpdir(), "codevibe-workspace-"));
	const codexHome = join(workspaceRoot, ".codex");
	await mkdir(codexHome, { recursive: true });
	await writeFile(
		join(codexHome, "auth.json"),
		JSON.stringify({
			auth_mode: "chatgpt",
			tokens: {
				access_token: accessToken,
				refresh_token: refreshToken,
			},
		}),
	);
	return { workspaceRoot, codexHome };
}

function mockAuthSource(authSource?: OpenAiCodexAuthSource): void {
	vscode.workspace.getConfiguration = () =>
		({
			get: (key: string, defaultValue?: unknown) => {
				if (key === "openAiCodex.authSource") {
					return authSource ?? defaultValue;
				}
				return defaultValue;
			},
		}) as any;
}

function stubVscodeSecret(secret?: string): sinon.SinonStub {
	const getSecretKey = sinon
		.stub()
		.withArgs("openai-codex-oauth-credentials")
		.returns(secret);
	sinon.stub(StateManager, "get").returns({
		getSecretKey,
		setSecret: sinon.stub(),
		flushPendingState: sinon.stub().resolves(),
	} as unknown as StateManager);
	return getSecretKey;
}

async function expectRejects(
	promise: Promise<unknown>,
	message: RegExp,
): Promise<void> {
	try {
		await promise;
		throw new Error("Expected promise to reject");
	} catch (error) {
		expect(error).to.be.instanceOf(Error);
		expect((error as Error).message).to.match(message);
	}
}

function createFakeCallbackServer(): http.Server {
	const listeners = new Map<string, Array<(...args: any[]) => void>>();
	const server = {
		close: sinon.stub().callsFake(() => {
			for (const listener of listeners.get("close") ?? []) {
				listener();
			}
			return server;
		}),
		listen: sinon.stub().callsFake((_port: number, callback?: () => void) => {
			callback?.();
			return server;
		}),
		on: sinon
			.stub()
			.callsFake((event: string, listener: (...args: any[]) => void) => {
				listeners.set(event, [...(listeners.get(event) ?? []), listener]);
				return server;
			}),
	} as unknown as http.Server;
	return server;
}

describe("Codie ChatGPT OAuth local profile support", () => {
	const originalGetConfiguration = vscode.workspace.getConfiguration;
	const originalCodexHomeEnv = process.env.CODEX_HOME;

	afterEach(() => {
		vscode.workspace.getConfiguration = originalGetConfiguration;
		if (originalCodexHomeEnv === undefined) {
			delete process.env.CODEX_HOME;
		} else {
			process.env.CODEX_HOME = originalCodexHomeEnv;
		}
		sinon.restore();
	});

	it("parses JWT claims without logging or exposing token values", () => {
		const token = jwt({
			exp: 123,
			email: "user@example.com",
			"https://api.openai.com/auth": {
				chatgpt_account_id: "acct_123",
			},
		});

		expect(parseJwtClaims(token)).to.deep.include({
			exp: 123,
			email: "user@example.com",
		});
	});

	it("builds the Codex OAuth authorization URL with organization claims enabled", () => {
		const authorizationUrl = new URL(
			buildAuthorizationUrl("challenge-secret", "state-secret"),
		);

		expect(authorizationUrl.origin + authorizationUrl.pathname).to.equal(
			"https://auth.openai.com/oauth/authorize",
		);
		expect(
			authorizationUrl.searchParams.get("codex_cli_simplified_flow"),
		).to.equal("true");
		expect(
			authorizationUrl.searchParams.get("id_token_add_organizations"),
		).to.equal("true");
		expect(authorizationUrl.searchParams.get("originator")).to.equal("codie");
		expect(authorizationUrl.searchParams.get("code_challenge")).to.equal(
			"challenge-secret",
		);
		expect(authorizationUrl.searchParams.get("state")).to.equal("state-secret");
	});

	it("loads credentials from a Codex home auth.json profile", async () => {
		const codexHome = join(tmpdir(), `codevibe-codex-home-${Date.now()}`);
		await mkdir(codexHome, { recursive: true });
		const accessToken = jwt({
			exp: 2_000,
			email: "access@example.com",
			"https://api.openai.com/auth": {
				chatgpt_account_id: "acct_from_access",
			},
		});
		const idToken = jwt({
			email: "id@example.com",
			organizations: [{ id: "org_from_id" }],
		});

		await writeFile(
			join(codexHome, "auth.json"),
			JSON.stringify({
				auth_mode: "chatgpt",
				tokens: {
					access_token: accessToken,
					refresh_token: "refresh-secret",
					id_token: idToken,
				},
			}),
		);
		await writeFile(join(codexHome, "installation_id"), "install_123\n");
		await writeFile(
			join(codexHome, "models_cache.json"),
			JSON.stringify({ client_version: "0.136.0-test" }),
		);

		const credentials = await loadCodexHomeCredentials({ codexHome });

		expect(credentials).to.deep.include({
			type: "openai-codex",
			access_token: accessToken,
			refresh_token: "refresh-secret",
			id_token: idToken,
			expires: 2_000_000,
			email: "id@example.com",
			accountId: "acct_from_access",
			tokenSource: "codex-home",
			installationId: "install_123",
			clientVersion: "0.136.0-test",
			authMode: "chatgpt",
		});
	});

	it("loads credentials from a workspace .codex auth.json profile", async () => {
		const accessToken = jwt({
			exp: 2_000,
			email: "workspace@example.com",
			"https://api.openai.com/auth": {
				chatgpt_account_id: "acct_from_workspace",
			},
		});
		const { workspaceRoot } = await createWorkspaceCodexHome(
			accessToken,
			"workspace-refresh-secret",
		);

		const credentials = await loadCodexHomeCredentials({
			workspaceRoots: [workspaceRoot],
		});

		expect(credentials).to.deep.include({
			type: "openai-codex",
			access_token: accessToken,
			refresh_token: "workspace-refresh-secret",
			expires: 2_000_000,
			email: "workspace@example.com",
			accountId: "acct_from_workspace",
			tokenSource: "codex-home",
			authMode: "chatgpt",
		});
	});

	it("skips an invalid workspace .codex profile and loads the next workspace profile", async () => {
		const invalidWorkspaceRoot = await mkdtemp(
			join(tmpdir(), "codevibe-invalid-workspace-"),
		);
		const invalidCodexHome = join(invalidWorkspaceRoot, ".codex");
		await mkdir(invalidCodexHome, { recursive: true });
		await writeFile(join(invalidCodexHome, "auth.json"), "{not json");

		const accessToken = jwt({
			exp: 2_000,
			email: "next-workspace@example.com",
			"https://api.openai.com/auth": {
				chatgpt_account_id: "acct_from_next_workspace",
			},
		});
		const { workspaceRoot } = await createWorkspaceCodexHome(
			accessToken,
			"next-workspace-refresh-secret",
		);
		const warnStub = sinon.stub(Logger, "warn");

		const credentials = await loadCodexHomeCredentials({
			workspaceRoots: [invalidWorkspaceRoot, workspaceRoot],
		});

		expect(credentials).to.deep.include({
			type: "openai-codex",
			access_token: accessToken,
			refresh_token: "next-workspace-refresh-secret",
			accountId: "acct_from_next_workspace",
			tokenSource: "codex-home",
		});
		expect(warnStub.calledOnce).to.equal(true);
		expect(String(warnStub.firstCall.args[0])).to.contain(
			"Skipping invalid Codex home credentials candidate",
		);
		expect(String(warnStub.firstCall.args[0])).not.to.contain(
			invalidWorkspaceRoot,
		);
	});

	it("discovers workspace .codex credentials from the host workspace service", async () => {
		const accessToken = jwt({ exp: 2_000 });
		const { workspaceRoot } = await createWorkspaceCodexHome(
			accessToken,
			"host-workspace-refresh-secret",
		);
		sinon.stub(HostProvider, "isInitialized").returns(true);
		sinon.stub(HostProvider, "workspace").get(() => ({
			getWorkspacePaths: sinon.stub().resolves({ paths: [workspaceRoot] }),
		}));

		const credentials = await loadCodexHomeCredentials();

		expect(credentials?.access_token).to.equal(accessToken);
		expect(credentials?.refresh_token).to.equal(
			"host-workspace-refresh-secret",
		);
		expect(credentials?.tokenSource).to.equal("codex-home");
	});

	it("uses an explicit Codex home before workspace .codex credentials", async () => {
		const explicitAccessToken = jwt({ exp: 2_000 });
		const workspaceAccessToken = jwt({ exp: 3_000 });
		const explicitCodexHome = await createCodexHome(
			explicitAccessToken,
			"explicit-refresh-secret",
		);
		const { workspaceRoot } = await createWorkspaceCodexHome(
			workspaceAccessToken,
			"workspace-refresh-secret",
		);

		const credentials = await loadCodexHomeCredentials({
			codexHome: explicitCodexHome,
			workspaceRoots: [workspaceRoot],
		});

		expect(credentials?.access_token).to.equal(explicitAccessToken);
		expect(credentials?.refresh_token).to.equal("explicit-refresh-secret");
	});

	it("uses CODEX_HOME before workspace .codex credentials", async () => {
		const envAccessToken = jwt({ exp: 2_000 });
		const workspaceAccessToken = jwt({ exp: 3_000 });
		const envCodexHome = await createCodexHome(
			envAccessToken,
			"env-refresh-secret",
		);
		const { workspaceRoot } = await createWorkspaceCodexHome(
			workspaceAccessToken,
			"workspace-refresh-secret",
		);
		process.env.CODEX_HOME = envCodexHome;

		const credentials = await loadCodexHomeCredentials({
			workspaceRoots: [workspaceRoot],
		});

		expect(credentials?.access_token).to.equal(envAccessToken);
		expect(credentials?.refresh_token).to.equal("env-refresh-secret");
	});

	it("loads Codex home credentials when optional models cache is malformed", async () => {
		const codexHome = join(
			tmpdir(),
			`codevibe-codex-home-malformed-cache-${Date.now()}`,
		);
		await mkdir(codexHome, { recursive: true });
		const accessToken = jwt({
			exp: 2_000,
			email: "access@example.com",
		});

		await writeFile(
			join(codexHome, "auth.json"),
			JSON.stringify({
				tokens: {
					access_token: accessToken,
					refresh_token: "refresh-secret",
				},
			}),
		);
		await writeFile(join(codexHome, "models_cache.json"), "{not json");

		const credentials = await loadCodexHomeCredentials({ codexHome });

		expect(credentials).to.deep.include({
			type: "openai-codex",
			access_token: accessToken,
			refresh_token: "refresh-secret",
			tokenSource: "codex-home",
		});
		expect(credentials?.clientVersion).to.equal(undefined);
	});

	it("prefers access-token ChatGPT account claims over id-token organizations", async () => {
		const codexHome = join(
			tmpdir(),
			`codevibe-codex-home-account-${Date.now()}`,
		);
		await mkdir(codexHome, { recursive: true });
		const accessToken = jwt({
			"https://api.openai.com/auth": {
				chatgpt_account_id: "acct_from_access",
			},
		});
		const idToken = jwt({
			organizations: [{ id: "org_from_id" }],
		});

		await writeFile(
			join(codexHome, "auth.json"),
			JSON.stringify({
				tokens: {
					access_token: accessToken,
					refresh_token: "refresh-secret",
					id_token: idToken,
				},
			}),
		);

		const credentials = await loadCodexHomeCredentials({ codexHome });

		expect(credentials?.accountId).to.equal("acct_from_access");
	});

	it("uses Codex home token account_id before id-token organization fallbacks", async () => {
		const codexHome = join(
			tmpdir(),
			`codevibe-codex-home-token-account-${Date.now()}`,
		);
		await mkdir(codexHome, { recursive: true });
		const accessToken = jwt({
			exp: 2_000,
			email: "access@example.com",
		});
		const idToken = jwt({
			organizations: [{ id: "org-from-id-token" }],
		});

		await writeFile(
			join(codexHome, "auth.json"),
			JSON.stringify({
				tokens: {
					access_token: accessToken,
					refresh_token: "refresh-secret",
					id_token: idToken,
					account_id: "acct-from-file",
				},
			}),
		);

		const credentials = await loadCodexHomeCredentials({ codexHome });

		expect(credentials).to.deep.include({
			type: "openai-codex",
			accountId: "acct-from-file",
			tokenSource: "codex-home",
		});
	});

	it("defaults to auto auth source with Codex home before VS Code secret storage", async () => {
		mockAuthSource();
		const getSecretKey = stubVscodeSecret(
			vscodeSecretCredentialsJson("vscode-access-secret"),
		);
		const codexHome = await createCodexHome(
			jwt({ exp: 2_000 }),
			"codex-refresh-secret",
		);

		const manager = new OpenAiCodexOAuthManager();
		const credentials = await manager.loadCredentials({ codexHome });

		expect(credentials?.tokenSource).to.equal("codex-home");
		expect(credentials?.refresh_token).to.equal("codex-refresh-secret");
		expect(getSecretKey.called).to.equal(false);
	});

	it("defaults to workspace .codex credentials before VS Code secret storage", async () => {
		mockAuthSource();
		const getSecretKey = stubVscodeSecret(
			vscodeSecretCredentialsJson("vscode-access-secret"),
		);
		const accessToken = jwt({ exp: 2_000 });
		const { workspaceRoot } = await createWorkspaceCodexHome(
			accessToken,
			"workspace-refresh-secret",
		);

		const manager = new OpenAiCodexOAuthManager();
		const credentials = await manager.loadCredentials({
			workspaceRoots: [workspaceRoot],
		});

		expect(credentials?.access_token).to.equal(accessToken);
		expect(credentials?.tokenSource).to.equal("codex-home");
		expect(credentials?.refresh_token).to.equal("workspace-refresh-secret");
		expect(getSecretKey.called).to.equal(false);
	});

	it("falls back to VS Code secret credentials when stale Codex home refresh is invalid", async () => {
		mockAuthSource("codexHome");
		const getSecretKey = sinon
			.stub()
			.withArgs("openai-codex-oauth-credentials")
			.returns(
				JSON.stringify({
					type: "openai-codex",
					access_token: "vscode-access-secret",
					refresh_token: "vscode-refresh-secret",
					expires: Date.now() + 10 * 60_000,
					tokenSource: "oauth",
				}),
			);
		const setSecret = sinon.stub();
		sinon.stub(StateManager, "get").returns({
			getSecretKey,
			setSecret,
			flushPendingState: sinon.stub().resolves(),
		} as unknown as StateManager);
		const codexHome = await createCodexHome(
			jwt({ exp: 1 }),
			"stale-codex-refresh-secret",
		);
		const manager = new OpenAiCodexOAuthManager();

		const loaded = await manager.loadCredentials({ codexHome });
		expect(loaded?.tokenSource).to.equal("codex-home");

		const accessToken = await mockFetchForTesting(
			(async () =>
				new Response(
					JSON.stringify({
						error: "invalid_grant",
						error_description: "stale Codex home refresh token",
					}),
					{ status: 401, statusText: "Unauthorized" },
				)) as typeof globalThis.fetch,
			async () => await manager.getAccessToken(),
		);

		expect(accessToken).to.equal("vscode-access-secret");
		expect(getSecretKey.called).to.equal(true);
		expect(setSecret.called).to.equal(false);
	});

	it("defaults to VS Code secret storage when Codex home credentials are missing", async () => {
		mockAuthSource();
		stubVscodeSecret(vscodeSecretCredentialsJson("vscode-access-secret"));
		const codexHome = await mkdtemp(
			join(tmpdir(), "codevibe-codex-home-empty-"),
		);

		const manager = new OpenAiCodexOAuthManager();
		const credentials = await manager.loadCredentials({ codexHome });

		expect(credentials?.access_token).to.equal("vscode-access-secret");
		expect(credentials?.tokenSource).to.equal("oauth");
	});

	it("falls back to VS Code secret storage when preferred Codex home auth.json is malformed", async () => {
		mockAuthSource("codexHome");
		const getSecretKey = stubVscodeSecret(
			vscodeSecretCredentialsJson("vscode-access-secret"),
		);
		const codexHome = await mkdtemp(
			join(tmpdir(), "codevibe-codex-home-malformed-"),
		);
		await writeFile(
			join(codexHome, "auth.json"),
			'{"access_token":"codex-access-secret"',
		);
		const warnStub = sinon.stub(Logger, "warn");
		const errorStub = sinon.stub(Logger, "error");
		process.env.CODEX_HOME = codexHome;

		const manager = new OpenAiCodexOAuthManager();
		const credentials = await manager.loadCredentials();

		const logged = [...warnStub.args, ...errorStub.args]
			.flat()
			.map(String)
			.join("\n");
		expect(credentials?.access_token).to.equal("vscode-access-secret");
		expect(credentials?.tokenSource).to.equal("oauth");
		expect(getSecretKey.calledOnce).to.equal(true);
		expect(logged).to.contain(
			"Skipping invalid Codex home credentials candidate",
		);
		expect(logged).to.not.contain("codex-access-secret");
		expect(logged).to.not.contain("vscode-access-secret");
		expect(logged).to.not.contain(codexHome);
	});

	it("prefers Codex home credentials when authSource is codexHome", async () => {
		mockAuthSource("codexHome");
		const getSecretKey = stubVscodeSecret(
			vscodeSecretCredentialsJson("vscode-access-secret"),
		);
		const codexHome = await createCodexHome(
			jwt({ exp: 2_000 }),
			"codex-refresh-secret",
		);

		const manager = new OpenAiCodexOAuthManager();
		const credentials = await manager.loadCredentials({ codexHome });

		expect(credentials?.tokenSource).to.equal("codex-home");
		expect(credentials?.refresh_token).to.equal("codex-refresh-secret");
		expect(getSecretKey.called).to.equal(false);
	});

	it("prefers VS Code secret storage when authSource is vscodeSecret", async () => {
		mockAuthSource("vscodeSecret");
		stubVscodeSecret(vscodeSecretCredentialsJson("vscode-access-secret"));
		const codexHome = await createCodexHome(
			jwt({ exp: 2_000 }),
			"codex-refresh-secret",
		);

		const manager = new OpenAiCodexOAuthManager();
		const credentials = await manager.loadCredentials({ codexHome });

		expect(credentials?.access_token).to.equal("vscode-access-secret");
		expect(credentials?.tokenSource).to.equal("oauth");
	});

	it("uses auto authSource to try Codex home before VS Code secret storage", async () => {
		mockAuthSource("auto");
		const getSecretKey = stubVscodeSecret(
			vscodeSecretCredentialsJson("vscode-access-secret"),
		);
		const codexHome = await createCodexHome(
			jwt({ exp: 2_000 }),
			"codex-refresh-secret",
		);

		const manager = new OpenAiCodexOAuthManager();
		const credentials = await manager.loadCredentials({ codexHome });

		expect(credentials?.tokenSource).to.equal("codex-home");
		expect(credentials?.refresh_token).to.equal("codex-refresh-secret");
		expect(getSecretKey.called).to.equal(false);
	});

	it("falls back from missing Codex home to VS Code secret storage in auto mode", async () => {
		mockAuthSource("auto");
		stubVscodeSecret(vscodeSecretCredentialsJson("vscode-access-secret"));
		const codexHome = await mkdtemp(
			join(tmpdir(), "codevibe-codex-home-empty-auto-"),
		);

		const manager = new OpenAiCodexOAuthManager();
		const credentials = await manager.loadCredentials({ codexHome });

		expect(credentials?.access_token).to.equal("vscode-access-secret");
		expect(credentials?.tokenSource).to.equal("oauth");
	});

	it("does not log token values when a preferred credential source fails", async () => {
		mockAuthSource("vscodeSecret");
		stubVscodeSecret(
			JSON.stringify({
				type: "openai-codex",
				access_token: "access-secret-in-log-test",
				refresh_token: "refresh-secret-in-log-test",
				expires: "not-a-number",
			}),
		);
		const codexHome = await createCodexHome(
			jwt({ exp: 2_000 }),
			"codex-refresh-secret",
		);
		const errorStub = sinon.stub(Logger, "error");

		const manager = new OpenAiCodexOAuthManager();
		const credentials = await manager.loadCredentials({ codexHome });

		const logged = errorStub.args.flat().map(String).join("\n");
		expect(credentials?.tokenSource).to.equal("codex-home");
		expect(logged).to.include("Failed to load VS Code secret credentials");
		expect(logged).to.not.include("access-secret-in-log-test");
		expect(logged).to.not.include("refresh-secret-in-log-test");
	});

	it("redacts authorization code and verifier from token exchange errors", async () => {
		const code = "authorization-code-secret";
		const verifier = "pkce-verifier-secret";

		await mockFetchForTesting(
			(async () =>
				new Response(
					JSON.stringify({
						error: "invalid_grant",
						error_description: `bad code ${code} and verifier ${verifier}`,
					}),
					{ status: 400, statusText: "Bad Request" },
				)) as typeof globalThis.fetch,
			async () => {
				try {
					await exchangeCodeForTokens(code, verifier);
					throw new Error("Expected exchangeCodeForTokens to fail");
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					expect(message).to.include("[REDACTED]");
					expect(message).to.not.include(code);
					expect(message).to.not.include(verifier);
				}
			},
		);
	});

	it("redacts credential token values from token refresh errors", async () => {
		const credentials: OpenAiCodexCredentials = {
			type: "openai-codex",
			access_token: "access-token-secret",
			refresh_token: "refresh-token-secret",
			id_token: "id-token-secret",
			expires: Date.now() + 60_000,
		};

		await mockFetchForTesting(
			(async () =>
				new Response(
					JSON.stringify({
						error: "invalid_grant",
						error_description: `expired ${credentials.refresh_token}, ${credentials.access_token}, and ${credentials.id_token}`,
					}),
					{ status: 401, statusText: "Unauthorized" },
				)) as typeof globalThis.fetch,
			async () => {
				try {
					await refreshAccessToken(credentials);
					throw new Error("Expected refreshAccessToken to fail");
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					expect(message).to.include("[REDACTED]");
					expect(message).to.not.include(credentials.refresh_token);
					expect(message).to.not.include(credentials.access_token);
					expect(message).to.not.include(credentials.id_token);
				}
			},
		);
	});

	it("does not treat expired credentials with an invalid refresh token as usable", async () => {
		const setSecret = sinon.stub();
		sinon.stub(StateManager, "get").returns({
			getSecretKey: sinon.stub(),
			setSecret,
			flushPendingState: sinon.stub().resolves(),
		} as unknown as StateManager);
		const manager = new OpenAiCodexOAuthManager();
		(manager as any).credentials = {
			type: "openai-codex",
			access_token: "expired-access-secret",
			refresh_token: "invalid-refresh-secret",
			expires: Date.now() - 60_000,
			tokenSource: "oauth",
		} satisfies OpenAiCodexCredentials;

		const usable = await mockFetchForTesting(
			(async () =>
				new Response(
					JSON.stringify({
						error: "invalid_grant",
						error_description: "refresh token expired",
					}),
					{ status: 401, statusText: "Unauthorized" },
				)) as typeof globalThis.fetch,
			() => manager.hasUsableCredentials(),
		);

		expect(usable).to.equal(false);
		expect(
			setSecret.calledWith("openai-codex-oauth-credentials", undefined),
		).to.equal(true);
	});

		it("reuses one pending authorization flow and callback server", async () => {
			const fakeServer = createFakeCallbackServer();
			const createServer = sinon.stub().returns(fakeServer);
			const manager = new OpenAiCodexOAuthManager({ createServer });

		const firstUrl = manager.startAuthorizationFlow();
		const secondUrl = manager.startAuthorizationFlow();
		const firstCallback = manager.waitForCallback();
		const secondCallback = manager.waitForCallback();
		await manager.waitForCallbackServerReady();

		expect(secondUrl).to.equal(firstUrl);
		expect(createServer.calledOnce).to.equal(true);

		manager.cancelAuthorizationFlow();
		await expectRejects(firstCallback, /cancelled/);
		await expectRejects(secondCallback, /cancelled/);
		expect(
			(fakeServer.close as unknown as sinon.SinonStub).calledOnce,
		).to.equal(true);
	});

	it("lists backend models with Codex auth and installation headers", async () => {
		const manager = new OpenAiCodexOAuthManager();
		const credentials: OpenAiCodexCredentials = {
			type: "openai-codex",
			access_token: "access-secret",
			refresh_token: "refresh-secret",
			expires: Date.now() + 10 * 60_000,
			accountId: "acct_abc",
			installationId: "install_abc",
			clientVersion: "0.136.0-test",
		};
		(manager as any).credentials = credentials;

		let seenUrl = "";
		let seenHeaders: HeadersInit | undefined;
		const models = await mockFetchForTesting(
			(async (input: string | URL | Request, init?: RequestInit) => {
				seenUrl = String(input);
				seenHeaders = init?.headers;
				return new Response(
					JSON.stringify({
						models: [
							{
								display_name: "GPT-5.5",
								slug: "gpt-5.5",
								supported_in_api: true,
								context_window: 1_000_000,
								max_output_tokens: 64_000,
								supports_images: false,
								supports_prompt_cache: false,
								supports_reasoning: true,
								api_format: "openai_responses",
								description: "Backend-authoritative Codex model",
							},
							{
								display_name: "Hidden",
								slug: "hidden",
								supported_in_api: false,
							},
						],
					}),
					{ status: 200 },
				);
			}) as typeof globalThis.fetch,
			() => manager.listBackendModels(),
		);

		expect(seenUrl).to.equal(
			"https://chatgpt.com/backend-api/codex/models?client_version=0.136.0-test",
		);
		expect(seenHeaders).to.deep.include({
			Authorization: "Bearer access-secret",
			originator: "codie",
			"ChatGPT-Account-Id": "acct_abc",
			"x-codex-installation-id": "install_abc",
		});
		expect((seenHeaders as Record<string, string>)?.session_id)
			.to.be.a("string")
			.and.not.equal("");
		expect((seenHeaders as Record<string, string>)?.["User-Agent"]).to.match(
			/^Codie\//,
		);
		expect(models).to.deep.equal([
			{
				id: "gpt-5.5",
				name: "GPT-5.5",
				supportedInApi: true,
				contextWindow: 1_000_000,
				maxTokens: 64_000,
				supportsImages: false,
				supportsPromptCache: false,
				supportsReasoning: true,
				apiFormat: "openai_responses",
				description: "Backend-authoritative Codex model",
			},
		]);
	});

	it("refreshes once and retries backend model discovery after an auth failure", async () => {
		const setSecret = sinon.stub();
		sinon.stub(StateManager, "get").returns({
			getSecretKey: sinon.stub(),
			setSecret,
			flushPendingState: sinon.stub().resolves(),
		} as unknown as StateManager);
		const manager = new OpenAiCodexOAuthManager();
		const credentials: OpenAiCodexCredentials = {
			type: "openai-codex",
			access_token: "stale-access-secret",
			refresh_token: "refresh-secret",
			expires: Date.now() + 10 * 60_000,
			accountId: "acct_retry",
			installationId: "install_retry",
			clientVersion: "0.136.0-test",
		};
		(manager as any).credentials = credentials;

		const modelSessionIds: string[] = [];
		const modelAuthorizationHeaders: string[] = [];
		const models = await mockFetchForTesting(
			(async (input: string | URL | Request, init?: RequestInit) => {
				const url = String(input);
				if (url.startsWith("https://chatgpt.com/backend-api/codex/models")) {
					const headers = init?.headers as Record<string, string>;
					modelSessionIds.push(headers.session_id);
					modelAuthorizationHeaders.push(headers.Authorization);
					if (modelSessionIds.length === 1) {
						return new Response(
							JSON.stringify({
								error: "invalid_token",
								error_description: "expired access token",
							}),
							{ status: 401, statusText: "Unauthorized" },
						);
					}
					return new Response(
						JSON.stringify({
							models: [
								{
									display_name: "GPT-6 Codex Preview",
									slug: "gpt-6-codex-preview",
									supported_in_api: true,
								},
							],
						}),
						{ status: 200 },
					);
				}

				expect(url).to.equal("https://auth.openai.com/oauth/token");
				return new Response(
					JSON.stringify({
						access_token: "refreshed-access-secret",
						refresh_token: "refreshed-refresh-secret",
						expires_in: 3600,
					}),
					{ status: 200 },
				);
			}) as typeof globalThis.fetch,
			() => manager.listBackendModels(),
		);

		expect(modelSessionIds).to.have.length(2);
		expect(modelSessionIds[0]).to.equal(modelSessionIds[1]);
		expect(modelAuthorizationHeaders).to.deep.equal([
			"Bearer stale-access-secret",
			"Bearer refreshed-access-secret",
		]);
		expect(setSecret.calledOnce).to.equal(true);
		expect(JSON.parse(setSecret.firstCall.args[1]).access_token).to.equal(
			"refreshed-access-secret",
		);
		expect(models.map((model) => model.id)).to.deep.equal([
			"gpt-6-codex-preview",
		]);
	});
});
