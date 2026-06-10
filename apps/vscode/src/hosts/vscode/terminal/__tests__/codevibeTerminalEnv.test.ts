import { ExecuteCommandInTerminalRequest } from "@shared/proto/host/workspace"
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import * as sinon from "sinon"
import * as vscode from "vscode"
import { executeCommandInTerminal } from "../../hostbridge/workspace/executeCommandInTerminal"
import { TerminalRegistry } from "../VscodeTerminalRegistry"
import { createCodeVibeTerminalOptions, getCodeVibeTerminalEnv } from "../codevibeTerminalEnv"

describe("CodeVibe terminal environment", () => {
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
	})

	afterEach(() => {
		sandbox.restore()
	})

	it("marks extension-created terminals as CodeVibe while preserving legacy shell compatibility", () => {
		const env = getCodeVibeTerminalEnv()

		env.should.have.property("CODEVIBE_ACTIVE", "true")
		env.should.have.property("CLINE_ACTIVE", "true")
	})

	it("creates shared terminal options for agent terminals", () => {
		const options = createCodeVibeTerminalOptions({ cwd: "/tmp", shellPath: "/bin/zsh" })
		const env = options.env as Record<string, string>

		;(options.name as string).should.equal("CodeVibe")
		;(options.cwd as string).should.equal("/tmp")
		;(options.shellPath as string).should.equal("/bin/zsh")
		env.should.have.property("CODEVIBE_ACTIVE", "true")
		env.should.have.property("CLINE_ACTIVE", "true")
	})

	it("uses the shared CodeVibe environment for registry terminals", () => {
		const terminal = { exitStatus: undefined } as vscode.Terminal
		const createTerminal = sandbox.stub(vscode.window, "createTerminal").returns(terminal)

		const info = TerminalRegistry.createTerminal("/tmp", "/bin/zsh")
		const options = createTerminal.firstCall.args[0] as vscode.TerminalOptions
		const env = options.env as Record<string, string>

		;(info.terminal as vscode.Terminal).should.equal(terminal)
		;(options.name as string).should.equal("CodeVibe")
		;(options.cwd as string).should.equal("/tmp")
		;(options.shellPath as string).should.equal("/bin/zsh")
		env.should.have.property("CODEVIBE_ACTIVE", "true")
		env.should.have.property("CLINE_ACTIVE", "true")

		TerminalRegistry.removeTerminal(info.id)
	})

	it("uses the shared CodeVibe environment for hostbridge command terminals", async () => {
		const terminal = {
			show: sandbox.stub(),
			sendText: sandbox.stub(),
		} as unknown as vscode.Terminal
		const createTerminal = sandbox.stub(vscode.window, "createTerminal").returns(terminal)

		const response = await executeCommandInTerminal({ command: "echo hi" } as ExecuteCommandInTerminalRequest)
		const options = createTerminal.firstCall.args[0] as vscode.TerminalOptions
		const env = options.env as Record<string, string>

		response.success.should.equal(true)
		;(options.name as string).should.equal("CodeVibe")
		env.should.have.property("CODEVIBE_ACTIVE", "true")
		env.should.have.property("CLINE_ACTIVE", "true")
		;(terminal.show as sinon.SinonStub).calledOnce.should.equal(true)
		;(terminal.sendText as sinon.SinonStub).calledOnceWithExactly("echo hi", true).should.equal(true)
	})
})
