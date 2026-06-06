import { expect } from "chai"
import { mkdir, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import sinon from "sinon"
import { mockFetchForTesting } from "@/shared/net"
import {
	loadCodexHomeCredentials,
	OpenAiCodexOAuthManager,
	parseJwtClaims,
	type OpenAiCodexCredentials,
} from "../oauth"

function jwt(payload: Record<string, unknown>): string {
	const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString("base64url")
	return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`
}

describe("OpenAI Codex OAuth local profile support", () => {
	afterEach(() => {
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
