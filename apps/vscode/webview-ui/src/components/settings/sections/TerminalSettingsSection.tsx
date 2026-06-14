import { UpdateTerminalConnectionTimeoutResponse } from "@shared/proto/index.cline"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import React, { useState } from "react"
import { PlatformType } from "@/config/platform.config"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { usePlatform } from "@/context/PlatformContext"
import { StateServiceClient } from "../../../services/grpc-client"
import Section from "../Section"
import TerminalOutputLineLimitSlider from "../TerminalOutputLineLimitSlider"
import { updateSetting } from "../utils/settingsHandlers"

interface TerminalSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

export const TerminalSettingsSection: React.FC<TerminalSettingsSectionProps> = ({ renderSectionHeader }) => {
	const {
		shellIntegrationTimeout,
		terminalReuseEnabled,
		defaultTerminalProfile,
		availableTerminalProfiles,
		compatibilityStatus,
		vscodeTerminalExecutionMode,
	} = useExtensionState()
	const platformConfig = usePlatform()
	const isVsCodePlatform = platformConfig.type === PlatformType.VSCODE

	const [inputValue, setInputValue] = useState((shellIntegrationTimeout / 1000).toString())
	const [inputError, setInputError] = useState<string | null>(null)

	const handleTimeoutChange = (event: Event) => {
		const target = event.target as HTMLInputElement
		const value = target.value

		setInputValue(value)

		const seconds = parseFloat(value)
		if (Number.isNaN(seconds) || seconds <= 0) {
			setInputError("Please enter a positive number")
			return
		}

		setInputError(null)
		const timeoutMs = Math.round(seconds * 1000)

		StateServiceClient.updateTerminalConnectionTimeout({ timeoutMs })
			.then((response: UpdateTerminalConnectionTimeoutResponse) => {
				const timeoutMs = response.timeoutMs
				// Backend calls postStateToWebview(), so state will update via subscription
				// Just sync the input value with the confirmed backend value
				if (timeoutMs !== undefined) {
					setInputValue((timeoutMs / 1000).toString())
				}
			})
			.catch((error) => {
				console.error("Failed to update terminal connection timeout:", error)
			})
	}

	const handleInputBlur = () => {
		if (inputError) {
			setInputValue((shellIntegrationTimeout / 1000).toString())
			setInputError(null)
		}
	}

	const handleTerminalReuseChange = (event: Event) => {
		const target = event.target as HTMLInputElement
		const checked = target.checked
		updateSetting("terminalReuseEnabled", checked)
	}

	const handleExecutionModeChange = (event: Event) => {
		const target = event.target as HTMLSelectElement
		const value = target.value === "backgroundExec" ? "backgroundExec" : "vscodeTerminal"
		updateSetting("vscodeTerminalExecutionMode", value)
	}

	// Use any to avoid type conflicts between Event and FormEvent
	const handleDefaultTerminalProfileChange = (event: any) => {
		const target = event.target as HTMLSelectElement
		const profileId = target.value

		// Save immediately using the consolidated updateSettings approach
		updateSetting("defaultTerminalProfile", profileId || "default")
	}

	const profilesToShow = availableTerminalProfiles
	const sandboxPolicy = compatibilityStatus?.sandboxPolicy ?? "prompt"
	const sandboxRuntime = compatibilityStatus?.sandboxRuntime
	const sandboxRuntimeStatus = sandboxRuntime?.status ?? "missing"
	const sandboxConfigLabel =
		sandboxRuntime?.configSource === "cursorCompatibility"
			? "legacy import-compatible sandbox config"
			: "Codie sandbox configuration"
	const sandboxRuntimeBadge =
		sandboxRuntimeStatus === "loaded"
			? "Active"
			: sandboxRuntimeStatus === "invalid"
				? "Fail closed"
				: sandboxRuntimeStatus === "disabled"
					? "Disabled"
					: "Missing"
	const sandboxRuntimeDescription =
		sandboxRuntimeStatus === "loaded"
			? `Codie checks commands against the active ${sandboxConfigLabel} before sandboxed execution.`
			: sandboxRuntimeStatus === "invalid"
				? "The sandbox configuration is invalid, so Codie uses a read-only fail-closed policy until it is fixed."
				: "No sandbox policy is active. Codie uses the current terminal permissions for approval decisions."
	const sandboxRuntimeSummary = `Sandbox runtime: ${sandboxRuntimeStatus}; access: ${
		sandboxRuntime?.effectiveAccess ?? "disabled"
	}; writable paths: ${sandboxRuntime?.writablePathCount ?? 0}; network: ${
		sandboxRuntime?.networkDefault ?? "deny"
	}; allow: ${sandboxRuntime?.networkAllowCount ?? 0}; deny: ${sandboxRuntime?.networkDenyCount ?? 0}${
		sandboxRuntime?.networkStrict ? "; strict" : ""
	}.`

	return (
		<div>
			{renderSectionHeader("terminal")}
			<Section>
				<div className="mb-5" id="terminal-settings-section">
					<div className="mb-4">
						<label className="font-medium block mb-1" htmlFor="default-terminal-profile">
							Default terminal profile
						</label>
						<VSCodeDropdown
							className="w-full"
							id="default-terminal-profile"
							onChange={handleDefaultTerminalProfileChange}
							value={defaultTerminalProfile || "default"}>
							{profilesToShow.map((profile) => (
								<VSCodeOption key={profile.id} title={profile.description} value={profile.id}>
									{profile.name}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
						<p className="text-xs text-(--vscode-descriptionForeground) mt-1">
							Select the default terminal Codie uses. Default follows your VS Code global setting.
						</p>
					</div>

					<div className="mb-4">
						<div className="mb-2">
							<label className="font-medium block mb-1">Shell integration timeout (seconds)</label>
							<div className="flex items-center">
								<VSCodeTextField
									className="w-full"
									onBlur={handleInputBlur}
									onChange={(event) => handleTimeoutChange(event as Event)}
									placeholder="Enter timeout in seconds"
									value={inputValue}
								/>
							</div>
							{inputError && <div className="text-(--vscode-errorForeground) text-xs mt-1">{inputError}</div>}
						</div>
						<p className="text-xs text-(--vscode-descriptionForeground)">
							Set how long Codie waits for shell integration to activate before executing commands. Increase this
							value if you experience terminal connection timeouts.
						</p>
					</div>

					<div className="mb-4">
						<div className="flex items-center mb-2">
							<VSCodeCheckbox
								checked={terminalReuseEnabled ?? true}
								onChange={(event) => handleTerminalReuseChange(event as Event)}>
								Enable aggressive terminal reuse
							</VSCodeCheckbox>
						</div>
						<p className="text-xs text-(--vscode-descriptionForeground)">
							When enabled, Codie will reuse existing terminal windows that aren't in the current working directory.
							Disable this if you experience issues with task lockout after a terminal command.
						</p>
					</div>
					{isVsCodePlatform && (
						<div className="mb-4">
							<label className="font-medium block mb-1" htmlFor="terminal-execution-mode">
								Terminal execution mode
							</label>
							<VSCodeDropdown
								className="w-full"
								id="terminal-execution-mode"
								onChange={(event) => handleExecutionModeChange(event as Event)}
								value={vscodeTerminalExecutionMode ?? "vscodeTerminal"}>
								<VSCodeOption value="vscodeTerminal">VS Code Terminal</VSCodeOption>
								<VSCodeOption value="backgroundExec">Background execution</VSCodeOption>
							</VSCodeDropdown>
							<p className="text-xs text-[var(--vscode-descriptionForeground)] mt-1">
								Choose whether Codie runs commands in the VS Code terminal or a background process.
							</p>
						</div>
					)}
					<div className="mb-4">
						<div className="font-medium block mb-2">Terminal approval modes</div>
						<div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
							<div className="rounded border border-(--vscode-input-border) bg-(--vscode-input-background) p-2">
								<div className="flex items-center justify-between gap-2">
									<span className="text-xs font-medium">Sandboxed</span>
									<span className="rounded-full bg-(--vscode-button-background) px-2 py-0.5 text-[10px] text-(--vscode-button-foreground)">
										{sandboxRuntimeBadge}
									</span>
								</div>
								<div className="mt-1 text-[11px] text-(--vscode-descriptionForeground)">{sandboxRuntimeDescription}</div>
							</div>
							<div className="rounded border border-(--vscode-input-border) bg-(--vscode-input-background) p-2">
								<div className="flex items-center justify-between gap-2">
									<span className="text-xs font-medium">Unelevated</span>
									<span className="rounded-full border border-(--vscode-input-border) px-2 py-0.5 text-[10px] text-(--vscode-descriptionForeground)">
										Default
									</span>
								</div>
								<div className="mt-1 text-[11px] text-(--vscode-descriptionForeground)">
									Normal terminal mode with configured command permissions. Sandbox preflight still applies when active.
								</div>
							</div>
							<div className="rounded border border-(--vscode-input-border) bg-(--vscode-input-background) p-2">
								<div className="flex items-center justify-between gap-2">
									<span className="text-xs font-medium">Elevated</span>
									<span className="rounded-full border border-(--vscode-input-border) px-2 py-0.5 text-[10px] text-(--vscode-descriptionForeground)">
										Explicit
									</span>
								</div>
								<div className="mt-1 text-[11px] text-(--vscode-descriptionForeground)">
									Trusted terminal mode after manual approval. Bypasses Codie sandbox preflight; configured command
									permissions may still apply. Does not request OS administrator access.
								</div>
							</div>
						</div>
						<p className="text-xs text-[var(--vscode-descriptionForeground)] mt-2">
							Configured sandbox setting: {sandboxPolicy}. {sandboxRuntimeSummary}
						</p>
						{sandboxRuntime?.status === "invalid" && sandboxRuntime.error && (
							<p className="text-xs text-[var(--vscode-errorForeground)] mt-1">{sandboxRuntime.error}</p>
						)}
					</div>
					<TerminalOutputLineLimitSlider />
					<div className="mt-5 p-3 bg-(--vscode-textBlockQuote-background) rounded border border-(--vscode-textBlockQuote-border)">
						<p className="text-[13px] m-0">
							<strong>Having terminal issues?</strong> Check our{" "}
							<a
								className="text-(--vscode-textLink-foreground) underline hover:no-underline"
								href="https://github.com/atnumridha/codevibe#readme"
								rel="noopener noreferrer"
								target="_blank">
								Terminal Quick Fixes
							</a>{" "}
							or the{" "}
							<a
								className="text-(--vscode-textLink-foreground) underline hover:no-underline"
								href="https://github.com/atnumridha/codevibe#readme"
								rel="noopener noreferrer"
								target="_blank">
								Complete Troubleshooting Guide
							</a>
							.
						</p>
					</div>
				</div>
			</Section>
		</div>
	)
}

export default TerminalSettingsSection
