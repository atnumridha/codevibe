/**
 * List of email domains that are considered trusted testers for CodeVibe.
 */
const CLINE_TRUSTED_TESTER_DOMAINS = ["fibilabs.tech"]

/**
 * Checks if the given email belongs to a CodeVibe bot user.
 * E.g. Emails ending with @codevibe.dev
 */
export function isClineBotUser(email: string): boolean {
	return email.endsWith("@codevibe.dev")
}

export function isClineInternalTester(email: string): boolean {
	return isClineBotUser(email) || CLINE_TRUSTED_TESTER_DOMAINS.some((d) => email.endsWith(`@${d}`))
}
