import * as vscode from "vscode"

const EXPLICIT_CONFIG_KEYS = [
	"workspaceFolderLanguageValue",
	"workspaceLanguageValue",
	"globalLanguageValue",
	"workspaceFolderValue",
	"workspaceValue",
	"globalValue",
] as const

type ConfigurationInspect<T> = {
	defaultValue?: T
	globalValue?: T
	workspaceValue?: T
	workspaceFolderValue?: T
	globalLanguageValue?: T
	workspaceLanguageValue?: T
	workspaceFolderLanguageValue?: T
}

const CODEVIBE_CONFIGURATION_ALIASES = new Map<string, string>([
	["cursorCompatibility.enabled", "compatibility.enabled"],
	["cursorCompatibility.deepLinks.enabled", "compatibility.deepLinks.enabled"],
	["cursorCompatibility.retrievalIndexing.privacyGate", "compatibility.retrievalIndexing.privacyGate"],
	["cursorCompatibility.sandboxPolicy", "compatibility.sandboxPolicy"],
	["cursorCompatibility.safeBrowserEvaluate.enabled", "compatibility.safeBrowserEvaluate.enabled"],
])

function compatibilityAliasFor(section: string, key: string): string | undefined {
	return section === "codevibe" ? CODEVIBE_CONFIGURATION_ALIASES.get(key) : undefined
}

function inspectConfiguration<T>(section: string, key: string): ConfigurationInspect<T> | undefined {
	const config = vscode.workspace.getConfiguration(section)
	return typeof config.inspect === "function" ? config.inspect<T>(key) : undefined
}

function directConfigurationValue<T>(section: string, key: string): T | undefined {
	const config = vscode.workspace.getConfiguration(section)
	return typeof config.get === "function" ? config.get<T>(key) : undefined
}

function firstExplicitValue<T>(inspectResult: ConfigurationInspect<T> | undefined): T | undefined {
	if (!inspectResult) {
		return undefined
	}
	for (const key of EXPLICIT_CONFIG_KEYS) {
		const value = inspectResult[key]
		if (value !== undefined) {
			return value
		}
	}
	return undefined
}

export function getCodeVibeConfigurationValue<T>(
	key: string,
	defaultValue: T,
	options: { primarySection?: string; legacySection?: string } = {},
): T {
	const primarySection = options.primarySection ?? "codevibe"
	const legacySection = options.legacySection ?? "cline"
	const primaryAliasKey = compatibilityAliasFor(primarySection, key)
	const primaryAlias = primaryAliasKey ? inspectConfiguration<T>(primarySection, primaryAliasKey) : undefined
	const primary = inspectConfiguration<T>(primarySection, key)
	const legacy = inspectConfiguration<T>(legacySection, key)

	return (
		firstExplicitValue(primaryAlias) ??
		firstExplicitValue(primary) ??
		firstExplicitValue(legacy) ??
		primaryAlias?.defaultValue ??
		primary?.defaultValue ??
		legacy?.defaultValue ??
		(primaryAliasKey ? directConfigurationValue<T>(primarySection, primaryAliasKey) : undefined) ??
		directConfigurationValue<T>(primarySection, key) ??
		directConfigurationValue<T>(legacySection, key) ??
		defaultValue
	)
}
