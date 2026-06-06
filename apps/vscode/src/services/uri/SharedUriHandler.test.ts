import { expect } from "chai"
import * as fs from "fs/promises"
import { afterEach, beforeEach, describe, it } from "mocha"
import os from "os"
import path from "path"
import * as sinon from "sinon"
import { WebviewProvider } from "@/core/webview"
import { HostProvider } from "@/hosts/host-provider"
import * as webhookHooks from "@/services/lg-cns-integration/webhook-hooks"
import { Logger } from "@/shared/services/Logger"
import { ErrorService } from "../error"
import { SharedUriHandler } from "./SharedUriHandler"

function encodeConfig(config: Record<string, unknown>): string {
	return Buffer.from(JSON.stringify(config), "utf8")
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "")
}

describe("SharedUriHandler", () => {
	let sandbox: sinon.SinonSandbox
	let handleOpenRouterCallbackStub: sinon.SinonStub
	let handleAuthCallbackStub: sinon.SinonStub
	let handleTaskCreationStub: sinon.SinonStub
	let handleCursorBackgroundAgentLaunchStub: sinon.SinonStub
	let handleMcpOAuthCallbackStub: sinon.SinonStub
	let addServerFromConfigStub: sinon.SinonStub
	let postStateToWebviewStub: sinon.SinonStub
	let showMessageStub: sinon.SinonStub
	let openSettingsStub: sinon.SinonStub
	let openFileStub: sinon.SinonStub

	beforeEach(async () => {
		sandbox = sinon.createSandbox()

		// Mock Logger methods to avoid HostProvider dependency
		sandbox.stub(Logger, "info").returns()
		sandbox.stub(Logger, "warn").returns()
		sandbox.stub(Logger, "error").returns()
		// Mock ErrorService to avoid telemetry dependency
		const mockErrorService = {
			logMessage: sandbox.stub(),
			logException: sandbox.stub(),
			toClineError: sandbox.stub(),
			isEnabled: sandbox.stub().returns(false),
			getSettings: sandbox.stub().returns({ enabled: false, hostEnabled: false }),
			getProvider: sandbox.stub(),
			dispose: sandbox.stub().resolves(),
		}
		sandbox.stub(ErrorService, "initialize").resolves(mockErrorService as any)
		sandbox.stub(ErrorService, "get").returns(mockErrorService as any)

		await ErrorService.initialize()

		handleOpenRouterCallbackStub = sandbox.stub().resolves()
		handleAuthCallbackStub = sandbox.stub().resolves()
		handleTaskCreationStub = sandbox.stub().resolves()
		handleCursorBackgroundAgentLaunchStub = sandbox.stub().resolves()
		handleMcpOAuthCallbackStub = sandbox.stub().resolves()
		addServerFromConfigStub = sandbox.stub().resolves([])
		postStateToWebviewStub = sandbox.stub().resolves()
		showMessageStub = sandbox.stub()
		showMessageStub.onFirstCall().resolves({ selectedOption: "Install" })
		showMessageStub.resolves({ selectedOption: undefined })
		openSettingsStub = sandbox.stub().resolves({})
		openFileStub = sandbox.stub().resolves({})
		const mockWebviewProvider = {
			controller: {
				handleOpenRouterCallback: handleOpenRouterCallbackStub,
				handleAuthCallback: handleAuthCallbackStub,
				handleTaskCreation: handleTaskCreationStub,
				handleCursorBackgroundAgentLaunch: handleCursorBackgroundAgentLaunchStub,
				handleMcpOAuthCallback: handleMcpOAuthCallbackStub,
				postStateToWebview: postStateToWebviewStub,
				stateManager: {
					getWorkspaceStateKey: sandbox.stub().returns({}),
					setWorkspaceState: sandbox.stub(),
				},
				mcpHub: {
					addServerFromConfig: addServerFromConfigStub,
				},
			},
		} as any
		sandbox.stub(WebviewProvider, "getVisibleInstance").returns(mockWebviewProvider)
		sandbox.stub(WebviewProvider, "getInstance").returns(mockWebviewProvider)
		sandbox.stub(HostProvider, "window").get(
			() =>
				({
					showMessage: showMessageStub,
					openSettings: openSettingsStub,
					openFile: openFileStub,
				}) as any,
		)
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("handleUri", () => {
		describe("OpenRouter callback handling", () => {
			it("should successfully handle OpenRouter callback with code", async () => {
				const result = await SharedUriHandler.handleUri("vscode://cline.cline/openrouter?code=test123")

				expect(result).to.be.true
				sinon.assert.calledOnceWithExactly(handleOpenRouterCallbackStub, "test123")
			})

			it("should return false when OpenRouter code is missing", async () => {
				const result = await SharedUriHandler.handleUri("vscode://cline.cline/openrouter")

				expect(result).to.be.false
				expect(handleOpenRouterCallbackStub.called).to.be.false
			})

			it("should handle URL with plus signs in code parameter", async () => {
				const result = await SharedUriHandler.handleUri("vscode://cline.cline/openrouter?code=test+123+abc")

				expect(result).to.be.true
				// Plus signs in query params are preserved
				sinon.assert.calledOnceWithExactly(handleOpenRouterCallbackStub, "test+123+abc")
			})
		})

		describe("Auth callback handling", () => {
			it("should successfully handle auth callback with idToken", async () => {
				const result = await SharedUriHandler.handleUri("vscode://cline.cline/auth?idToken=jwt123&provider=google")

				expect(result).to.be.true
				sinon.assert.calledOnceWithExactly(handleAuthCallbackStub, "jwt123", "google")
			})

			it("should successfully handle auth callback without provider", async () => {
				const result = await SharedUriHandler.handleUri("vscode://cline.cline/auth?idToken=jwt123")

				expect(result).to.be.true
				sinon.assert.calledOnceWithExactly(handleAuthCallbackStub, "jwt123", null)
			})

			it("should return false when idToken is missing", async () => {
				const result = await SharedUriHandler.handleUri("vscode://cline.cline/auth?provider=google")

				expect(result).to.be.false
				expect(handleAuthCallbackStub.called).to.be.false
			})
		})

		describe("Unknown path handling", () => {
			it("should return false for unknown paths", async () => {
				const result = await SharedUriHandler.handleUri("vscode://cline.cline/unknown?param=value")

				expect(result).to.be.false
				expect(handleAuthCallbackStub.called).to.be.false
				expect(handleOpenRouterCallbackStub.called).to.be.false
			})
		})

		describe("Cursor-compatible route handling", () => {
			it("should create a task from a Cursor createchat route", async () => {
				const result = await SharedUriHandler.handleUri("vscode://cline.cline/createchat?prompt=Review%20the%20diff")

				expect(result).to.be.true
				sinon.assert.calledOnceWithExactly(handleTaskCreationStub, "Review the diff")
			})

			it("should confirm and install a Cursor MCP install route", async () => {
				const result = await SharedUriHandler.handleUri(
					"vscode://cline.cline/mcp/install?name=docs&url=https%3A%2F%2Fmcp.example.com",
				)

				expect(result).to.be.true
				expect(showMessageStub.firstCall.args[0].message).to.equal('Install MCP server "docs"?')
				sinon.assert.calledOnce(addServerFromConfigStub)
				expect(addServerFromConfigStub.firstCall.args[0]).to.equal("docs")
				expect(addServerFromConfigStub.firstCall.args[1]).to.deep.include({
					type: "streamableHttp",
					url: "https://mcp.example.com",
				})
				sinon.assert.calledOnce(postStateToWebviewStub)
				expect(handleTaskCreationStub.called).to.be.false
			})

			it("should install a Cursor MCP route with a bare named-server config map", async () => {
				const config = encodeConfig({
					postgres: {
						command: "node",
						args: ["postgres-mcp.js"],
						env: { POSTGRES_TOKEN: "secret" },
					},
				})

				const result = await SharedUriHandler.handleUri(
					`vscode://cline.cline/mcp/install?name=postgres&config=${config}`,
				)

				expect(result).to.be.true
				expect(showMessageStub.firstCall.args[0].message).to.equal('Install MCP server "postgres"?')
				expect(showMessageStub.firstCall.args[0].options.detail).to.contain("Environment keys: POSTGRES_TOKEN")
				expect(showMessageStub.firstCall.args[0].options.detail).not.to.contain("secret")
				sinon.assert.calledOnce(addServerFromConfigStub)
				expect(addServerFromConfigStub.firstCall.args[0]).to.equal("postgres")
				expect(addServerFromConfigStub.firstCall.args[1]).to.deep.include({
					type: "stdio",
					command: "node",
				})
				expect(addServerFromConfigStub.firstCall.args[1].args).to.deep.equal(["postgres-mcp.js"])
				expect(handleTaskCreationStub.called).to.be.false
			})

			it("should not install a Cursor MCP route when confirmation is cancelled", async () => {
				showMessageStub.resetBehavior()
				showMessageStub.resolves({ selectedOption: undefined })

				const result = await SharedUriHandler.handleUri(
					"vscode://cline.cline/mcp/install?name=docs&url=https%3A%2F%2Fmcp.example.com",
				)

				expect(result).to.be.true
				expect(addServerFromConfigStub.called).to.be.false
				expect(handleTaskCreationStub.called).to.be.false
			})

			it("should launch Cursor background-agent routes through the controller background path", async () => {
				const result = await SharedUriHandler.handleUri(
					"vscode://cline.cline/background-agent?task=Fix%20the%20queue&repository=owner%2Frepo&branch=main",
				)

				expect(result).to.be.true
				sinon.assert.calledOnce(handleCursorBackgroundAgentLaunchStub)
				expect(handleTaskCreationStub.called).to.be.false
				const launchRequest = handleCursorBackgroundAgentLaunchStub.firstCall.args[0]
				expect(launchRequest.prompt).to.equal("Fix the queue")
				expect(launchRequest.repository).to.equal("owner/repo")
				expect(launchRequest.requestedBranch).to.equal("main")
				expect(launchRequest.routePrompt).to.contain("Cursor-compatible background agent deeplink")
			})

			it("should open settings routes directly through the host", async () => {
				const result = await SharedUriHandler.handleUri(
					"vscode://cline.cline/settings?query=%40id%3Acline.apiProvider",
				)

				expect(result).to.be.true
				sinon.assert.calledOnceWithExactly(openSettingsStub, { query: "@id:cline.apiProvider" })
				expect(handleTaskCreationStub.called).to.be.false
			})

			it("should confirm safe Cursor rule routes without creating a task", async () => {
				showMessageStub.resetBehavior()
				showMessageStub.resolves({ selectedOption: undefined })

				const result = await SharedUriHandler.handleUri("vscode://cline.cline/rule?name=team-style")

				expect(result).to.be.true
				expect(showMessageStub.firstCall.args[0].message).to.equal('Create or open Cursor rule "team-style.mdc"?')
				expect(handleTaskCreationStub.called).to.be.false
				expect(openFileStub.called).to.be.false
			})

			it("should route Cursor rule content payloads through task review", async () => {
				const result = await SharedUriHandler.handleUri(
					"vscode://cline.cline/rule?name=team-style&content=Use%20short%20commits",
				)

				expect(result).to.be.true
				sinon.assert.calledOnce(handleTaskCreationStub)
				expect(handleTaskCreationStub.firstCall.args[0]).to.contain("Cursor-compatible rule deeplink")
				expect(openFileStub.called).to.be.false
			})

			it("should reject invalid Cursor command routes", async () => {
				const result = await SharedUriHandler.handleUri("vscode://cline.cline/command?extra=value")

				expect(result).to.be.false
				expect(handleTaskCreationStub.called).to.be.false
			})

			it("should ignore Cursor-compatible routes when disabled", async () => {
				const result = await SharedUriHandler.handleUri("vscode://cline.cline/createchat?prompt=Hello", {
					cursorCompatibleDeepLinksEnabled: false,
				})

				expect(result).to.be.false
				expect(handleTaskCreationStub.called).to.be.false
			})
		})

		describe("MCP OAuth callback handling", () => {
			it("should handle MCP OAuth callbacks with code and state", async () => {
				const result = await SharedUriHandler.handleUri(
					"vscode://cline.cline/mcp-auth/callback/hash123?code=code123&state=state123",
				)

				expect(result).to.be.true
				sinon.assert.calledOnceWithExactly(handleMcpOAuthCallbackStub, "hash123", "code123", "state123")
			})

			it("should reject MCP OAuth callbacks without state", async () => {
				const result = await SharedUriHandler.handleUri(
					"vscode://cline.cline/mcp-auth/callback/hash123?code=code123",
				)

				expect(result).to.be.false
				expect(handleMcpOAuthCallbackStub.called).to.be.false
			})
		})

		describe("LG task URI handling", () => {
			it("should setup webhook files and create task from prompt-file", async () => {
				const webhookUrl = "https://example.com/api/updates"
				const webhookToken = "token-123"
				const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lg-task-uri-"))
				try {
					const promptFilePath = path.join(tempDir, "lg-spec.md")
					await fs.writeFile(promptFilePath, "Implement user registration flow", "utf-8")

					const writeConfigStub = sandbox.stub(webhookHooks, "writeLgWebhookConfig").resolves()
					const writeHooksStub = sandbox.stub(webhookHooks, "writeLgWebhookHooks").resolves()

					const result = await SharedUriHandler.handleUri(
						`vscode://cline.cline/lg-task?prompt-file=${encodeURIComponent(
							promptFilePath,
						)}&webhook-url=${encodeURIComponent(webhookUrl)}&webhook-token=${encodeURIComponent(webhookToken)}`,
					)

					expect(result).to.be.true
					sinon.assert.calledOnce(handleTaskCreationStub)
					const taskPrompt = handleTaskCreationStub.firstCall.args[0] as string
					expect(taskPrompt).to.contain(promptFilePath)
					expect(taskPrompt).to.contain("Implement user registration flow")
					expect(taskPrompt).to.contain("re-read")
					sinon.assert.calledOnceWithExactly(writeConfigStub, webhookUrl, webhookToken)
					sinon.assert.calledOnce(writeHooksStub)
				} finally {
					await fs.rm(tempDir, { recursive: true, force: true })
				}
			})

			it("should return false when LG task parameters are missing", async () => {
				const writeConfigStub = sandbox.stub(webhookHooks, "writeLgWebhookConfig").resolves()
				const writeHooksStub = sandbox.stub(webhookHooks, "writeLgWebhookHooks").resolves()
				const result = await SharedUriHandler.handleUri(
					"vscode://cline.cline/lg-task?prompt-file=%2Ftmp%2Fspec.md&webhook-url=https%3A%2F%2Fexample.com",
				)

				expect(result).to.be.false
				expect(handleTaskCreationStub.called).to.be.false
				expect(writeConfigStub.called).to.be.false
				expect(writeHooksStub.called).to.be.false
			})
		})

		describe("Error handling", () => {
			it("should catch and log errors from controller methods", async () => {
				handleOpenRouterCallbackStub.rejects(new Error("Controller error"))

				const result = await SharedUriHandler.handleUri("vscode://cline.cline/openrouter?code=test123")

				expect(result).to.be.false
			})

			it("should handle malformed URIs gracefully", async () => {
				const result = await SharedUriHandler.handleUri("invalid://uri")

				expect(result).to.be.false
				expect(handleAuthCallbackStub.called).to.be.false
				expect(handleOpenRouterCallbackStub.called).to.be.false
			})
		})

		describe("Query parameter parsing", () => {
			it("should correctly parse multiple query parameters", async () => {
				const result = await SharedUriHandler.handleUri(
					"vscode://cline.cline/auth?idToken=jwt123&provider=github&extra=param",
				)

				expect(result).to.be.true
				sinon.assert.calledOnceWithExactly(handleAuthCallbackStub, "jwt123", "github")
			})

			it("should handle URL-encoded parameters", async () => {
				const result = await SharedUriHandler.handleUri(
					"vscode://cline.cline/auth?idToken=jwt%20with%20spaces&provider=google",
				)

				expect(result).to.be.true
				// URLSearchParams should decode %20 to spaces
				sinon.assert.calledOnceWithExactly(handleAuthCallbackStub, "jwt with spaces", "google")
			})

			it("should handle empty query string", async () => {
				const result = await SharedUriHandler.handleUri("vscode://cline.cline/openrouter")

				expect(result).to.be.false
				expect(handleAuthCallbackStub.called).to.be.false
				expect(handleOpenRouterCallbackStub.called).to.be.false
			})
		})

		describe("Different URI schemes", () => {
			it("should handle HTTP scheme URIs", async () => {
				const result = await SharedUriHandler.handleUri("http://localhost:3000/openrouter?code=test123")

				expect(result).to.be.true
				sinon.assert.calledOnceWithExactly(handleOpenRouterCallbackStub, "test123")
			})

			it("should handle HTTPS scheme URIs", async () => {
				const result = await SharedUriHandler.handleUri("https://example.com/auth?idToken=jwt123&provider=github")

				expect(result).to.be.true
				sinon.assert.calledOnceWithExactly(handleAuthCallbackStub, "jwt123", "github")
			})
		})
	})
})
