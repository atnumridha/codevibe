import { homedir } from "node:os";
import { join } from "node:path";

const CODEVIBE_ENV_PREFIX = "CODEVIBE_";
const LEGACY_CLINE_ENV_PREFIX = "CLINE_";
const DEFAULT_CODEVIBE_DIR = ".codevibe";

export function installCodeVibeEnvAliases(
	env: NodeJS.ProcessEnv = process.env,
): void {
	for (const [name, value] of Object.entries(env)) {
		if (value === undefined || !name.startsWith(CODEVIBE_ENV_PREFIX)) {
			continue;
		}
		const legacyName = `${LEGACY_CLINE_ENV_PREFIX}${name.slice(CODEVIBE_ENV_PREFIX.length)}`;
		if (env[legacyName] === undefined) {
			env[legacyName] = value;
		}
	}
}

export function resolveCodeVibeDir(
	env: NodeJS.ProcessEnv = process.env,
	homeDir = homedir(),
): string {
	return (
		env.CODEVIBE_DIR?.trim() ||
		env.CLINE_DIR?.trim() ||
		join(homeDir, DEFAULT_CODEVIBE_DIR)
	);
}

export function setCodeVibeDirEnvironment(
	dir: string,
	env: NodeJS.ProcessEnv = process.env,
): void {
	env.CODEVIBE_DIR = dir;
	env.CLINE_DIR = dir;
}

installCodeVibeEnvAliases();
