import { Empty, EmptyRequest } from "@shared/proto/cline/common";
import { ShowMessageType } from "@shared/proto/host/window";
import { DEFAULT_API_PROVIDER, openAiCodexDefaultModelId } from "@shared/api";
import { HostProvider } from "@/hosts/host-provider";
import {
	openAiCodexOAuthManager,
	safeOpenAiCodexErrorSummary,
} from "@/integrations/openai-codex/oauth";
import { Logger } from "@/shared/services/Logger";
import { openExternal } from "@/utils/env";
import { Controller } from "..";

let openAiCodexSignInPromise: Promise<Empty> | null = null;

/**
 * Initiates the Codie OAuth authentication flow.
 * Opens the authorization URL in the user's browser.
 */
export async function openAiCodexSignIn(
	controller: Controller,
	_: EmptyRequest,
): Promise<Empty> {
	if (openAiCodexSignInPromise) {
		return openAiCodexSignInPromise;
	}

	openAiCodexSignInPromise = doOpenAiCodexSignIn(controller);
	try {
		return await openAiCodexSignInPromise;
	} finally {
		openAiCodexSignInPromise = null;
	}
}

async function doOpenAiCodexSignIn(controller: Controller): Promise<Empty> {
	try {
		// Start the authorization flow and get the auth URL
		const authUrl = openAiCodexOAuthManager.startAuthorizationFlow();
		const callbackPromise = openAiCodexOAuthManager.waitForCallback();

		try {
			// Open the auth URL only after the local callback listener is ready.
			await openAiCodexOAuthManager.waitForCallbackServerReady();
			await openExternal(authUrl);
			await callbackPromise;
		} catch (error) {
			void callbackPromise.catch(() => undefined);
			throw error;
		}

		const apiConfiguration = controller.stateManager.getApiConfiguration();
		controller.stateManager.setApiConfiguration({
			...apiConfiguration,
			planModeApiProvider: DEFAULT_API_PROVIDER,
			actModeApiProvider: DEFAULT_API_PROVIDER,
			planModeApiModelId: openAiCodexDefaultModelId,
			actModeApiModelId: openAiCodexDefaultModelId,
		});
		controller.stateManager.setGlobalState("welcomeViewCompleted", true);
		controller.stateManager.setGlobalState("isNewUser", false);
		await controller.stateManager.flushPendingState();

		// Post the minimal signed-in state before resolving the onboarding RPC.
		// The full model refresh can stay async, but the welcome flow must not
		// depend on a later state stream tick.
		await controller
			.postStateToWebview({ skipOpenAiCodexBackendModelsRefresh: true })
			.catch((error) => {
				Logger.error(
					`[openAiCodexSignIn] Failed to post Codie sign-in state: ${safeOpenAiCodexErrorSummary(error)}`,
				);
			});
		void controller.postStateToWebview().catch((error) => {
			Logger.error(
				`[openAiCodexSignIn] Failed to refresh hosted model state: ${safeOpenAiCodexErrorSummary(error)}`,
			);
		});
		void HostProvider.window
			.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "Successfully signed in to Codie",
			})
			.catch((error) => {
				Logger.error(
					`[openAiCodexSignIn] Failed to show sign-in notification: ${safeOpenAiCodexErrorSummary(error)}`,
				);
			});
	} catch (error) {
		const errorMessage = safeOpenAiCodexErrorSummary(error);
		Logger.error(`[openAiCodexSignIn] Codie sign in failed: ${errorMessage}`);
		openAiCodexOAuthManager.cancelAuthorizationFlow();
		if (!errorMessage.toLowerCase().includes("timed out")) {
			void HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Codie sign in failed: ${errorMessage}`,
			});
		}
		throw error;
	}

	return {};
}
