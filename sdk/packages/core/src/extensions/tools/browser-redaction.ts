const REDACTED_VALUE = "[REDACTED]";

export function redactSensitiveBrowserText(
	text: string | undefined,
): string | undefined {
	if (!text) {
		return text;
	}

	return text
		.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, `Bearer ${REDACTED_VALUE}`)
		.replace(/\b(?:sk|rk|sess|proj|org)-[A-Za-z0-9_-]{16,}\b/g, REDACTED_VALUE)
		.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, REDACTED_VALUE)
		.replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, REDACTED_VALUE)
		.replace(/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, REDACTED_VALUE)
		.replace(
			/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
			REDACTED_VALUE,
		)
		.replace(
			/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret|password|passwd|session|cookie)\b(\s*[:=]\s*["'`]?)([^"'\s`<>{},;]+)/gi,
			`$1$2${REDACTED_VALUE}`,
		)
		.replace(/\b(authorization|cookie)\b(\s*:\s*)([^\n]+)/gi, `$1$2${REDACTED_VALUE}`);
}

export function sanitizeBrowserSnapshotResult<T>(value: T): T {
	if (typeof value === "string") {
		return redactSensitiveBrowserText(value) as T;
	}
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeBrowserSnapshotResult(item)) as T;
	}
	if (value && typeof value === "object") {
		const sanitized: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			sanitized[key] = sanitizeBrowserSnapshotResult(item);
		}
		return sanitized as T;
	}
	return value;
}
