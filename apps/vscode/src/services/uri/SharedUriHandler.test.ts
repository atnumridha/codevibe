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
	let workspaceDir: string

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-uri-workspace-"))

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
		sandbox.stub(HostProvider, "workspace").value({
			getWorkspacePaths: sandbox.stub().resolves({ paths: [workspaceDir] }),
		})
	})

	afterEach(async () => {
		sandbox.restore()
		if (workspaceDir) {
			await fs.rm(workspaceDir, { recursive: true, force: true })
		}
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
				showMessageStub.resetBehavior()
				showMessageStub.resolves({ selectedOption: "Launch" })
				const config = encodeConfig({
					token: "secret-value",
					mode: "fast",
				})

				const result = await SharedUriHandler.handleUri(
					`vscode://cline.cline/background-agent?task=Fix%20the%20queue&repository=owner%2Frepo&branch=main&config=${config}`,
				)

				expect(result).to.be.true
				expect(showMessageStub.firstCall.args[0].message).to.equal("Launch Cursor background agent?")
				expect(showMessageStub.firstCall.args[0].options.detail).to.contain("Repository: owner/repo")
				expect(showMessageStub.firstCall.args[0].options.detail).to.contain("Branch: main")
				expect(showMessageStub.firstCall.args[0].options.detail).to.contain("Config keys: mode, token")
				expect(showMessageStub.firstCall.args[0].options.detail).not.to.contain("secret-value")
				sinon.assert.calledOnce(handleCursorBackgroundAgentLaunchStub)
				expect(handleTaskCreationStub.called).to.be.false
				const launchRequest = handleCursorBackgroundAgentLaunchStub.firstCall.args[0]
				expect(launchRequest.prompt).to.equal("Fix the queue")
				expect(launchRequest.repository).to.equal("owner/repo")
				expect(launchRequest.requestedBranch).to.equal("main")
				expect(launchRequest.routePrompt).to.contain("Cursor-compatible background agent deeplink")
			})

			it("should not launch Cursor background-agent routes when confirmation is cancelled", async () => {
				showMessageStub.resetBehavior()
				showMessageStub.resolves({ selectedOption: undefined })

				const result = await SharedUriHandler.handleUri(
					"vscode://cline.cline/background-agent?task=Fix%20the%20queue&repository=owner%2Frepo&branch=main",
				)

				expect(result).to.be.true
				expect(showMessageStub.firstCall.args[0].message).to.equal("Launch Cursor background agent?")
				expect(handleCursorBackgroundAgentLaunchStub.called).to.be.false
				expect(handleTaskCreationStub.called).to.be.false
			})

			it("should open settings routes directly through the host", async () => {
				const result = await SharedUriHandler.handleUri(
					"vscode://cline.cline/settings?query=%40id%3Acline.apiProvider",
				)

				expect(result).to.be.true
				sinon.assert.calledOnceWithExactly(openSettingsStub, { query: "@id:cline.apiProvider" })
				expect(handleTaskCreationStub.called).to.be.false
			})

			it("should handle Cursor plugin add routes explicitly without creating a task", async () => {
				const result = await SharedUriHandler.handleUri("vscode://cline.cline/plugin/add?id=docs-helper")

				expect(result).to.be.true
				expect(showMessageStub.firstCall.args[0].message).to.equal("Cursor plugin add requested: docs-helper")
				expect(showMessageStub.firstCall.args[0].options.detail).to.contain("Install with CLI")
				expect(handleTaskCreationStub.called).to.be.false
			})

			it("should summarize Cursor plugin config routes without leaking secret values", async () => {
				const config = encodeConfig({
					token: "secret-value",
					source: "docs-helper",
				})

				const result = await SharedUriHandler.handleUri(`vscode://cline.cline/plugin/add?config=${config}`)

				expect(result).to.be.true
				expect(showMessageStub.firstCall.args[0].message).to.equal("Cursor plugin add requires review")
				expect(showMessageStub.firstCall.args[0].options.detail).to.contain("Config keys: source, token")
				expect(showMessageStub.firstCall.args[0].options.detail).not.to.contain("secret-value")
				expect(handleTaskCreationStub.called).to.be.false
			})

			it("should confirm Cursor PR review routes before creating a task", async () => {
				showMessageStub.resetBehavior()
				showMessageStub.resolves({ selectedOption: "Start Review" })

				const result = await SharedUriHandler.handleUri(
					"vscode://cline.cline/pr-review?repo=owner%2Frepo&number=42&instructions=focus%20tests",
				)

				expect(result).to.be.true
				expect(showMessageStub.firstCall.args[0].message).to.equal("Start Cursor PR review?")
				expect(showMessageStub.firstCall.args[0].options.detail).to.contain("owner/repo#42")
				expect(showMessageStub.firstCall.args[0].options.detail).to.contain("focus tests")
				sinon.assert.calledOnce(handleTaskCreationStub)
				expect(handleTaskCreationStub.firstCall.args[0]).to.contain("pull request review")
				expect(handleTaskCreationStub.firstCall.args[0]).to.contain("repo: owner/repo")
			})

			it("should not create a task when Cursor PR review confirmation is cancelled", async () => {
				showMessageStub.resetBehavior()
				showMessageStub.resolves({ selectedOption: undefined })

				const result = await SharedUriHandler.handleUri(
					"vscode://cline.cline/pr-review?url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Fpull%2F42",
				)

				expect(result).to.be.true
				expect(showMessageStub.firstCall.args[0].message).to.equal("Start Cursor PR review?")
				expect(handleTaskCreationStub.called).to.be.false
			})

			it("should summarize Cursor PR review config without leaking secret values", async () => {
				showMessageStub.resetBehavior()
				showMessageStub.resolves({ selectedOption: undefined })
				const config = encodeConfig({
					token: "secret-value",
					source: "github",
				})

				const result = await SharedUriHandler.handleUri(
					`vscode://cline.cline/pr-review?repo=owner%2Frepo&number=42&config=${config}`,
				)

				expect(result).to.be.true
				expect(showMessageStub.firstCall.args[0].options.detail).to.contain("Config keys: source, token")
				expect(showMessageStub.firstCall.args[0].options.detail).not.to.contain("secret-value")
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

			it("should create a task from a Cursor custom command file", async () => {
				const commandsDir = path.join(workspaceDir, ".cursor", "commands")
				await fs.mkdir(commandsDir, { recursive: true })
				await fs.writeFile(
					path.join(commandsDir, "review-code.md"),
					"Review the staged diff and call out risky changes.",
					"utf8",
				)

				const result = await SharedUriHandler.handleUri("vscode://cline.cline/command?name=review-code")

				expect(result).to.be.true
				sinon.assert.calledOnce(handleTaskCreationStub)
				const prompt = handleTaskCreationStub.firstCall.args[0]
				expect(prompt).to.contain('A Cursor-compatible command deeplink named "review-code" was opened.')
				expect(prompt).to.contain(".cursor/commands/review-code.md")
				expect(prompt).to.contain("Review the staged diff and call out risky changes.")
				expect(prompt).to.contain("normal permission boundaries")
				expect(prompt).not.to.contain("```sh")
			})

			it("should fall back to a review prompt when a Cursor command file is missing", async () => {
				const result = await SharedUriHandler.handleUri("vscode://cline.cline/command?name=missing-command")

				expect(result).to.be.true
				sinon.assert.calledOnce(handleTaskCreationStub)
				const prompt = handleTaskCreationStub.firstCall.args[0]
				expect(prompt).to.contain('Cursor-compatible command deeplink named "missing-command"')
				expect(prompt).to.contain("Route details:")
			})

			it("should not read Cursor command files for unsafe command names", async () => {
				const commandsDir = path.join(workspaceDir, ".cursor", "commands")
				await fs.mkdir(commandsDir, { recursive: true })
				await fs.writeFile(path.join(commandsDir, "secret.md"), "SHOULD_NOT_LOAD", "utf8")

				const result = await SharedUriHandler.handleUri("vscode://cline.cline/command?name=..%2Fsecret")

				expect(result).to.be.true
				sinon.assert.calledOnce(handleTaskCreationStub)
				expect(handleTaskCreationStub.firstCall.args[0]).not.to.contain("SHOULD_NOT_LOAD")
			})

			it("should not read symlinked Cursor command files", async () => {
				const commandsDir = path.join(workspaceDir, ".cursor", "commands")
				await fs.mkdir(commandsDir, { recursive: true })
				const targetPath = path.join(workspaceDir, "outside-command.md")
				await fs.writeFile(targetPath, "SHOULD_NOT_LOAD", "utf8")
				await fs.symlink(targetPath, path.join(commandsDir, "review-code.md"))

				const result = await SharedUriHandler.handleUri("vscode://cline.cline/command?name=review-code")

				expect(result).to.be.true
				sinon.assert.calledOnce(handleTaskCreationStub)
				const prompt = handleTaskCreationStub.firstCall.args[0]
				expect(prompt).to.contain('Cursor-compatible command deeplink named "review-code"')
				expect(prompt).not.to.contain("SHOULD_NOT_LOAD")
			})

			it("should not read dot-only Cursor command names", async () => {
				const commandsDir = path.join(workspaceDir, ".cursor", "commands")
				await fs.mkdir(commandsDir, { recursive: true })
				await fs.writeFile(path.join(commandsDir, ".md"), "SHOULD_NOT_LOAD", "utf8")

				const result = await SharedUriHandler.handleUri("vscode://cline.cline/command?name=.")

				expect(result).to.be.true
				sinon.assert.calledOnce(handleTaskCreationStub)
				expect(handleTaskCreationStub.firstCall.args[0]).not.to.contain("SHOULD_NOT_LOAD")
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
