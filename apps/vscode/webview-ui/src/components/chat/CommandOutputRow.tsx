import { COMMAND_OUTPUT_STRING, COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import { ClineMessage, type CodeVibeCompatibilityStatus } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/cline/common"
import { AskResponseRequest } from "@shared/proto/cline/task"
import {
	encodeTerminalApprovalPayload,
	extractTerminalRunModeMarker,
	getTerminalRunModeLabel,
	type CodeVibeTerminalRunMode,
} from "@shared/terminalPolicy"
import { PlayIcon, ShieldAlertIcon, ShieldCheckIcon, XIcon } from "lucide-react"
import { memo, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { FileServiceClient, TaskServiceClient } from "@/services/grpc-client"
import CodeBlock from "../common/CodeBlock"
import ExpandHandle from "./ExpandHandle"

export const CommandOutputContent = memo(
	({
		output,
		isOutputFullyExpanded,
		onToggle,
		isContainerExpanded,
	}: {
		output: string
		isOutputFullyExpanded: boolean
		onToggle: () => void
		isContainerExpanded: boolean
	}) => {
		const outputLines = output.split("\n")
		const lineCount = outputLines.length
		const shouldAutoShow = lineCount <= 5
		const outputRef = useRef<HTMLDivElement>(null)

		// Auto-scroll to bottom when output changes (only when showing limited output)
		useEffect(() => {
			if (!isOutputFullyExpanded && outputRef.current) {
				// Direct scrollTop manipulation
				outputRef.current.scrollTop = outputRef.current.scrollHeight

				// Another attempt with more delay (for slower renders) to ensure scrolling works
				setTimeout(() => {
					if (outputRef.current) {
						outputRef.current.scrollTop = outputRef.current.scrollHeight
					}
				}, 50)
			}
		}, [output, isOutputFullyExpanded])

		// Don't render anything if container is collapsed
		if (!isContainerExpanded) {
			return null
		}

		// Check if output contains a log file path indicator
		const logFilePathMatch = output.match(/📋 Output is being logged to: ([^\n]+)/)
		const logFilePath = logFilePathMatch ? logFilePathMatch[1].trim() : null

		// Render output with clickable log file path
		const renderOutput = () => {
			if (!logFilePath) {
				return <CodeBlock forceWrap={true} source={`${"```"}shell\n${output}\n${"```"}`} />
			}

			// Split output into parts: before log path, log path line, after log path
			const logPathLineStart = output.indexOf("📋 Output is being logged to:")
			const logPathLineEnd = output.indexOf("\n", logPathLineStart)
			const beforeLogPath = output.substring(0, logPathLineStart)
			const afterLogPath = logPathLineEnd !== -1 ? output.substring(logPathLineEnd) : ""

			// Extract just the filename from the full path for display
			const fileName = logFilePath.split("/").pop() || logFilePath

			return (
				<div className="border border-editor-group-border rounded-sm">
					{beforeLogPath && <CodeBlock forceWrap={true} source={`${"```"}shell\n${beforeLogPath}\n${"```"}`} />}
					<div
						className="flex flex-wrap items-center gap-1.5 px-3 py-2 mx-2 my-1.5 rounded-sm bg-banner-background cursor-pointer hover:brightness-110 transition-colors"
						onClick={() => {
							FileServiceClient.openFile(StringRequest.create({ value: logFilePath })).catch((err) =>
								console.error("Failed to open log file:", err),
							)
						}}
						title={`Click to open: ${logFilePath}`}>
						<span className="shrink-0">📋 Output is being logged to:</span>
						<span className="text-vscode-textLink-foreground underline break-all">{fileName}</span>
					</div>
					{afterLogPath && <CodeBlock forceWrap={true} source={`${"```"}shell\n${afterLogPath}\n${"```"}`} />}
				</div>
			)
		}

		return (
			<div
				className={cn("w-full relative pb-0 overflow-visible border-t border-editor-group-border bg-code rounded-sm", {
					"rounded-b-none": lineCount > 5,
				})}>
				<div
					className={cn("text-white scroll-smooth bg-code overflow-y-auto", {
						"max-h-[75px]": !shouldAutoShow && !isOutputFullyExpanded,
						"max-h-[200px]": !shouldAutoShow && isOutputFullyExpanded,
						"overflow-y-visible": shouldAutoShow,
					})}
					ref={outputRef}>
					<div className="bg-code">{renderOutput()}</div>
				</div>
				{/* Show notch only if there's more than 5 lines */}
				{lineCount > 5 && <ExpandHandle isExpanded={isOutputFullyExpanded} onToggle={onToggle} />}
			</div>
		)
	},
)

CommandOutputContent.displayName = "CommandOutputContent"

export const CommandOutputRow = memo(
	({
		message,
		isCommandExecuting = false,
		isCommandPending = false,
		isCommandCompleted = false,
		isBackgroundExec = false, // vscodeTerminalExecutionMode === "backgroundExec"
		onCancelCommand,
		icon,
		title,
		isOutputFullyExpanded,
		setIsOutputFullyExpanded,
	}: {
		message: ClineMessage
		isCommandExecuting?: boolean
		isCommandPending?: boolean
		isCommandCompleted?: boolean
		isBackgroundExec?: boolean
		onCancelCommand?: () => void
		icon?: JSX.Element | null
		title?: JSX.Element | null
		isOutputFullyExpanded: boolean
		setIsOutputFullyExpanded: (expanded: boolean) => void
	}) => {
		const { compatibilityStatus } = useExtensionState()
		const sandboxRuntime = compatibilityStatus?.sandboxRuntime
		const hasLoadedSandbox = sandboxRuntime?.status === "loaded"
		const hasInvalidSandbox = sandboxRuntime?.status === "invalid"
		const showsSandboxStatus = hasLoadedSandbox || hasInvalidSandbox
		const safeRunMode: CodeVibeTerminalRunMode = hasLoadedSandbox ? "sandboxed" : "default"
		const safeRunLabel = hasInvalidSandbox ? "Fail-closed" : getTerminalRunModeLabel(safeRunMode)
		const safeRunAriaLabel = hasLoadedSandbox
			? "Run command in sandbox"
			: hasInvalidSandbox
				? "Sandbox config is invalid; sandboxed execution is disabled"
				: "Run command with default terminal policy"
		const sandboxConfigLabel = getSandboxConfigLabel(sandboxRuntime)
		const safeRunTitle = hasLoadedSandbox
			? `Run with the active ${sandboxConfigLabel}`
			: hasInvalidSandbox
				? "Sandbox config is invalid; fix it before running commands in sandbox mode"
			: "No active Codie sandbox config; run with default terminal permissions"
		const SafeRunIcon = hasLoadedSandbox ? ShieldCheckIcon : hasInvalidSandbox ? ShieldAlertIcon : PlayIcon
		const sandboxPolicySummary = getSandboxPolicySummary(sandboxRuntime)
		const terminalApprovalFooter = getTerminalApprovalFooter(sandboxRuntime)
		const splitMessage = (text: string) => {
			const outputIndex = text.indexOf(COMMAND_OUTPUT_STRING)
			if (outputIndex === -1) {
				return { command: text, output: "" }
			}
			return {
				command: text.slice(0, outputIndex).trim(),
				output: text
					.slice(outputIndex + COMMAND_OUTPUT_STRING.length)
					.trim()
					.split("")
					.map((char) => {
						switch (char) {
							case "\t":
								return "→   "
							case "\b":
								return "⌫"
							case "\f":
								return "⏏"
							case "\v":
								return "⇳"
							default:
								return char
						}
					})
					.join(""),
			}
		}

		const { command: rawCommandWithMarker, output } = splitMessage(message.text || "")
		const { command: rawCommand, terminalRunMode, requestedTerminalRunMode, prefixRule } =
			extractTerminalRunModeMarker(rawCommandWithMarker)

		const requestsApproval = rawCommand.endsWith(COMMAND_REQ_APP_STRING)
		const command = requestsApproval ? rawCommand.slice(0, -COMMAND_REQ_APP_STRING.length) : rawCommand
		const canAnswerCommandApproval = isCommandPending && message.partial !== true
		const showCancelButton =
			(isCommandExecuting || isCommandPending) && typeof onCancelCommand === "function" && isBackgroundExec
		const answerCommandApproval = async (responseType: "yesButtonClicked" | "noButtonClicked", mode?: CodeVibeTerminalRunMode) => {
			await TaskServiceClient.askResponse(
				AskResponseRequest.create({
					responseType,
					text: mode ? encodeTerminalApprovalPayload(mode) : undefined,
					images: [],
					files: [],
				}),
			).catch((err) => console.error("Failed to answer command approval:", err))
		}

		const commandHeader = (
			<div className="flex items-center gap-2.5 mb-3">
				{icon}
				{title}
			</div>
		)

		return (
			<>
				{commandHeader}
				<div
					className="bg-code rounded-sm border border-editor-group-border"
					style={{
						transition: "all 0.3s ease-in-out",
					}}>
					{command && (
						<div className="bg-code flex items-center justify-between px-2 py-2.5 border-b border-editor-group-border rounded-sm rounded-b-none overflow-hidden">
							<div className="flex items-center gap-2 flex-1 m-w-0">
								<div
									className={cn("bg-description rounded-full w-2 h-2 shrink-0", {
										"bg-success animate-pulse": isCommandExecuting,
										"bg-editor-warning-foreground": isCommandPending,
									})}
								/>
								<span
									className={cn("text-description font-medium text-base shrink-0", {
										"text-success": isCommandExecuting,
										"text-editor-warning-foreground": isCommandPending,
									})}>
									{getCommandStatusText(isCommandExecuting, isCommandPending, isCommandCompleted)}
								</span>
							</div>
							<div className="flex items-center gap-2 shrink-0">
								{terminalRunMode && <TerminalRunModeBadge mode={terminalRunMode} />}
								{requestedTerminalRunMode && <TerminalRequestedRunModeBadge mode={requestedTerminalRunMode} />}
								{prefixRule?.length ? <TerminalPrefixRuleBadge prefixRule={prefixRule} /> : null}
								{showCancelButton && (
									<Button
										onClick={(e) => {
											e.stopPropagation()
											if (isBackgroundExec) {
												onCancelCommand?.()
											} else {
												// For regular terminal mode, show a message
												alert(
													"This command is running in the VSCode terminal. You can manually stop it using Ctrl+C in the terminal, or switch to Background Execution mode in settings for cancellable commands.",
												)
											}
										}}
										size="sm"
										variant="secondary">
										{isBackgroundExec ? "cancel" : "stop"}
									</Button>
								)}
							</div>
						</div>
					)}

					<div className="bg-code opacity-60 text-sm">
						<CodeBlock forceWrap={true} source={`${"```"}shell\n${command}\n${"```"}`} />
					</div>

					{output.length > 0 && (
						<CommandOutputContent
							isContainerExpanded={true}
							isOutputFullyExpanded={isOutputFullyExpanded}
							onToggle={() => setIsOutputFullyExpanded(!isOutputFullyExpanded)}
							output={output}
						/>
					)}
				</div>
				{canAnswerCommandApproval && (
					<div
						className={cn("mt-2 grid gap-2", {
							"grid-cols-[1fr_1fr_1fr_auto]": showsSandboxStatus,
							"grid-cols-[1fr_1fr_auto]": !showsSandboxStatus,
						})}>
						<Button
							aria-label={safeRunAriaLabel}
							className="justify-center"
							disabled={hasInvalidSandbox}
							onClick={() => answerCommandApproval("yesButtonClicked", safeRunMode)}
							size="sm"
							title={safeRunTitle}
							variant={hasInvalidSandbox ? "secondary" : "success"}>
							<SafeRunIcon />
							{safeRunLabel}
						</Button>
						{showsSandboxStatus && (
							<Button
								aria-label="Run command unelevated"
								className="justify-center"
								onClick={() => answerCommandApproval("yesButtonClicked", "default")}
								size="sm"
								title="Run in normal terminal mode; configured command permissions and Codie sandbox preflight still apply"
								variant="secondary">
								<PlayIcon />
								{getTerminalRunModeLabel("default")}
							</Button>
						)}
						<Button
							aria-label="Run command elevated"
							className="justify-center"
							onClick={() => answerCommandApproval("yesButtonClicked", "elevated")}
							size="sm"
							title="Bypass Codie sandbox preflight after explicit approval; configured command permissions may still apply and this does not request OS administrator privileges"
							variant="secondary">
							<ShieldAlertIcon />
							Elevated
						</Button>
						<Button
							aria-label="Reject command"
							onClick={() => answerCommandApproval("noButtonClicked")}
							size="sm"
							title="Reject command"
							variant="danger">
							<XIcon />
						</Button>
						<div className={cn("text-[11px] text-description", showsSandboxStatus ? "col-span-4" : "col-span-3")}>
							{sandboxPolicySummary} {terminalApprovalFooter}
						</div>
					</div>
				)}
				{requestsApproval && (
					<div className="flex items-center gap-2.5 p-2 text-[12px] text-editor-warning-foreground">
						<i className="codicon codicon-warning" />
						<span>Codie needs your approval before running this command.</span>
					</div>
				)}
			</>
		)
	},
)

CommandOutputRow.displayName = "CommandOutputRow"

const CommandStatusMap = {
	executing: "Running",
	pending: "Pending",
	completed: "Completed",
	skipped: "Skipped",
}

function TerminalRunModeBadge({ mode }: { mode: CodeVibeTerminalRunMode }) {
	const label = getTerminalRunModeLabel(mode)
	const Icon = mode === "elevated" ? ShieldAlertIcon : ShieldCheckIcon

	return (
		<span
			className={cn(
				"inline-flex h-6 items-center gap-1 rounded-[3px] border px-1.5 text-[11px] font-medium",
				mode === "elevated"
					? "border-editor-warning-foreground/50 text-editor-warning-foreground"
					: "border-success/50 text-success",
			)}
			title={
				mode === "sandboxed"
					? "Ran after Codie sandbox preflight"
					: mode === "elevated"
						? "Ran as a trusted terminal command after explicit approval"
						: "Ran with the default terminal policy"
			}>
			<Icon className="size-3.5" />
			<span>{label}</span>
		</span>
	)
}

function TerminalRequestedRunModeBadge({ mode }: { mode: CodeVibeTerminalRunMode }) {
	return (
		<span
			className="inline-flex h-6 items-center gap-1 rounded-[3px] border border-editor-group-border px-1.5 text-[11px] text-description"
			title="Terminal mode requested by the model; the approval buttons still choose the final mode">
			<span>Requested: {getTerminalRunModeLabel(mode)}</span>
		</span>
	)
}

function TerminalPrefixRuleBadge({ prefixRule }: { prefixRule: string[] }) {
	const label = prefixRule.join(" ")
	return (
		<span
			className="inline-flex h-6 max-w-[220px] items-center gap-1 rounded-[3px] border border-editor-group-border px-1.5 text-[11px] text-description"
			title={`One-off approval context prefix: ${label}`}>
			<span className="truncate">Prefix: {label}</span>
		</span>
	)
}

type SandboxRuntimeSummary = CodeVibeCompatibilityStatus["sandboxRuntime"]

function getSandboxPolicySummary(runtime: SandboxRuntimeSummary | undefined) {
	if (!runtime) {
		return "No sandbox status is available; default runs use current terminal permissions."
	}

	if (runtime.status === "loaded") {
		return `${getSandboxRuntimeLabel(runtime)} active: ${runtime.effectiveAccess} access, ${formatPathCount(
			runtime.writablePathCount,
		)}, network ${runtime.networkDefault}.`
	}

	if (runtime.status === "invalid") {
		return `${getSandboxRuntimeLabel(runtime)} config is invalid; sandboxed execution is disabled until it is fixed.`
	}

	if (runtime.status === "disabled") {
		return "Codie sandbox compatibility is disabled; default runs use current terminal permissions."
	}

	return "No Codie sandbox config is active; default runs use current terminal permissions."
}

function getTerminalApprovalFooter(runtime: SandboxRuntimeSummary | undefined) {
	if (runtime?.status === "loaded") {
		return (
			"Unelevated uses normal terminal mode while configured command permissions and Codie sandbox preflight still apply. " +
			"Elevated bypasses Codie sandbox preflight after explicit approval here; configured command permissions may still apply, " +
			"and does not request OS administrator privileges."
		)
	}

	if (runtime?.status === "invalid") {
		return (
			"Unelevated uses current terminal permissions and configured command permissions because no enforceable sandbox policy is active. " +
			"Elevated records explicit trust for this command; configured command permissions may still apply, and does not request OS administrator privileges."
		)
	}

	return (
		"Unelevated uses current terminal permissions and configured command permissions. " +
		"No Codie sandbox preflight is active. Elevated records explicit trust for this command; configured command permissions may still apply, " +
		"and does not request OS administrator privileges."
	)
}

function getSandboxConfigLabel(runtime: SandboxRuntimeSummary | undefined) {
	return runtime?.configSource === "cursorCompatibility" ? "legacy import-compatible sandbox config" : "Codie sandbox config"
}

function getSandboxRuntimeLabel(runtime: SandboxRuntimeSummary | undefined) {
	return runtime?.configSource === "cursorCompatibility" ? "Legacy import-compatible sandbox" : "Codie sandbox"
}

function formatPathCount(count: number) {
	return `${count} writable ${count === 1 ? "path" : "paths"}`
}

function getCommandStatusText(isExecuting: boolean, isPending: boolean, isCompleted: boolean): string {
	if (isExecuting) {
		return CommandStatusMap.executing
	}
	if (isPending) {
		return CommandStatusMap.pending
	}
	if (isCompleted) {
		return CommandStatusMap.completed
	}
	return CommandStatusMap.skipped
}
