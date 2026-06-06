import { expect } from "chai"
import { mkdir, mkdtemp, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import sinon from "sinon"
import * as vscode from "vscode"
import { StateManager } from "@/core/storage/StateManager"
import { mockFetchForTesting } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import {
	loadCodexHomeCredentials,
	type OpenAiCodexAuthSource,
	OpenAiCodexOAuthManager,
	parseJwtClaims,
	type OpenAiCodexCredentials,
} from "../oauth"

function jwt(payload: Record<string, unknown>): string {
	const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString("base64url")
	return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`
}

function vscodeSecretCredentialsJson(accessToken: string, refreshToken = "vscode-refresh-secret"): string {
	return JSON.stringify({
		type: "openai-codex",
		access_token: accessToken,
		refresh_token: refreshToken,
		expires: Date.now() + 60_000,
		tokenSource: "oauth",
	})
}

async function createCodexHome(accessToken: string, refreshToken = "codex-refresh-secret"): Promise<string> {
	const codexHome = await mkdtemp(join(tmpdir(), "codevibe-codex-home-"))
	await writeFile(
		join(codexHome, "auth.json"),
		JSON.stringify({
			auth_mode: "chatgpt",
			tokens: {
				access_token: accessToken,
				refresh_token: refreshToken,
			},
		}),
	)
	return codexHome
}

function mockAuthSource(authSource?: OpenAiCodexAuthSource): void {
	vscode.workspace.getConfiguration = () =>
		({
			get: (key: string, defaultValue?: unknown) => {
				if (key === "openAiCodex.authSource") {
					return authSource ?? defaultValue
				}
				return defaultValue
			},
		}) as any
}

function stubVscodeSecret(secret?: string): sinon.SinonStub {
	const getSecretKey = sinon.stub().withArgs("openai-codex-oauth-credentials").returns(secret)
	sinon.stub(StateManager, "get").returns({
		getSecretKey,
		setSecret: sinon.stub(),
		flushPendingState: sinon.stub().resolves(),
	} as unknown as StateManager)
	return getSecretKey
}

describe("OpenAI Codex OAuth local profile support", () => {
	const originalGetConfiguration = vscode.workspace.getConfiguration

	afterEach(() => {
		vscode.workspace.getConfiguration = originalGetConfiguration
		sinon.restore()
	})

	it("parses JWT claims without logging or exposing token values", () => {
		const token = jwt({
			exp: 123,
			email: "user@example.com",
			"https://api.openai.com/auth": {
				chatgpt_account_id: "acct_123",
			},
		})

		expect(parseJwtClaims(token)).to.deep.include({
			exp: 123,
			email: "user@example.com",
		})
	})

	it("loads credentials from a Codex home auth.json profile", async () => {
		const codexHome = join(tmpdir(), `codevibe-codex-home-${Date.now()}`)
		await mkdir(codexHome, { recursive: true })
		const accessToken = jwt({
			exp: 2_000,
			email: "access@example.com",
			"https://api.openai.com/auth": {
				chatgpt_account_id: "acct_from_access",
			},
		})
		const idToken = jwt({
			email: "id@example.com",
			organizations: [{ id: "org_from_id" }],
		})

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
		)
		await writeFile(join(codexHome, "installation_id"), "install_123\n")
		await writeFile(join(codexHome, "models_cache.json"), JSON.stringify({ client_version: "0.136.0-test" }))

		const credentials = await loadCodexHomeCredentials({ codexHome })

		expect(credentials).to.deep.include({
			type: "openai-codex",
			access_token: accessToken,
			refresh_token: "refresh-secret",
			id_token: idToken,
			expires: 2_000_000,
			email: "id@example.com",
			accountId: "org_from_id",
			tokenSource: "codex-home",
			installationId: "install_123",
			clientVersion: "0.136.0-test",
			authMode: "chatgpt",
		})
	})

	it("defaults to Codex home credentials before VS Code secret storage", async () => {
		mockAuthSource()
		const getSecretKey = stubVscodeSecret(vscodeSecretCredentialsJson("vscode-access-secret"))
		const codexHome = await createCodexHome(jwt({ exp: 2_000 }), "codex-refresh-secret")

		const manager = new OpenAiCodexOAuthManager()
		const credentials = await manager.loadCredentials({ codexHome })

		expect(credentials?.tokenSource).to.equal("codex-home")
		expect(credentials?.refresh_token).to.equal("codex-refresh-secret")
		expect(getSecretKey.called).to.equal(false)
	})

	it("defaults to VS Code secret storage when Codex home credentials are missing", async () => {
		mockAuthSource()
		stubVscodeSecret(vscodeSecretCredentialsJson("vscode-access-secret"))
		const codexHome = await mkdtemp(join(tmpdir(), "codevibe-codex-home-empty-"))

		const manager = new OpenAiCodexOAuthManager()
		const credentials = await manager.loadCredentials({ codexHome })

		expect(credentials?.access_token).to.equal("vscode-access-secret")
		expect(credentials?.tokenSource).to.equal("oauth")
	})

	it("prefers Codex home credentials when authSource is codexHome", async () => {
		mockAuthSource("codexHome")
		const getSecretKey = stubVscodeSecret(vscodeSecretCredentialsJson("vscode-access-secret"))
		const codexHome = await createCodexHome(jwt({ exp: 2_000 }), "codex-refresh-secret")

		const manager = new OpenAiCodexOAuthManager()
		const credentials = await manager.loadCredentials({ codexHome })

		expect(credentials?.tokenSource).to.equal("codex-home")
		expect(credentials?.refresh_token).to.equal("codex-refresh-secret")
		expect(getSecretKey.called).to.equal(false)
	})

	it("prefers VS Code secret storage when authSource is vscodeSecret", async () => {
		mockAuthSource("vscodeSecret")
		stubVscodeSecret(vscodeSecretCredentialsJson("vscode-access-secret"))
		const codexHome = await createCodexHome(jwt({ exp: 2_000 }), "codex-refresh-secret")

		const manager = new OpenAiCodexOAuthManager()
		const credentials = await manager.loadCredentials({ codexHome })

		expect(credentials?.access_token).to.equal("vscode-access-secret")
		expect(credentials?.tokenSource).to.equal("oauth")
	})

	it("uses auto authSource to try VS Code secret storage before Codex home", async () => {
		mockAuthSource("auto")
		stubVscodeSecret(vscodeSecretCredentialsJson("vscode-access-secret"))
		const codexHome = await createCodexHome(jwt({ exp: 2_000 }), "codex-refresh-secret")

		const manager = new OpenAiCodexOAuthManager()
		const credentials = await manager.loadCredentials({ codexHome })

		expect(credentials?.access_token).to.equal("vscode-access-secret")
		expect(credentials?.tokenSource).to.equal("oauth")
	})

	it("falls back from missing VS Code secret storage to Codex home in auto mode", async () => {
		mockAuthSource("auto")
		stubVscodeSecret(undefined)
		const codexHome = await createCodexHome(jwt({ exp: 2_000 }), "codex-refresh-secret")

		const manager = new OpenAiCodexOAuthManager()
		const credentials = await manager.loadCredentials({ codexHome })

		expect(credentials?.tokenSource).to.equal("codex-home")
		expect(credentials?.refresh_token).to.equal("codex-refresh-secret")
	})

	it("does not log token values when a preferred credential source fails", async () => {
		mockAuthSource("vscodeSecret")
		stubVscodeSecret(
			JSON.stringify({
				type: "openai-codex",
				access_token: "access-secret-in-log-test",
				refresh_token: "refresh-secret-in-log-test",
				expires: "not-a-number",
			}),
		)
		const codexHome = await createCodexHome(jwt({ exp: 2_000 }), "codex-refresh-secret")
		const errorStub = sinon.stub(Logger, "error")

		const manager = new OpenAiCodexOAuthManager()
		const credentials = await manager.loadCredentials({ codexHome })

		const logged = errorStub.args.flat().map(String).join("\n")
		expect(credentials?.tokenSource).to.equal("codex-home")
		expect(logged).to.include("Failed to load VS Code secret credentials")
		expect(logged).to.not.include("access-secret-in-log-test")
		expect(logged).to.not.include("refresh-secret-in-log-test")
	})

	it("lists backend models with Codex auth and installation headers", async () => {
		const manager = new OpenAiCodexOAuthManager()
		const credentials: OpenAiCodexCredentials = {
			type: "openai-codex",
			access_token: "access-secret",
			refresh_token: "refresh-secret",
			expires: Date.now() + 60_000,
			installationId: "install_abc",
			clientVersion: "0.136.0-test",
		}
		;(manager as any).credentials = credentials

		let seenUrl = ""
		let seenHeaders: HeadersInit | undefined
		const models = await mockFetchForTesting(
			(async (input: string | URL | Request, init?: RequestInit) => {
				seenUrl = String(input)
				seenHeaders = init?.headers
				return new Response(
					JSON.stringify({
						models: [
							{ display_name: "GPT-5.5", slug: "gpt-5.5", supported_in_api: true },
							{ display_name: "Hidden", slug: "hidden", supported_in_api: false },
						],
					}),
					{ status: 200 },
				)
			}) as typeof globalThis.fetch,
			() => manager.listBackendModels(),
		)

		expect(seenUrl).to.equal("https://chatgpt.com/backend-api/codex/models?client_version=0.136.0-test")
		expect(seenHeaders).to.deep.include({
			Authorization: "Bearer access-secret",
			"x-codex-installation-id": "install_abc",
		})
		expect(models).to.deep.equal([{ id: "gpt-5.5", name: "GPT-5.5", supportedInApi: true }])
	})
})
