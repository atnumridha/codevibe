const MAX_GIT_REF_LENGTH = 255
const MAX_COMMIT_MESSAGE_LENGTH = 16_384

export type GitHelperValidationResult = { ok: true; value: string } | { ok: false; error: string }

const GIT_REF_ALLOWED_CHARS = /^[A-Za-z0-9._/-]+$/
const GIT_REF_FORBIDDEN_CHARS = /[\x00-\x20~^:?*[\\]/
const GIT_HEX_OBJECT_RE = /^[0-9a-f]{7,64}$/i
const SYMBOLIC_REFS = new Set(["HEAD", "FETCH_HEAD", "MERGE_HEAD", "ORIG_HEAD"])

function fail(error: string): GitHelperValidationResult {
	return { ok: false, error }
}

function ok(value: string): GitHelperValidationResult {
	return { ok: true, value }
}

function normalizeGitName(value: string, label: string): GitHelperValidationResult {
	const normalized = value.trim()

	if (!normalized) {
		return fail(`${label} is required`)
	}
	if (normalized.length > MAX_GIT_REF_LENGTH) {
		return fail(`${label} must be ${MAX_GIT_REF_LENGTH} characters or fewer`)
	}
	if (normalized.startsWith("-")) {
		return fail(`${label} cannot start with '-'`)
	}
	if (normalized.startsWith("/") || normalized.endsWith("/") || normalized.includes("//")) {
		return fail(`${label} cannot contain empty path segments`)
	}
	if (normalized.endsWith(".")) {
		return fail(`${label} cannot end with '.'`)
	}
	if (normalized.includes("..")) {
		return fail(`${label} cannot contain '..'`)
	}
	if (normalized.includes("@{") || normalized === "@") {
		return fail(`${label} cannot contain git reflog syntax`)
	}
	if (GIT_REF_FORBIDDEN_CHARS.test(normalized)) {
		return fail(`${label} contains characters that are unsafe for git refs`)
	}
	if (!GIT_REF_ALLOWED_CHARS.test(normalized)) {
		return fail(`${label} may only contain letters, numbers, '.', '_', '-', and '/'`)
	}

	const segments = normalized.split("/")
	for (const segment of segments) {
		if (!segment || segment.startsWith(".") || segment.endsWith(".lock")) {
			return fail(`${label} contains an invalid ref segment`)
		}
	}

	return ok(normalized)
}

export function normalizeGitBranchName(value: string, label = "Branch name"): GitHelperValidationResult {
	const normalized = normalizeGitName(value, label)
	if (!normalized.ok) {
		return normalized
	}
	if (SYMBOLIC_REFS.has(normalized.value.toUpperCase())) {
		return fail(`${label} must be a branch name, not ${normalized.value}`)
	}
	return normalized
}

export function normalizeGitCheckoutTarget(value: string, label = "Checkout target"): GitHelperValidationResult {
	const normalized = value.trim()
	if (SYMBOLIC_REFS.has(normalized.toUpperCase()) || GIT_HEX_OBJECT_RE.test(normalized)) {
		return ok(normalized)
	}
	return normalizeGitName(value, label)
}

export function normalizeGitCommitMessage(value: string, label = "Commit message"): GitHelperValidationResult {
	const normalized = value.trim()

	if (!normalized) {
		return fail(`${label} is required`)
	}
	if (normalized.length > MAX_COMMIT_MESSAGE_LENGTH) {
		return fail(`${label} must be ${MAX_COMMIT_MESSAGE_LENGTH} characters or fewer`)
	}

	return ok(normalized)
}
