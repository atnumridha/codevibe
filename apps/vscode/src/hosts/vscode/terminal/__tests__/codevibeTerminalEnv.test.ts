import type { ExecuteCommandInTerminalRequest } from "@/shared/proto/host/workspace"
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import * as sinon from "sinon"
import * as vscode from "vscode"
import { executeCommandInTerminal } from "../../hostbridge/workspace/executeCommandInTerminal"
import { VscodeTerminalManager } from "../VscodeTerminalManager"
import { TerminalRegistry } from "../VscodeTerminalRegistry"
import { createCodeVibeTerminalOptions, getCodeVibeTerminalEnv, getCodeVibeTerminalEnvSignature } from "../codevibeTerminalEnv"

describe("Codie terminal environment", () => {
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("marks extension-created terminals as Codie while preserving legacy shell compatibility", () => {
		const env = getCodeVibeTerminalEnv()

		env.should.have.property("CODEVIBE_ACTIVE", "true")
		env.should.have.property("CLINE_ACTIVE", "true")
		env.should.have.property("CODEVIBE_TERMINAL_RUN_MODE", "default")
		env.should.have.property("CODEVIBE_TERMINAL_SANDBOX", "0")
		env.should.have.property("CODEVIBE_TERMINAL_ELEVATED", "0")
		env.should.have.property("CODEVIBE_TERMINAL_BACKGROUND", "0")
		env.should.have.property("CODEVIBE_TERMINAL_SANDBOX_ENFORCEMENT", "none")
	})

	it("marks VS Code terminal options with selected run-mode metadata", () => {
		const options = createCodeVibeTerminalOptions({
			cwd: "/tmp",
			executionOptions: { terminalRunMode: "elevated" },
		})
		const env = options.env as Record<string, string>

		env.should.have.property("CODEVIBE_TERMINAL_RUN_MODE", "elevated")
		env.should.have.property("CODEVIBE_TERMINAL_ELEVATED", "1")
		env.should.have.property("CODEVIBE_TERMINAL_SANDBOX", "0")
	})

	it("creates shared terminal options for agent terminals", () => {
		const options = createCodeVibeTerminalOptions({ cwd: "/tmp", shellPath: "/bin/zsh" })
		const env = options.env as Record<string, string>

		;(options.name as string).should.equal("Codie")
		;(options.cwd as string).should.equal("/tmp")
		;(options.shellPath as string).should.equal("/bin/zsh")
		env.should.have.property("CODEVIBE_ACTIVE", "true")
		env.should.have.property("CLINE_ACTIVE", "true")
	})

	it("uses the shared Codie environment for registry terminals", () => {
		const terminal = { exitStatus: undefined } as vscode.Terminal
		const createTerminal = sandbox.stub(vscode.window, "createTerminal").returns(terminal)

		const info = TerminalRegistry.createTerminal("/tmp", "/bin/zsh")
		const options = createTerminal.firstCall.args[0] as vscode.TerminalOptions
		const env = options.env as Record<string, string>

		;(info.terminal as vscode.Terminal).should.equal(terminal)
		;(options.name as string).should.equal("Codie")
		;(options.cwd as string).should.equal("/tmp")
		;(options.shellPath as string).should.equal("/bin/zsh")
		env.should.have.property("CODEVIBE_ACTIVE", "true")
		env.should.have.property("CLINE_ACTIVE", "true")
		env.should.have.property("CODEVIBE_TERMINAL_RUN_MODE", "default")

		TerminalRegistry.removeTerminal(info.id)
	})

	it("keeps separate registry terminals for different terminal trust boundaries", () => {
		const defaultTerminal = { exitStatus: undefined } as vscode.Terminal
		const elevatedTerminal = { exitStatus: undefined } as vscode.Terminal
		const createTerminal = sandbox.stub(vscode.window, "createTerminal")
		createTerminal.onFirstCall().returns(defaultTerminal)
		createTerminal.onSecondCall().returns(elevatedTerminal)

		const defaultInfo = TerminalRegistry.createTerminal("/tmp", "/bin/zsh")
		const elevatedInfo = TerminalRegistry.createTerminal("/tmp", "/bin/zsh", { terminalRunMode: "elevated" })

		defaultInfo.terminalEnvSignature.should.equal(getCodeVibeTerminalEnvSignature())
		elevatedInfo.terminalEnvSignature.should.equal(getCodeVibeTerminalEnvSignature({ terminalRunMode: "elevated" }))
		defaultInfo.terminalEnvSignature.should.not.equal(elevatedInfo.terminalEnvSignature)

		TerminalRegistry.removeTerminal(defaultInfo.id)
		TerminalRegistry.removeTerminal(elevatedInfo.id)
	})

	it("does not reuse a VS Code terminal across different trust boundaries", async () => {
		const cwd = vscode.Uri.file("/tmp")
		const defaultTerminal = { exitStatus: undefined, shellIntegration: { cwd } } as vscode.Terminal
		const elevatedTerminal = { exitStatus: undefined, shellIntegration: { cwd } } as vscode.Terminal
		const createTerminal = sandbox.stub(vscode.window, "createTerminal")
		createTerminal.onFirstCall().returns(defaultTerminal)
		createTerminal.onSecondCall().returns(elevatedTerminal)
		const manager = new VscodeTerminalManager()

		const defaultInfo = await manager.getOrCreateTerminal("/tmp")
		const elevatedInfo = await manager.getOrCreateTerminal("/tmp", { terminalRunMode: "elevated" })

		;(defaultInfo.terminal as unknown as vscode.Terminal).should.equal(defaultTerminal)
		;(elevatedInfo.terminal as unknown as vscode.Terminal).should.equal(elevatedTerminal)
		createTerminal.calledTwice.should.equal(true)

		manager.disposeAll()
		TerminalRegistry.removeTerminal(defaultInfo.id)
		TerminalRegistry.removeTerminal(elevatedInfo.id)
	})

	it("uses the shared Codie environment for hostbridge command terminals", async () => {
		const terminal = {
			show: sandbox.stub(),
			sendText: sandbox.stub(),
		} as unknown as vscode.Terminal
		const createTerminal = sandbox.stub(vscode.window, "createTerminal").returns(terminal)

		const response = await executeCommandInTerminal({ command: "echo hi" } as ExecuteCommandInTerminalRequest)
		const options = createTerminal.firstCall.args[0] as vscode.TerminalOptions
		const env = options.env as Record<string, string>

		response.success.should.equal(true)
		;(options.name as string).should.equal("Codie")
		env.should.have.property("CODEVIBE_ACTIVE", "true")
		env.should.have.property("CLINE_ACTIVE", "true")
		env.should.have.property("CODEVIBE_TERMINAL_RUN_MODE", "default")
		;(terminal.show as sinon.SinonStub).calledOnce.should.equal(true)
		;(terminal.sendText as sinon.SinonStub).calledOnceWithExactly("echo hi", true).should.equal(true)
	})
})
