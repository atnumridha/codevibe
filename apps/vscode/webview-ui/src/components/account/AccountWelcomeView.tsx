import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import CodeVibeMark from "@/assets/CodeVibeMark"
import { useCodeVibeSignIn } from "@/context/CodeVibeAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"

export const AccountWelcomeView = () => {
	const { environment } = useExtensionState()
	const { isLoginLoading, handleSignIn } = useCodeVibeSignIn()

	return (
		<div className="flex flex-col items-center gap-2.5">
			<CodeVibeMark className="size-16 mb-4" environment={environment} />

			<p>
				Sign up for an account to get access to the latest models, billing dashboard to view usage and credits, and more
				upcoming features.
			</p>

			<VSCodeButton className="w-full mb-4" disabled={isLoginLoading} onClick={handleSignIn}>
				Sign up with CodeVibe
				{isLoginLoading && (
					<span className="ml-1 animate-spin">
						<span className="codicon codicon-refresh"></span>
					</span>
				)}
			</VSCodeButton>

			<p className="text-(--vscode-descriptionForeground) text-xs text-center m-0">
				By continuing, you agree to the CodeVibe account terms and privacy policy configured for this provider.
			</p>
		</div>
	)
}
