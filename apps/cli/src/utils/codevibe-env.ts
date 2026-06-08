const CODEVIBE_ENV_PREFIX = "CODEVIBE_";
const LEGACY_CLINE_ENV_PREFIX = "CLINE_";

export function installCodeVibeEnvAliases(env: NodeJS.ProcessEnv = process.env): void {
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

installCodeVibeEnvAliases();
