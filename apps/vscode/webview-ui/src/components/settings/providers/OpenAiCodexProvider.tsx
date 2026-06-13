import { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import {
	getOpenAiCodexModelOptions,
	normalizeApiConfiguration,
	supportsReasoningEffortForModelId,
} from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface OpenAiCodexProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * Codie hosted provider configuration component.
 * Uses OAuth authentication instead of API keys.
 */
export const OpenAiCodexProvider = ({ showModelOptions, isPopup, currentMode }: OpenAiCodexProviderProps) => {
	const { apiConfiguration, openAiCodexIsAuthenticated, openAiCodexModels } = useExtensionState()
	const { handleModeFieldChange } = useApiConfigurationHandlers()
	const codexModels = getOpenAiCodexModelOptions(openAiCodexModels)

	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode, {
		openAiCodexModels,
	})
	const showReasoningEffort = supportsReasoningEffortForModelId(selectedModelId, true)

	const handleSignIn = async () => {
		try {
			await AccountServiceClient.openAiCodexSignIn({})
		} catch (error) {
			console.error("Failed to sign in to Codie:", error)
		}
	}

	const handleSignOut = async () => {
		try {
			await AccountServiceClient.openAiCodexSignOut({})
		} catch (error) {
			console.error("Failed to sign out of Codie:", error)
		}
	}

	return (
		<div>
			<div style={{ marginBottom: "15px" }}>
				{openAiCodexIsAuthenticated ? (
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
						<span style={{ color: "var(--vscode-descriptionForeground)" }}>Signed in to Codie</span>
						<VSCodeButton appearance="secondary" onClick={handleSignOut}>
							Sign Out
						</VSCodeButton>
					</div>
				) : (
					<div>
						<p
							style={{
								fontSize: "12px",
								color: "var(--vscode-descriptionForeground)",
								marginBottom: "10px",
							}}>
							Connect Codie to use hosted agent models. Other model sources remain available below.
						</p>
						<VSCodeButton onClick={handleSignIn}>Sign in to Codie</VSCodeButton>
					</div>
				)}
			</div>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={codexModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>
					{showReasoningEffort && <ReasoningEffortSelector currentMode={currentMode} />}

						<ModelInfoView
							isPopup={isPopup}
							modelInfo={selectedModelInfo}
							sanitizeHostedModelCopy={true}
							selectedModelId={selectedModelId}
						/>
					</>
				)}
		</div>
	)
}
