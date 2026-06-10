import { Mode } from "@shared/storage/types"
import { CodeVibeAccountInfoCard } from "../CodeVibeAccountInfoCard"
import ClineModelPicker from "../ClineModelPicker"

/**
 * Props for the CodeVibeProvider component
 */
interface CodeVibeProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
	initialModelTab?: "recommended" | "free"
}

/**
 * The CodeVibe provider configuration component
 */
export const CodeVibeProvider = ({ showModelOptions, isPopup, currentMode, initialModelTab }: CodeVibeProviderProps) => {
	return (
		<div>
			{/* CodeVibe Cloud account info */}
			<div style={{ marginBottom: 14, marginTop: 4 }}>
				<CodeVibeAccountInfoCard />
			</div>

			{showModelOptions && (
				<>
					<ClineModelPicker
						currentMode={currentMode}
						initialTab={initialModelTab}
						isPopup={isPopup}
						showProviderRouting={true}
					/>
				</>
			)}
		</div>
	)
}
