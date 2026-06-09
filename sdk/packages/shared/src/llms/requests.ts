export const DEFAULT_REQUEST_HEADERS: Record<string, string> = {
	"HTTP-Referer": "https://github.com/atnumridha/codevibe",
	"X-Title": "CodeVibe",
	"X-IS-MULTIROOT": "false",
	"X-CLIENT-TYPE": "codevibe-sdk",
};

export function serializeAbortReason(reason: unknown): unknown {
	return reason instanceof Error
		? { name: reason.name, message: reason.message }
		: reason;
}
