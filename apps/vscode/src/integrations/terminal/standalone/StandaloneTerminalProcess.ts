/**
 * StandaloneTerminalProcess - Manages command execution in standalone environments.
 *
 * This class handles subprocess management for terminal commands when running
 * outside of VSCode (CLI, JetBrains). It spawns child processes and streams
 * their output through events.
 *
 * Implements ITerminalProcess interface for polymorphic usage with CommandExecutor.
 */

import { telemetryService } from "@services/telemetry"
import { ChildProcess, spawn } from "child_process"
import { EventEmitter } from "events"
import { existsSync } from "fs"
import { terminateProcessTree } from "@/utils/process-termination"

import {
	isCompilingOutput,
	MAX_FULL_OUTPUT_SIZE,
	MAX_UNRETRIEVED_LINES,
	PROCESS_HOT_TIMEOUT_COMPILING,
	PROCESS_HOT_TIMEOUT_NORMAL,
	TRUNCATE_KEEP_LINES,
} from "../constants"
import type {
	CommandExecutionOptions,
	ITerminal,
	ITerminalProcess,
	TerminalCompletionDetails,
	TerminalProcessEvents,
} from "../types"
import {
	buildCodeVibeTerminalPolicyEnv,
	type TerminalSandboxEnforcement,
} from "../terminalPolicyEnv"

const MACOS_SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec"

export type StandaloneSandboxEnforcement = TerminalSandboxEnforcement

export interface StandaloneTerminalSpawnPlan {
	command: string
	args: string[]
	detached: boolean
	shell?: boolean
	sandboxEnforcement: StandaloneSandboxEnforcement
}

export interface StandaloneSandboxRuntime {
	platform?: NodeJS.Platform
	sandboxExecPath?: string
	pathExists?: (filePath: string) => boolean
	tmpDir?: string
}

export { buildCodeVibeTerminalPolicyEnv } from "../terminalPolicyEnv"

export function buildStandaloneTerminalSpawnPlan(
	shell: string,
	shellArgs: string[],
	options?: CommandExecutionOptions,
	runtime: StandaloneSandboxRuntime = {},
): StandaloneTerminalSpawnPlan {
	if (options?.terminalRunMode !== "sandboxed") {
		const useCmdShell = shell.toLowerCase().includes("cmd")
		return {
			command: useCmdShell ? "cmd.exe" : shell,
			args: shellArgs,
			shell: useCmdShell ? true : undefined,
			detached: !useCmdShell,
			sandboxEnforcement: "none",
		}
	}

	const policy = options.cursorSandboxPolicy
	if (!policy) {
		throw new Error(
			"Codie sandboxed terminal mode requires a resolved sandbox policy. Refusing to run without runtime enforcement.",
		)
	}
	if (policy.status !== "loaded") {
		throw new Error(
			`Codie sandboxed terminal mode requires a valid sandbox policy. ${policy.error ?? "The current policy is invalid."}`,
		)
	}

	const platform = runtime.platform ?? process.platform
	if (platform !== "darwin") {
		throw new Error(
			`Codie sandboxed terminal mode is not runtime-enforced on ${platform}. Refusing to run unrestricted.`,
		)
	}

	const sandboxExecPath = runtime.sandboxExecPath ?? MACOS_SANDBOX_EXEC_PATH
	const pathExists = runtime.pathExists ?? existsSync
	if (!pathExists(sandboxExecPath)) {
		throw new Error(
			`Codie sandboxed terminal mode requires ${sandboxExecPath}, but it is not available. Refusing to run unrestricted.`,
		)
	}

	const profile = buildMacOsSandboxProfile(options, runtime)
	return {
		command: sandboxExecPath,
		args: ["-p", profile, shell, ...shellArgs],
		detached: true,
		sandboxEnforcement: "macos-sandbox-exec",
	}
}

export function buildMacOsSandboxProfile(
	options: Pick<CommandExecutionOptions, "cursorSandboxPolicy">,
	runtime: Pick<StandaloneSandboxRuntime, "tmpDir"> = {},
): string {
	const policy = options.cursorSandboxPolicy
	if (!policy || policy.status !== "loaded") {
		throw new Error("Cannot build a macOS sandbox profile without a loaded Codie sandbox policy.")
	}
	if (
		(policy.networkPolicy.default === "deny" && policy.networkPolicy.allow.length > 0) ||
		(policy.networkPolicy.deny?.length ?? 0) > 0
	) {
		throw new Error(
			"Codie sandboxed terminal mode cannot enforce host-specific network allow or deny lists with macOS sandbox-exec. Use default allow or default deny.",
		)
	}

	const writeFilters = [
		...policy.writablePaths.map((filePath) => sandboxSubpath(filePath)),
		...(policy.disableTmpWrite
			? []
			: ["/tmp", "/private/tmp", runtime.tmpDir ?? process.env.TMPDIR]
					.filter((filePath): filePath is string => Boolean(filePath))
					.map((filePath) => sandboxSubpath(filePath))),
		sandboxLiteral("/dev/null"),
	]
	const writeRule =
		writeFilters.length > 0 ? [`(allow file-write*`, ...writeFilters.map((filter) => `  ${filter}`), `)`] : []
	const networkRule = policy.networkPolicy.default === "allow" ? ["(allow network*)"] : []

	return [
		"(version 1)",
		"(deny default)",
		"(allow process*)",
		"(allow signal (target self))",
		"(allow sysctl-read)",
		"(allow mach-lookup)",
		"(allow ipc*)",
		"(allow file-read*)",
		...writeRule,
		...networkRule,
	].join("\n")
}

function sandboxSubpath(filePath: string): string {
	return `(subpath ${quoteSandboxString(filePath)})`
}

function sandboxLiteral(filePath: string): string {
	return `(literal ${quoteSandboxString(filePath)})`
}

function quoteSandboxString(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

/**
 * Manages the execution of a command in a standalone terminal environment.
 * Extends EventEmitter to provide real-time output streaming.
 *
 * Implements ITerminalProcess for polymorphic usage with CommandExecutor.
 *
 * Events:
 * - 'line': Emitted for each line of output
 * - 'completed': Emitted when the process completes
 * - 'continue': Emitted when continue() is called
 * - 'error': Emitted on process errors
 * - 'no_shell_integration': Emitted for compatibility (never actually emitted in standalone)
 */
export class StandaloneTerminalProcess extends EventEmitter<TerminalProcessEvents> implements ITerminalProcess {
	/** We don't need to wait since we control the process directly */
	waitForShellIntegration = false

	/** Whether we're actively listening for output */
	isListening = true

	/** Buffer for incomplete lines */
	private buffer = ""

	/** Full output captured from the process */
	private fullOutput = ""

	/** Index of last retrieved output position */
	private lastRetrievedIndex = 0

	/** Whether the process is actively outputting */
	isHot = false

	/** Timer for tracking hot state */
	private hotTimer: NodeJS.Timeout | null = null

	/** The spawned child process */
	private childProcess: ChildProcess | null = null

	/** Exit code from the process */
	private exitCode: number | null = null

	/** Exit signal from the process */
	private signal: NodeJS.Signals | null = null

	/** Whether the process has completed */
	private isCompleted = false

	constructor() {
		super()
	}

	/**
	 * Run a command in the terminal.
	 * @param terminal The terminal instance to run in
	 * @param command The command to execute
	 * @param options Optional trust boundary and execution behavior for this command
	 */
	async run(terminal: ITerminal, command: string, options?: CommandExecutionOptions): Promise<void> {
		// Get shell and working directory from terminal
		const shell = (terminal as any)._shellPath || this.getDefaultShell()
		const cwd = (terminal as any)._cwd || process.cwd()

		try {
			// Prepare command for execution
			const shellArgs = this.getShellArgs(shell, command)
			const spawnPlan = buildStandaloneTerminalSpawnPlan(shell, shellArgs, options)

			// Create shell options
			const shellOptions: {
				cwd: string
				stdio: ["ignore", "pipe", "pipe"]
				env: NodeJS.ProcessEnv
				shell?: boolean
			} = {
				cwd: cwd,
				stdio: ["ignore", "pipe", "pipe"], // Disable STDIN to prevent interactivity
				env: {
					...process.env,
					TERM: "xterm-256color",
					PAGER: "cat", // Prevent less from being used, reducing interactivity
					EDITOR: process.env.EDITOR || "cat", // Set EDITOR if not already set
					GIT_PAGER: "cat", // Prevent git from using less
					SYSTEMD_PAGER: "", // Disable systemd pager
					MANPAGER: "cat", // Disable man pager
					...buildCodeVibeTerminalPolicyEnv(options, spawnPlan.sandboxEnforcement),
				},
			}

			// Spawn the process with detached: true when possible to create a process group.
			// This allows us to kill the entire process tree when terminating.
			this.childProcess = spawn(spawnPlan.command, spawnPlan.args, {
				...shellOptions,
				shell: spawnPlan.shell,
				detached: spawnPlan.detached,
			})

			// Track process state
			let didEmitEmptyLine = false

			// Handle stdout
			this.childProcess.stdout?.on("data", (data: Buffer) => {
				const output = data.toString()
				this.handleOutput(output, didEmitEmptyLine)
				if (!didEmitEmptyLine && output) {
					this.emit("line", "") // Signal start of output
					didEmitEmptyLine = true
				}
			})

			// Handle stderr
			this.childProcess.stderr?.on("data", (data: Buffer) => {
				const output = data.toString()
				this.handleOutput(output, didEmitEmptyLine)
				if (!didEmitEmptyLine && output) {
					this.emit("line", "")
					didEmitEmptyLine = true
				}
			})

			// Handle process completion
			this.childProcess.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
				this.exitCode = code
				this.signal = signal
				this.isCompleted = true
				this.emitRemainingBuffer()

				// Clear hot timer
				if (this.hotTimer) {
					clearTimeout(this.hotTimer)
					this.isHot = false
				}

				// Track terminal execution telemetry with exit code for failure diagnosis
				const success = code === 0 || code === null
				telemetryService.captureTerminalExecution(success, "standalone", "child_process", code)

				this.emit("completed", { exitCode: this.exitCode, signal: this.signal })
				this.emit("continue")
			})

			// Handle process errors (spawn failures)
			this.childProcess.on("error", (error: Error) => {
				// Track terminal execution error telemetry
				// method: "child_process_error" already indicates spawn failure
				telemetryService.captureTerminalExecution(false, "standalone", "child_process_error")
				this.emit("error", error)
			})

			// Update terminal's process reference
			;(terminal as any)._process = this.childProcess
			;(terminal as any)._processId = this.childProcess.pid
		} catch (error) {
			this.emit("error", error)
		}
	}

	/**
	 * Handle output from the process.
	 * @param data The output data
	 * @param _didEmitEmptyLine Whether we've already emitted an empty line
	 */
	private handleOutput(data: string, _didEmitEmptyLine: boolean): void {
		// Set process as hot (actively outputting)
		this.isHot = true
		if (this.hotTimer) {
			clearTimeout(this.hotTimer)
		}

		// Check for compilation markers to adjust hot timeout
		const isCompiling = isCompilingOutput(data)
		const hotTimeout = isCompiling ? PROCESS_HOT_TIMEOUT_COMPILING : PROCESS_HOT_TIMEOUT_NORMAL
		this.hotTimer = setTimeout(() => {
			this.isHot = false
		}, hotTimeout)

		// Store full output with size cap to prevent memory exhaustion
		this.fullOutput += data

		// Cap fullOutput at MAX_FULL_OUTPUT_SIZE to prevent memory exhaustion
		if (this.fullOutput.length > MAX_FULL_OUTPUT_SIZE) {
			// Keep last half of max size
			this.fullOutput = this.fullOutput.slice(-MAX_FULL_OUTPUT_SIZE / 2)
			// Reset lastRetrievedIndex since we truncated the beginning
			this.lastRetrievedIndex = 0
		}

		if (this.isListening) {
			this.emitLines(data)
		}
	}

	/**
	 * Emit lines from the buffer.
	 * @param chunk The chunk of data to process
	 */
	private emitLines(chunk: string): void {
		this.buffer += chunk
		let lineEndIndex: number
		while ((lineEndIndex = this.buffer.indexOf("\n")) !== -1) {
			const line = this.buffer.slice(0, lineEndIndex).trimEnd()
			this.emit("line", line)
			this.buffer = this.buffer.slice(lineEndIndex + 1)
		}
	}

	/**
	 * Emit any remaining content in the buffer.
	 */
	private emitRemainingBuffer(): void {
		if (this.buffer && this.isListening) {
			const remainingBuffer = this.removeLastLineArtifacts(this.buffer)
			if (remainingBuffer) {
				this.emit("line", remainingBuffer)
			}
			this.buffer = ""
			this.lastRetrievedIndex = this.fullOutput.length
		}
	}

	/**
	 * Continue execution without waiting for completion.
	 * Emits "continue" event but keeps emitting "line" events for background tracking.
	 *
	 * Note: We intentionally do NOT call removeAllListeners("line") or set isListening=false
	 * because background command tracking needs to continue receiving output lines
	 * after the user clicks "Proceed While Running".
	 */
	continue(): void {
		this.emitRemainingBuffer()
		// Keep isListening = true so we continue emitting "line" events
		// This is needed for background command tracking to log output to file
		this.emit("continue")
	}

	/**
	 * Get output that hasn't been retrieved yet.
	 * Truncates if output is too large to prevent context window overflow.
	 * @returns The unretrieved output (truncated if necessary)
	 */
	getUnretrievedOutput(): string {
		const unretrieved = this.fullOutput.slice(this.lastRetrievedIndex)
		this.lastRetrievedIndex = this.fullOutput.length

		// Truncate if too many lines to prevent context overflow
		const lines = unretrieved.split("\n")
		if (lines.length > MAX_UNRETRIEVED_LINES) {
			const first = lines.slice(0, TRUNCATE_KEEP_LINES)
			const last = lines.slice(-TRUNCATE_KEEP_LINES)
			const skipped = lines.length - first.length - last.length
			return this.removeLastLineArtifacts([...first, `\n... (${skipped} lines truncated) ...\n`, ...last].join("\n"))
		}

		return this.removeLastLineArtifacts(unretrieved)
	}

	getCompletionDetails(): TerminalCompletionDetails {
		return {
			exitCode: this.exitCode,
			signal: this.signal,
		}
	}

	/**
	 * Remove shell prompt artifacts from the end of output.
	 * @param output The output to clean
	 * @returns Cleaned output
	 */
	private removeLastLineArtifacts(output: string): string {
		const lines = output.trimEnd().split("\n")
		if (lines.length > 0) {
			const lastLine = lines[lines.length - 1]
			lines[lines.length - 1] = lastLine.replace(/[%$#>]\s*$/, "")
		}
		return lines.join("\n").trimEnd()
	}

	/**
	 * Get the default shell for the current platform.
	 * @returns The default shell path
	 */
	private getDefaultShell(): string {
		if (process.platform === "win32") {
			return process.env.COMSPEC || "cmd.exe"
		}
		return process.env.SHELL || "/bin/bash"
	}

	/**
	 * Get shell arguments for executing a command.
	 * @param shell The shell path
	 * @param command The command to execute
	 * @returns Array of shell arguments
	 */
	private getShellArgs(shell: string, command: string): string[] {
		if (process.platform === "win32") {
			if (shell.toLowerCase().includes("powershell") || shell.toLowerCase().includes("pwsh")) {
				return ["-Command", command]
			}
			return ["/c", command]
		}
		// Use -l for login shell, -c for command
		return ["-l", "-c", command]
	}

	/**
	 * Terminate the process and all its children.
	 *
	 * Uses terminateProcessTree utility which handles:
	 * - Cross-platform process tree termination via tree-kill
	 * - Graceful shutdown with SIGTERM
	 * - SIGKILL fallback after 2 second timeout
	 */
	async terminate(): Promise<void> {
		if (!this.childProcess || this.isCompleted) {
			return
		}

		const pid = this.childProcess.pid
		if (!pid) {
			// Fallback: try to kill the process directly if PID is unavailable
			this.childProcess.kill("SIGTERM")
			return
		}

		await terminateProcessTree({
			pid,
			childProcess: this.childProcess,
			isCompleted: () => this.isCompleted,
		})
	}
}
