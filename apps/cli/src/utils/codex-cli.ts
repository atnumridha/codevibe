import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const OPENAI_CODEX_CLI_PROVIDER_ID = "openai-codex-cli";
export const CODEX_CLI_INSTALL_URL =
	"https://github.com/atnumridha/vibecode/blob/main/GPT_API.md";

export type CodexCliStatus =
	| {
			installed: true;
			version: string;
	  }
	| {
			installed: false;
			reason: string;
	  };

export function isOpenAICodexCliProvider(providerId: string): boolean {
	return providerId.trim().toLowerCase() === OPENAI_CODEX_CLI_PROVIDER_ID;
}

export async function checkCodexCliInstalled(): Promise<CodexCliStatus> {
	try {
		const result = await execFileAsync("codex", ["--version"], {
			timeout: 3000,
			windowsHide: true,
		});
		const version = (result.stdout || result.stderr).trim();
		return {
			installed: true,
			version: version || "codex",
		};
	} catch (error) {
		const details =
			error && typeof error === "object"
				? (error as { code?: unknown; message?: unknown })
				: undefined;
		const code = typeof details?.code === "string" ? details.code : "";
		if (code === "ENOENT") {
			return {
				installed: false,
				reason:
					"Local Codie auth is not available on PATH. Sign in with Codie or configure local auth files.",
			};
		}
		const message =
			typeof details?.message === "string"
				? details.message
				: "Could not verify local Codie auth.";
		return {
			installed: false,
			reason: message,
		};
	}
}
