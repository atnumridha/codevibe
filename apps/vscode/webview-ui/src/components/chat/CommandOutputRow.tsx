import { COMMAND_OUTPUT_STRING, COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import { ClineMessage, type CodeVibeCompatibilityStatus } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/cline/common"
import { AskResponseRequest } from "@shared/proto/cline/task"
import {
	encodeTerminalRunMode,
	extractTerminalRunModeMarker,
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
		const hasActiveSandbox = sandboxRuntime?.status === "loaded" || sandboxRuntime?.status === "invalid"
		const safeRunMode: CodeVibeTerminalRunMode = hasActiveSandbox ? "sandboxed" : "default"
		const safeRunLabel = hasActiveSandbox ? "Sandboxed" : "Default"
		const safeRunAriaLabel = hasActiveSandbox ? "Run command in sandbox" : "Run command with default terminal policy"
		const safeRunTitle = hasActiveSandbox
			? "Run constrained by the active .cursor/sandbox.json policy"
			: "No active .cursor/sandbox.json policy; run with the default terminal permissions"
		const SafeRunIcon = hasActiveSandbox ? ShieldCheckIcon : PlayIcon
		const sandboxPolicySummary = getSandboxPolicySummary(sandboxRuntime)
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
		const { command: rawCommand, terminalRunMode } = extractTerminalRunModeMarker(rawCommandWithMarker)

		const requestsApproval = rawCommand.endsWith(COMMAND_REQ_APP_STRING)
		const command = requestsApproval ? rawCommand.slice(0, -COMMAND_REQ_APP_STRING.length) : rawCommand
		const canAnswerCommandApproval = isCommandPending && message.partial !== true
		const showCancelButton =
			(isCommandExecuting || isCommandPending) && typeof onCancelCommand === "function" && isBackgroundExec
		const answerCommandApproval = async (responseType: "yesButtonClicked" | "noButtonClicked", mode?: CodeVibeTerminalRunMode) => {
			await TaskServiceClient.askResponse(
				AskResponseRequest.create({
					responseType,
					text: mode ? encodeTerminalRunMode(mode) : undefined,
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
					<div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2">
						<Button
							aria-label={safeRunAriaLabel}
							className="justify-center"
							onClick={() => answerCommandApproval("yesButtonClicked", safeRunMode)}
							size="sm"
							title={safeRunTitle}
							variant="success">
							<SafeRunIcon />
							{safeRunLabel}
						</Button>
						<Button
							aria-label="Run command elevated"
							className="justify-center"
							onClick={() => answerCommandApproval("yesButtonClicked", "elevated")}
							size="sm"
							title="Run as an elevated trusted terminal command"
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
						<div className="col-span-3 text-[11px] text-description">
							{sandboxPolicySummary} Elevated commands require this explicit approval.
						</div>
					</div>
				)}
				{requestsApproval && (
					<div className="flex items-center gap-2.5 p-2 text-[12px] text-editor-warning-foreground">
						<i className="codicon codicon-warning" />
						<span>The model has determined this command requires explicit approval.</span>
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
	const label = {
		sandboxed: "Sandboxed",
		elevated: "Elevated",
		default: "Default",
	}[mode]
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
					? "Ran with the workspace sandbox policy"
					: mode === "elevated"
						? "Ran as an elevated trusted terminal command"
						: "Ran with the default terminal policy"
			}>
			<Icon className="size-3.5" />
			<span>{label}</span>
		</span>
	)
}

type SandboxRuntimeSummary = CodeVibeCompatibilityStatus["sandboxRuntime"]

function getSandboxPolicySummary(runtime: SandboxRuntimeSummary | undefined) {
	if (!runtime) {
		return "No sandbox status is available; default runs use current terminal permissions."
	}

	if (runtime.status === "loaded") {
		return `Sandbox active: ${runtime.effectiveAccess} access, ${runtime.writablePathCount} writable path(s), network ${runtime.networkDefault}.`
	}

	if (runtime.status === "invalid") {
		return "Sandbox config is invalid; CodeVibe is failing closed to read-only policy."
	}

	if (runtime.status === "disabled") {
		return "Sandbox compatibility is disabled; default runs use current terminal permissions."
	}

	return "No .cursor/sandbox.json is active; default runs use current terminal permissions."
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
