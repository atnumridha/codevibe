import type { ToolParamName, ToolUse } from "@core/assistant-message"
import {
	isCursorSandboxNetworkUrlAllowed,
	isPathAllowedByCursorSandbox,
	type CursorSandboxRuntimePolicy,
} from "@core/config/cursor-sandbox"
import type { ClineIgnoreController } from "@core/ignore/ClineIgnoreController"

export type ValidationResult = { ok: true } | { ok: false; error: string }
export type CursorSandboxAccessKind = "read" | "write"

/**
 * Lightweight validator used by new tool handlers.
 * The legacy ToolExecutor switch remains unchanged and does not depend on this.
 */
export class ToolValidator {
	constructor(private readonly clineIgnoreController: ClineIgnoreController) {}

	/**
	 * Verifies required parameters exist on the tool block.
	 * Returns a message suitable for displaying in an error.
	 */
	assertRequiredParams(block: ToolUse, ...params: ToolParamName[]): ValidationResult {
		for (const p of params) {
			// params are stored under block.params using their tag name
			const val = (block as any)?.params?.[p]
			if (val === undefined || val === null || String(val).trim() === "") {
				return { ok: false, error: `Missing required parameter '${p}' for tool '${block.name}'.` }
			}
		}
		return { ok: true }
	}

	/**
	 * Verifies access is allowed to a given path via direct-access ignore rules.
	 * Callers should pass a repo-relative (workspace-relative) path.
	 */
	checkClineIgnorePath(relPath: string): ValidationResult {
		const accessAllowed = this.clineIgnoreController.validateAccess(relPath)
		if (!accessAllowed) {
			return {
				ok: false,
				error: `Access to path '${relPath}' is blocked by direct-access ignore settings.`,
			}
		}
		return { ok: true }
	}

	checkCursorSandboxPath(input: {
		absolutePath: string
		displayPath?: string
		accessKind: CursorSandboxAccessKind
		policy?: CursorSandboxRuntimePolicy
	}): ValidationResult {
		if (!input.policy) {
			return { ok: true }
		}

		const allowedPaths = input.accessKind === "write" ? input.policy.writablePaths : input.policy.readablePaths
		const displayPath = input.displayPath ?? input.absolutePath
		if (allowedPaths.length === 0 || !isPathAllowedByCursorSandbox(input.absolutePath, allowedPaths)) {
			return {
				ok: false,
				error: `Access to path '${displayPath}' is outside Codie sandbox ${input.accessKind} paths from the active sandbox config.`,
			}
		}

		return { ok: true }
	}

	checkCursorSandboxUrl(url: string | URL, policy?: CursorSandboxRuntimePolicy): ValidationResult {
		return validateCursorSandboxUrl(url, policy)
	}

	checkCursorSandboxWebSearchDomains(
		allowedDomains: ReadonlyArray<string>,
		policy?: CursorSandboxRuntimePolicy,
	): ValidationResult {
		if (!policy) {
			return { ok: true }
		}
		const denyEntries = policy.networkPolicy.deny ?? []
		if (policy.networkPolicy.default === "allow" && denyEntries.length === 0) {
			return { ok: true }
		}
		if (policy.networkPolicy.default === "deny" && policy.networkPolicy.allow.some((entry) => entry.trim() === "*")) {
			return { ok: true }
		}
		if (allowedDomains.length === 0) {
			return {
				ok: false,
				error:
					"Web search is blocked by the active Codie sandbox networkPolicy. Provide allowed_domains constrained to the configured networkPolicy.",
			}
		}

		for (const domain of allowedDomains) {
			const normalizedDomain = normalizeNetworkHostInput(domain)
			if (!normalizedDomain) {
				return {
					ok: false,
					error: `Web search domain ${domain} is blocked by the active Codie sandbox networkPolicy.`,
				}
			}
			const allowed = isCursorSandboxNetworkUrlAllowed(normalizedDomain, policy.networkPolicy)
			if (!allowed) {
				return {
					ok: false,
					error: `Web search domain ${domain} is blocked by the active Codie sandbox networkPolicy.`,
				}
			}
		}

		return { ok: true }
	}
}

export function validateCursorSandboxUrl(
	url: string | URL,
	policy?: CursorSandboxRuntimePolicy,
): ValidationResult {
	if (!policy || policy.networkPolicy.default !== "deny") {
		if (!policy) {
			return { ok: true }
		}
	}

	let parsedUrl: URL
	try {
		parsedUrl = typeof url === "string" ? new URL(url) : url
	} catch {
		return { ok: true }
	}

	const allowed = isCursorSandboxNetworkUrlAllowed(parsedUrl, policy.networkPolicy)
	if (!allowed) {
		return {
			ok: false,
			error: `Network access to ${parsedUrl.hostname} is blocked by the active Codie sandbox networkPolicy.`,
		}
	}

	return { ok: true }
}

function normalizeNetworkHostInput(value: string): URL | undefined {
	try {
		return new URL(value)
	} catch {
		try {
			return new URL(`https://${value}`)
		} catch {
			return undefined
		}
	}
}
