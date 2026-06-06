import type {
	PendingPromptsRuntimeService,
	PendingPromptsServiceApi,
	RuntimeHost,
	SessionModelRuntimeService,
	SessionUsageRuntimeService,
} from "../runtime/host/runtime-host";
import {
	type ClineCoreSettingsApi,
	type CoreSettingsGetInput,
	type CoreSettingsGetResult,
	type CoreSettingsListInput,
	type CoreSettingsMutationResult,
	type CoreSettingsPatchInput,
	type CoreSettingsSnapshot,
	type CoreSettingsToggleInput,
	createCoreSettingsService,
} from "../settings";

type RuntimeHostWithSettings = RuntimeHost & {
	listSettings?: (
		input?: CoreSettingsListInput,
	) => Promise<CoreSettingsSnapshot>;
	getSetting?: (
		input: CoreSettingsGetInput,
	) => Promise<CoreSettingsGetResult>;
	toggleSetting?: (
		input: CoreSettingsToggleInput,
	) => Promise<CoreSettingsMutationResult>;
	patchSetting?: (
		input: CoreSettingsPatchInput,
	) => Promise<CoreSettingsMutationResult>;
};

export type RuntimeHostServiceExtensions = RuntimeHost &
	Partial<
		PendingPromptsRuntimeService &
			SessionUsageRuntimeService &
			SessionModelRuntimeService
	>;

export function createClineCoreSettingsApi(
	host: RuntimeHost,
): ClineCoreSettingsApi {
	return {
		async list(input) {
			const settingsHost = host as RuntimeHostWithSettings;
			if (settingsHost.listSettings) {
				return await settingsHost.listSettings(input);
			}
			return await createCoreSettingsService().list(input);
		},
		async get(input) {
			const settingsHost = host as RuntimeHostWithSettings;
			if (settingsHost.getSetting) {
				return await settingsHost.getSetting(input);
			}
			return await createCoreSettingsService().get(input);
		},
		async toggle(input) {
			const settingsHost = host as RuntimeHostWithSettings;
			if (settingsHost.toggleSetting) {
				return await settingsHost.toggleSetting(input);
			}
			return await createCoreSettingsService().toggle(input);
		},
		async patch(input) {
			const settingsHost = host as RuntimeHostWithSettings;
			if (settingsHost.patchSetting) {
				return await settingsHost.patchSetting(input);
			}
			return await createCoreSettingsService().patch(input);
		},
	};
}

export function createClineCorePendingPromptsApi(
	host: RuntimeHost,
): PendingPromptsServiceApi {
	function getService(): PendingPromptsServiceApi {
		const service = (host as RuntimeHostServiceExtensions).pendingPrompts;
		if (!service) {
			throw new Error("Pending prompt service is not available.");
		}
		return service;
	}
	return {
		list(input) {
			return getService().list(input);
		},
		update(input) {
			return getService().update(input);
		},
		delete(input) {
			return getService().delete(input);
		},
	};
}
