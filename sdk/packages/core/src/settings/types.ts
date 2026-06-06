import type { UserInstructionConfigService } from "../extensions/config";
import type { BuiltinToolAvailabilityContext } from "../extensions/tools";

export type CoreSettingsType =
	| "skills"
	| "workflows"
	| "rules"
	| "tools"
	| "mcp";

export type CoreSettingsItemKind =
	| "skill"
	| "workflow"
	| "rule"
	| "tool"
	| "mcp";

export type CoreSettingsItemSource =
	| "global"
	| "workspace"
	| "builtin"
	| "global-plugin"
	| "workspace-plugin";

export interface CoreSettingsItem {
	id: string;
	name: string;
	path: string;
	kind: CoreSettingsItemKind;
	source: CoreSettingsItemSource;
	enabled?: boolean;
	description?: string;
	toggleable?: boolean;
}

export interface CoreSettingsSnapshot {
	workflows: CoreSettingsItem[];
	rules: CoreSettingsItem[];
	skills: CoreSettingsItem[];
	tools: CoreSettingsItem[];
	mcp: CoreSettingsItem[];
}

export interface CoreSettingsListInput {
	cwd?: string;
	workspaceRoot?: string;
	userInstructionService?: UserInstructionConfigService;
	availabilityContext?: BuiltinToolAvailabilityContext;
}

export interface CoreSettingsToggleInput extends CoreSettingsListInput {
	type: CoreSettingsType;
	id?: string;
	path?: string;
	name?: string;
	enabled?: boolean;
}

export interface CoreSettingsGetInput extends CoreSettingsListInput {
	type: CoreSettingsType;
	id?: string;
	path?: string;
	name?: string;
}

export interface CoreSettingsPatchInput extends CoreSettingsGetInput {
	enabled: boolean;
}

export interface CoreSettingsGetResult {
	type: CoreSettingsType;
	item?: CoreSettingsItem;
	snapshot: CoreSettingsSnapshot;
}

export interface CoreSettingsMutationResult {
	snapshot: CoreSettingsSnapshot;
	changedTypes: CoreSettingsType[];
}

export interface ClineCoreSettingsApi {
	list(input?: CoreSettingsListInput): Promise<CoreSettingsSnapshot>;
	get(input: CoreSettingsGetInput): Promise<CoreSettingsGetResult>;
	toggle(input: CoreSettingsToggleInput): Promise<CoreSettingsMutationResult>;
	patch(input: CoreSettingsPatchInput): Promise<CoreSettingsMutationResult>;
}
