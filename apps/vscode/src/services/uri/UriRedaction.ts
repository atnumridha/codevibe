const REDACTED_VALUE = "[REDACTED]"
const SECRET_KEY_PATTERN =
	/(authorization|api[-_]?key|cookie|credential|id[-_]?token|jwt|password|refresh[-_]?token|secret|session|token)/i
const SECRET_TEXT_PATTERNS = [
	/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
	/\b(?:sk|rk|sess|proj|org)-[A-Za-z0-9_-]{16,}\b/g,
	/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
	/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
	/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
	/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
]

function isSecretKey(key: string): boolean {
	return SECRET_KEY_PATTERN.test(key)
}

function redactSecretText(value: string): string {
	return SECRET_TEXT_PATTERNS.reduce((output, pattern) => output.replace(pattern, REDACTED_VALUE), value)
}

function redactNestedUrl(value: string): string {
	try {
		const parsed = new URL(value)
		let changed = false
		if (parsed.password) {
			parsed.password = REDACTED_VALUE
			changed = true
		}
		for (const key of [...new Set(parsed.searchParams.keys())]) {
			if (isSecretKey(key)) {
				parsed.searchParams.set(key, REDACTED_VALUE)
				changed = true
			}
		}
		return changed ? parsed.toString() : value
	} catch {
		return value
	}
}

function redactJsonValue(value: unknown, parentKey = ""): { value: unknown; redacted: boolean } {
	if (isSecretKey(parentKey)) {
		return { value: REDACTED_VALUE, redacted: true }
	}

	if (typeof value === "string") {
		const nestedUrl = redactNestedUrl(value)
		const text = redactSecretText(nestedUrl)
		return { value: text, redacted: text !== value }
	}

	if (Array.isArray(value)) {
		let redacted = false
		const next = value.map((entry) => {
			const result = redactJsonValue(entry)
			redacted ||= result.redacted
			return result.value
		})
		return { value: next, redacted }
	}

	if (value && typeof value === "object") {
		let redacted = false
		const next: Record<string, unknown> = {}
		for (const [key, entry] of Object.entries(value)) {
			const result = redactJsonValue(entry, key)
			redacted ||= result.redacted
			next[key] = result.value
		}
		return { value: next, redacted }
	}

	return { value, redacted: false }
}

function redactUriParamValue(key: string, value: string): string {
	if (isSecretKey(key)) {
		return REDACTED_VALUE
	}

	if (key === "config") {
		try {
			const result = redactJsonValue(JSON.parse(value))
			return JSON.stringify(result.value)
		} catch {
			return redactSecretText(value)
		}
	}

	return redactSecretText(redactNestedUrl(value))
}

function redactInvalidUriString(rawUri: string): string {
	return redactSecretText(
		rawUri.replace(
			/([?&;](?:authorization|api[-_]?key|cookie|credential|id[-_]?token|jwt|password|refresh[-_]?token|secret|session|token)=)([^&#;\s]+)/gi,
			`$1${REDACTED_VALUE}`,
		),
	)
}

export function redactUriForLogging(rawUri: string): string {
	try {
		const parsed = new URL(rawUri)
		if (parsed.password) {
			parsed.password = REDACTED_VALUE
		}
		for (const key of [...new Set(parsed.searchParams.keys())]) {
			const values = parsed.searchParams.getAll(key)
			parsed.searchParams.delete(key)
			for (const value of values) {
				parsed.searchParams.append(key, redactUriParamValue(key, value))
			}
		}
		return parsed.toString()
	} catch {
		return redactInvalidUriString(rawUri)
	}
}
