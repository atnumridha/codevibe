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
	const primary = inspectConfiguration<T>(primarySection, key)
	const legacy = inspectConfiguration<T>(legacySection, key)

	return (
		firstExplicitValue(primary) ??
		firstExplicitValue(legacy) ??
		primary?.defaultValue ??
		legacy?.defaultValue ??
		directConfigurationValue<T>(primarySection, key) ??
		directConfigurationValue<T>(legacySection, key) ??
		defaultValue
	)
}
