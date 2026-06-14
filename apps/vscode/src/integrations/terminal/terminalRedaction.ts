const REDACTED_VALUE = "<redacted>"

const VALUE_TOKEN_SOURCE = String.raw`"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s;&|)]+`
const SENSITIVE_KEY_SOURCE = String.raw`(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|credential|authorization|auth|private[_-]?key|client[_-]?secret|session(?:[_-]?id)?|jwt)`
const SENSITIVE_LONG_FLAG_SOURCE = String.raw`--(?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|passwd|credential|authorization|auth|private[-_]?key|client[-_]?secret|session(?:[-_]?id)?|jwt)(?:[-_][\w-]+)?`

const SENSITIVE_ENV_ASSIGNMENT = new RegExp(
	String.raw`(^|[\s;(&|])([A-Za-z_][A-Za-z0-9_]*(?:${SENSITIVE_KEY_SOURCE})[A-Za-z0-9_]*=)(${VALUE_TOKEN_SOURCE})`,
	"gi",
)
const SENSITIVE_FLAG_EQUALS = new RegExp(String.raw`(${SENSITIVE_LONG_FLAG_SOURCE}=)(${VALUE_TOKEN_SOURCE})`, "gi")
const SENSITIVE_FLAG_VALUE = new RegExp(String.raw`(${SENSITIVE_LONG_FLAG_SOURCE})(\s+)(${VALUE_TOKEN_SOURCE})`, "gi")
const SENSITIVE_JSON_VALUE = new RegExp(String.raw`(["'])(${SENSITIVE_KEY_SOURCE})\1(\s*:\s*)(${VALUE_TOKEN_SOURCE})`, "gi")

function maskValuePreservingQuotes(value: string): string {
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		const quote = value[0]
		return `${quote}${REDACTED_VALUE}${quote}`
	}

	return REDACTED_VALUE
}

/**
 * Redacts likely shell secrets before command strings are written to logs.
 * This must never be used for the command that is actually executed.
 */
export function redactCommandForLogging(command: string): string {
	return command
		.replace(SENSITIVE_JSON_VALUE, (_match, quote: string, key: string, separator: string, value: string) => {
			return `${quote}${key}${quote}${separator}${maskValuePreservingQuotes(value)}`
		})
		.replace(SENSITIVE_ENV_ASSIGNMENT, (_match, prefix: string, assignment: string, value: string) => {
			return `${prefix}${assignment}${maskValuePreservingQuotes(value)}`
		})
		.replace(SENSITIVE_FLAG_EQUALS, (_match, flag: string, value: string) => {
			return `${flag}${maskValuePreservingQuotes(value)}`
		})
		.replace(SENSITIVE_FLAG_VALUE, (_match, flag: string, spacing: string, value: string) => {
			return `${flag}${spacing}${maskValuePreservingQuotes(value)}`
		})
		.replace(/\b(authorization\s*:\s*(?:bearer\s+|basic\s+|token\s+)?)([^\s"';&|)]+)/gi, `$1${REDACTED_VALUE}`)
		.replace(/\b(Bearer|Basic)\s+([^\s"';&|)]+)/g, `$1 ${REDACTED_VALUE}`)
		.replace(/:\/\/([^:\s/@]+):([^@\s/]+)@/g, `://$1:${REDACTED_VALUE}@`)
		.replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, REDACTED_VALUE)
		.replace(/\bgh[pousr]_[A-Za-z0-9_]{10,}\b/g, REDACTED_VALUE)
		.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, REDACTED_VALUE)
		.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, REDACTED_VALUE)
}
