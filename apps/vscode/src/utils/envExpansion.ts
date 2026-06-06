/**
 * Utility for expanding environment variables in configuration values.
 * Supports ${env:VAR_NAME} plus Cursor-compatible workspace variables.
 */

import os from "os"
import path from "path"
import { Logger } from "@/shared/services/Logger"

export interface EnvironmentExpansionOptions {
	env?: Record<string, string | undefined>
	userHome?: string
	workspaceRoot?: string
	pathSeparator?: string
}

/**
 * Expands environment variables in a string value.
 * Supports ${env:VAR_NAME} syntax and Cursor workspace variables.
 *
 * @param value - String that may contain variable references
 * @param options - Optional variable context
 * @returns String with environment variables expanded
 *
 * @example
 * // If process.env.API_KEY = "secret123"
 * expandString("Bearer ${env:API_KEY}") // Returns: "Bearer secret123"
 * expandString("${env:MISSING}") // Returns: "${env:MISSING}" (unchanged)
 */
function expandString(value: string, options: EnvironmentExpansionOptions): string {
	const env = options.env ?? process.env
	const userHome = options.userHome ?? os.homedir()
	const workspaceRoot = options.workspaceRoot?.trim()
	const pathSeparator = options.pathSeparator ?? path.sep

	return value.replace(/\$\{([^}]+)\}/g, (match, rawName) => {
		const name = String(rawName).trim()
		if (name.startsWith("env:")) {
			const trimmedVarName = name.slice("env:".length).trim()
			const envValue = env[trimmedVarName]

			if (envValue === undefined) {
				Logger.warn(`[MCP Config] Environment variable not found: ${trimmedVarName}`)
				return match // Leave unexpanded to show what's missing
			}

			// Empty string is a valid value, return it
			return envValue
		}

		if (name === "userHome") {
			return userHome
		}
		if (name === "workspaceFolder") {
			return workspaceRoot || match
		}
		if (name === "workspaceFolderBasename") {
			return workspaceRoot ? path.basename(workspaceRoot) : match
		}
		if (name === "pathSeparator" || name === "/") {
			return pathSeparator
		}
		return match
	})
}

/**
 * Recursively expands environment variables in any value (string, object, array).
 * Only processes string values, leaving other types unchanged.
 *
 * @param value - Value to process (can be string, object, array, or primitive)
 * @param options - Optional variable context
 * @returns Value with all environment variables expanded
 *
 * @example
 * expandEnvironmentVariables({
 *   api_key: "${env:API_KEY}",
 *   nested: {
 *     token: "${env:TOKEN}"
 *   }
 * })
 * // Returns object with all ${env:*} references expanded
 */
export function expandEnvironmentVariables<T>(value: T, options: EnvironmentExpansionOptions = {}): T {
	// Handle string values
	if (typeof value === "string") {
		return expandString(value, options) as T
	}

	// Handle arrays
	if (Array.isArray(value)) {
		return value.map((item) => expandEnvironmentVariables(item, options)) as T
	}

	// Handle objects (but not null)
	if (value && typeof value === "object") {
		const result: any = {}
		for (const [key, val] of Object.entries(value)) {
			result[key] = expandEnvironmentVariables(val, options)
		}
		return result
	}

	// Return primitives unchanged (numbers, booleans, null, undefined)
	return value
}
