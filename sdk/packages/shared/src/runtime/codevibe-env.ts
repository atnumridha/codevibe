const CODEVIBE_ENV_PREFIX = "CODEVIBE_";
const LEGACY_CLINE_ENV_PREFIX = "CLINE_";

export function codeVibeEnvName(name: string): string {
	const trimmed = name.trim();
	if (trimmed.startsWith(CODEVIBE_ENV_PREFIX)) {
		return trimmed;
	}
	if (trimmed.startsWith(LEGACY_CLINE_ENV_PREFIX)) {
		return `${CODEVIBE_ENV_PREFIX}${trimmed.slice(LEGACY_CLINE_ENV_PREFIX.length)}`;
	}
	return trimmed;
}

export function legacyClineEnvName(name: string): string | undefined {
	const trimmed = name.trim();
	if (trimmed.startsWith(LEGACY_CLINE_ENV_PREFIX)) {
		return trimmed;
	}
	if (trimmed.startsWith(CODEVIBE_ENV_PREFIX)) {
		return `${LEGACY_CLINE_ENV_PREFIX}${trimmed.slice(CODEVIBE_ENV_PREFIX.length)}`;
	}
	return undefined;
}

export function readCodeVibeEnv(
	name: string,
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const primary = env[codeVibeEnvName(name)]?.trim();
	if (primary) {
		return primary;
	}
	const legacyName = legacyClineEnvName(name);
	if (!legacyName) {
		return undefined;
	}
	const legacy = env[legacyName]?.trim();
	return legacy || undefined;
}

export function isCodeVibeEnvEnabled(
	name: string,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	const value = readCodeVibeEnv(name, env)?.toLowerCase();
	return value === "1" || value === "true" || value === "yes";
}
