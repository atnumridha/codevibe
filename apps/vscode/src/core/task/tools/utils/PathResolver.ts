import { resolveWorkspacePath } from "@/core/workspace"
import type { CursorSandboxAccessKind, ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"

/**
 * Utility class for resolving and validating file paths within a task context
 */
export class PathResolver {
	constructor(
		private config: TaskConfig,
		private validator: ToolValidator,
	) {}

	resolve(filePath: string, caller: string): { absolutePath: string; resolvedPath: string } | undefined {
		try {
			const pathResult = resolveWorkspacePath(this.config, filePath, caller)
			return typeof pathResult === "string"
				? { absolutePath: pathResult, resolvedPath: filePath }
				: { absolutePath: pathResult.absolutePath, resolvedPath: pathResult.resolvedPath }
		} catch {
			return undefined
		}
	}

	validate(
		resolvedPath: string,
		absolutePath: string,
		accessKind: CursorSandboxAccessKind = "read",
	): { ok: boolean; error?: string } {
		const ignoreValidation = this.validator.checkClineIgnorePath(resolvedPath)
		if (!ignoreValidation.ok) {
			return ignoreValidation
		}
		return this.validator.checkCursorSandboxPath({
			absolutePath,
			displayPath: resolvedPath,
			accessKind,
			policy: this.config.cursorSandboxPolicy,
		})
	}

	async resolveAndValidate(
		filePath: string,
		caller: string,
		accessKind: CursorSandboxAccessKind = "read",
	): Promise<{ absolutePath: string; resolvedPath: string } | undefined> {
		const resolution = this.resolve(filePath, caller)
		if (!resolution) {
			return undefined
		}

		const validation = this.validate(resolution.resolvedPath, resolution.absolutePath, accessKind)
		if (!validation.ok) {
			return undefined
		}

		return resolution
	}
}
