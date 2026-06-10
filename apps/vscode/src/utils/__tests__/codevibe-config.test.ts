import { afterEach, describe, it } from "mocha"
import "should"
import * as vscode from "vscode"
import { getCodeVibeConfigurationValue } from "../codevibe-config"

describe("getCodeVibeConfigurationValue", () => {
	const originalGetConfiguration = vscode.workspace.getConfiguration

	afterEach(() => {
		vscode.workspace.getConfiguration = originalGetConfiguration
	})

	function setConfigurationValues(values: Record<string, unknown>, defaults: Record<string, unknown> = {}) {
		vscode.workspace.getConfiguration = (section?: string) =>
			({
				inspect: (key: string) => {
					const fullKey = `${section}.${key}`
					return {
						defaultValue: defaults[fullKey],
						globalValue: values[fullKey],
					}
				},
				get: (key: string, defaultValue?: unknown) => {
					const fullKey = `${section}.${key}`
					return values[fullKey] ?? defaults[fullKey] ?? defaultValue
				},
			}) as any
	}

	it("prefers CodeVibe-native compatibility settings over legacy cursorCompatibility aliases", () => {
		setConfigurationValues({
			"codevibe.compatibility.deepLinks.enabled": false,
			"codevibe.cursorCompatibility.deepLinks.enabled": true,
		})

		getCodeVibeConfigurationValue<boolean>("cursorCompatibility.deepLinks.enabled", true).should.equal(false)
	})

	it("falls back to legacy cursorCompatibility aliases for existing users", () => {
		setConfigurationValues({
			"codevibe.cursorCompatibility.safeBrowserEvaluate.enabled": true,
		})

		getCodeVibeConfigurationValue<boolean>("cursorCompatibility.safeBrowserEvaluate.enabled", false).should.equal(true)
	})

	it("uses CodeVibe-native compatibility defaults before caller defaults", () => {
		setConfigurationValues({}, { "codevibe.compatibility.sandboxPolicy": "prompt" })

		getCodeVibeConfigurationValue<string>("cursorCompatibility.sandboxPolicy", "disabled").should.equal("prompt")
	})
})
