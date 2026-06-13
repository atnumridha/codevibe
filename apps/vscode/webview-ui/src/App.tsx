import type { Boolean, EmptyRequest } from "@shared/proto/cline/common"
import { useCallback, useEffect } from "react"
import AccountView from "./components/account/AccountView"
import ChatView from "./components/chat/ChatView"
import HistoryView from "./components/history/HistoryView"
import McpView from "./components/mcp/configuration/McpConfigurationView"
import OnboardingView from "./components/onboarding/OnboardingView"
import SettingsView from "./components/settings/SettingsView"
import WorktreesView from "./components/worktrees/WorktreesView"
import { useCodeVibeAuth } from "./context/CodeVibeAuthContext"
import { useExtensionState } from "./context/ExtensionStateContext"
import { Providers } from "./Providers"
import { UiServiceClient } from "./services/grpc-client"

const AUTH_STATE_POLL_INTERVAL_MS = 1_500

const AppContent = () => {
	const {
		didHydrateState,
		welcomeViewCompleted,
		openAiCodexIsAuthenticated,
		compatibilityStatus,
		showWelcome,
		shouldShowAnnouncement,
		showMcp,
		mcpTab,
		showSettings,
		settingsTargetSection,
		showHistory,
		showAccount,
		showWorktrees,
		showAnnouncement,
		setShowAnnouncement,
		setShouldShowAnnouncement,
		setShowWelcome,
		refreshLatestState,
		closeMcpView,
		navigateToHistory,
		hideSettings,
		hideHistory,
		hideAccount,
		hideWorktrees,
		hideAnnouncement,
	} = useExtensionState()

	const { codeVibeUser, organizations, activeOrganization } = useCodeVibeAuth()
	const hasCompletedAuth = !!(
		welcomeViewCompleted || openAiCodexIsAuthenticated || compatibilityStatus?.openAiCodexAuthenticated
	)

	const showUpdateAnnouncementModal = useCallback(() => {
		setShowAnnouncement(true)
		UiServiceClient.onDidShowAnnouncement({} as EmptyRequest)
			.then((response: Boolean) => {
				setShouldShowAnnouncement(response.value)
			})
			.catch((error) => {
				console.error("Failed to acknowledge announcement:", error)
			})
	}, [setShouldShowAnnouncement, setShowAnnouncement])

	useEffect(() => {
		if (!didHydrateState || showWelcome || !shouldShowAnnouncement || showAnnouncement) {
			return
		}
		showUpdateAnnouncementModal()
	}, [didHydrateState, showWelcome, shouldShowAnnouncement, showAnnouncement, showUpdateAnnouncementModal])

	useEffect(() => {
		if (!didHydrateState || !showWelcome) {
			return
		}

		if (hasCompletedAuth) {
			setShowWelcome(false)
			return
		}

		let disposed = false
		const closeWelcomeIfAuthenticated = async () => {
			try {
				if (!disposed && (await refreshLatestState())) {
					setShowWelcome(false)
				}
			} catch (error) {
				console.error("Failed to refresh Codie sign-in state:", error)
			}
		}

		void closeWelcomeIfAuthenticated()
		const interval = window.setInterval(() => void closeWelcomeIfAuthenticated(), AUTH_STATE_POLL_INTERVAL_MS)

		return () => {
			disposed = true
			window.clearInterval(interval)
		}
	}, [didHydrateState, hasCompletedAuth, refreshLatestState, setShowWelcome, showWelcome])

	if (!didHydrateState) {
		return null
	}

	if (showWelcome) {
		return <OnboardingView />
	}

	return (
		<div className="flex h-screen w-full flex-col">
			{showSettings && <SettingsView onDone={hideSettings} targetSection={settingsTargetSection} />}
			{showHistory && <HistoryView onDone={hideHistory} />}
			{showMcp && <McpView initialTab={mcpTab} onDone={closeMcpView} />}
			{showAccount && (
				<AccountView
					activeOrganization={activeOrganization}
					codeVibeUser={codeVibeUser}
					onDone={hideAccount}
					organizations={organizations}
				/>
			)}
			{showWorktrees && <WorktreesView onDone={hideWorktrees} />}
			{/* Do not conditionally load ChatView, it's expensive and there's state we don't want to lose (user input, disableInput, askResponse promise, etc.) */}
			<ChatView
				hideAnnouncement={hideAnnouncement}
				isHidden={showSettings || showHistory || showMcp || showAccount || showWorktrees}
				showAnnouncement={showAnnouncement}
				showHistoryView={navigateToHistory}
			/>
		</div>
	)
}

const App = () => {
	return (
		<Providers>
			<AppContent />
		</Providers>
	)
}

export default App
