import { execFileSync } from "node:child_process"
import path from "path"
import { normalizeGitBranchName, normalizeGitCheckoutTarget, normalizeGitCommitMessage } from "../../utils/git-helper"
import type { CursorCompatibleUriRoute } from "./CursorUriRoutes"

type GitStatusEntry = {
	status: string
	path: string
	originalPath?: string
}

export type CursorGitHelperKind = "git-checkout" | "git-branch" | "git-commit"

export type CursorGitHelperPlan = {
	kind: CursorGitHelperKind
	workspaceRoot: string
	currentBranch?: string
	dirty: boolean
	statusEntryCount: number
	actionable: boolean
	executed: false
	command: string[]
	confirmLabel: string
	successMessage: string
	reason?: string
	target?: string
	branch?: string
	base?: string
	checkout?: boolean
	message?: string
	all?: boolean
	staged?: boolean
	files?: string[]
	amend?: boolean
	stagingDescription?: string
}

export type CursorGitHelperResult = Omit<CursorGitHelperPlan, "executed"> & {
	executed: boolean
	commitHash?: string
	currentBranch?: string
}

function getCursorRouteString(route: CursorCompatibleUriRoute, key: string): string | undefined {
	const value = route.params[key]
	return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function getCursorRouteConfigString(route: CursorCompatibleUriRoute, key: string): string | undefined {
	const config = route.params.config
	const value =
		config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>)[key] : undefined
	return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function getCursorRouteBoolean(route: CursorCompatibleUriRoute, key: string): boolean {
	const value = getCursorRouteString(route, key)?.toLowerCase()
	return value === "true" || value === "1" || value === "yes"
}

function splitCursorGitFiles(value: string | undefined): string[] {
	return value
		? value
				.split(",")
				.map((entry) => entry.trim())
				.filter(Boolean)
		: []
}

function assertSafeGitPathspecs(files: string[]): void {
	for (const file of files) {
		if (file.includes("\0") || file.startsWith("/") || file.split(/[\\/]+/).includes("..")) {
			throw new Error(`unsafe git pathspec: ${file}`)
		}
	}
}

function parseGitStatusPorcelainZ(output: string): GitStatusEntry[] {
	const fields = output.split("\0").filter(Boolean)
	const entries: GitStatusEntry[] = []

	for (let index = 0; index < fields.length; index++) {
		const field = fields[index]
		const status = field.slice(0, 2)
		const entryPath = field.startsWith(`${status} `) ? field.slice(3) : field.slice(2).trimStart()
		const entry: GitStatusEntry = { status, path: entryPath }

		if ((status[0] === "R" || status[0] === "C" || status[1] === "R" || status[1] === "C") && index + 1 < fields.length) {
			entry.originalPath = fields[++index]
		}

		entries.push(entry)
	}

	return entries
}

function readGitStatusPorcelain(cwd: string): GitStatusEntry[] {
	const output = execFileSync("git", ["status", "--porcelain", "-z"], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	})
	return parseGitStatusPorcelainZ(output)
}

function hasStagedGitChanges(cwd: string): boolean {
	const staged = execFileSync("git", ["diff", "--cached", "--name-only"], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim()
	return staged.length > 0
}

function readGitCurrentBranch(cwd: string): string | undefined {
	try {
		const branch = execFileSync("git", ["branch", "--show-current"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim()
		return branch || undefined
	} catch {
		return undefined
	}
}

function runGit(args: string[], cwd: string): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim()
}

function isWithinOrEqual(candidate: string, root: string): boolean {
	const relative = path.relative(root, candidate)
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

export function resolveCursorGitWorkspaceRoot(route: CursorCompatibleUriRoute, workspaceRoots: string[]): string {
	const roots = workspaceRoots.map((root) => path.resolve(root)).filter(Boolean)
	if (roots.length === 0) {
		throw new Error("Git helper requires an open workspace.")
	}

	const requested =
		getCursorRouteString(route, "workspace") ||
		getCursorRouteString(route, "cwd") ||
		getCursorRouteConfigString(route, "workspace") ||
		getCursorRouteConfigString(route, "cwd")
	if (!requested) {
		return roots[0]
	}

	const candidate = path.resolve(path.isAbsolute(requested) ? requested : path.join(roots[0], requested))
	if (!roots.some((root) => isWithinOrEqual(candidate, root))) {
		throw new Error("Git helper workspace is outside the open workspace.")
	}
	return candidate
}

export function previewCursorGitHelper(route: CursorCompatibleUriRoute, workspaceRoots: string[]): CursorGitHelperPlan {
	if (route.kind !== "git-checkout" && route.kind !== "git-branch" && route.kind !== "git-commit") {
		throw new Error(`Unsupported git helper route: ${route.kind}`)
	}

	const workspaceRoot = resolveCursorGitWorkspaceRoot(route, workspaceRoots)
	const status = readGitStatusPorcelain(workspaceRoot)
	const dirty = status.length > 0
	const basePlan = {
		kind: route.kind,
		workspaceRoot,
		currentBranch: readGitCurrentBranch(workspaceRoot),
		dirty,
		statusEntryCount: status.length,
		executed: false as const,
	}

	if (route.kind === "git-checkout") {
		const targetInput =
			getCursorRouteString(route, "branch") ||
			getCursorRouteString(route, "ref") ||
			getCursorRouteString(route, "target") ||
			""
		const targetValidation = normalizeGitCheckoutTarget(targetInput, "Checkout target")
		const target = targetValidation.ok ? targetValidation.value : targetInput
		const command = ["git", "checkout", target]
		if (!targetValidation.ok) {
			return {
				...basePlan,
				actionable: false,
				command,
				confirmLabel: "Run Checkout",
				successMessage: `Checked out ${target}.`,
				target,
				reason: targetValidation.error,
			}
		}
		return {
			...basePlan,
			actionable: !dirty,
			command,
			confirmLabel: "Run Checkout",
			successMessage: `Checked out ${target}.`,
			target,
			...(dirty ? { reason: "Working tree has uncommitted changes; checkout needs manual review." } : {}),
		}
	}

	if (route.kind === "git-branch") {
		const branchInput = getCursorRouteString(route, "name") || getCursorRouteString(route, "branch") || ""
		const baseInput = getCursorRouteString(route, "baseBranch") || getCursorRouteString(route, "base")
		const branchValidation = normalizeGitBranchName(branchInput, "Branch name")
		const baseValidation = baseInput ? normalizeGitCheckoutTarget(baseInput, "Base ref") : undefined
		const branch = branchValidation.ok ? branchValidation.value : branchInput
		const base = baseValidation?.ok ? baseValidation.value : baseInput
		const checkout = getCursorRouteBoolean(route, "checkout")
		const command = checkout
			? ["git", "checkout", "-b", branch, ...(base ? [base] : [])]
			: ["git", "branch", branch, ...(base ? [base] : [])]
		if (!branchValidation.ok || (baseValidation && !baseValidation.ok)) {
			const reason = !branchValidation.ok
				? branchValidation.error
				: baseValidation && !baseValidation.ok
					? baseValidation.error
					: "Git branch deeplink contains an invalid branch or base ref."
			return {
				...basePlan,
				actionable: false,
				command,
				confirmLabel: checkout ? "Create and Checkout Branch" : "Create Branch",
				successMessage: checkout ? `Created and checked out ${branch}.` : `Created branch ${branch}.`,
				branch,
				...(base ? { base } : {}),
				checkout,
				reason,
			}
		}
		return {
			...basePlan,
			actionable: !(checkout && dirty),
			command,
			confirmLabel: checkout ? "Create and Checkout Branch" : "Create Branch",
			successMessage: checkout ? `Created and checked out ${branch}.` : `Created branch ${branch}.`,
			branch,
			...(base ? { base } : {}),
			checkout,
			...(checkout && dirty
				? { reason: "Working tree has uncommitted changes; branch checkout needs manual review." }
				: {}),
		}
	}

	const messageInput = getCursorRouteString(route, "message") || getCursorRouteString(route, "summary")
	const push = getCursorRouteBoolean(route, "push")
	const amend = getCursorRouteBoolean(route, "amend")
	const messageValidation = messageInput ? normalizeGitCommitMessage(messageInput, "Commit message") : undefined
	const message = messageValidation?.ok ? messageValidation.value : messageInput
	const command = ["git", "commit", ...(amend ? ["--amend"] : []), ...(message ? ["-m", message] : [])]
	if (push) {
		return {
			...basePlan,
			actionable: false,
			command,
			confirmLabel: "Run Commit",
			successMessage: "Committed changes.",
			...(message ? { message } : {}),
			reason: "Direct push from git commit deeplinks requires separate manual confirmation.",
		}
	}
	if (!messageValidation?.ok) {
		return {
			...basePlan,
			actionable: false,
			command,
			confirmLabel: "Run Commit",
			successMessage: "Committed changes.",
			...(message ? { message } : {}),
			reason: messageValidation?.error ?? "Git commit deeplink requires a message or summary before committing.",
		}
	}
	const files = splitCursorGitFiles(getCursorRouteString(route, "files"))
	try {
		assertSafeGitPathspecs(files)
	} catch (error) {
		return {
			...basePlan,
			actionable: false,
			command,
			confirmLabel: "Run Commit",
			successMessage: "Committed changes.",
			message,
			amend,
			files,
			reason: error instanceof Error ? error.message : "Git commit deeplink contains unsafe file pathspecs.",
		}
	}
	const all = getCursorRouteBoolean(route, "all")
	const staged = getCursorRouteBoolean(route, "staged") || (!all && files.length === 0)
	const stagingDescription = all
		? "stage all changes with git add -A"
		: files.length > 0
			? `stage ${files.length} pathspec${files.length === 1 ? "" : "s"}`
			: "use existing staged changes"
	if (staged && !hasStagedGitChanges(workspaceRoot)) {
		return {
			...basePlan,
			actionable: false,
			command,
			confirmLabel: "Run Commit",
			successMessage: "Committed changes.",
			message,
			all,
			staged,
			files,
			amend,
			stagingDescription,
			reason: "No staged changes are available to commit.",
		}
	}
	return {
		...basePlan,
		actionable: true,
		command,
		confirmLabel: "Run Commit",
		successMessage: "Committed changes.",
		message,
		all,
		staged,
		files,
		amend,
		stagingDescription,
	}
}

export function executeCursorGitHelper(route: CursorCompatibleUriRoute, plan: CursorGitHelperPlan): CursorGitHelperResult {
	if (!plan.actionable) {
		return plan
	}

	if (plan.kind === "git-checkout") {
		runGit(plan.command.slice(1), plan.workspaceRoot)
		return {
			...plan,
			executed: true,
			currentBranch: readGitCurrentBranch(plan.workspaceRoot),
		}
	}

	if (plan.kind === "git-branch") {
		runGit(plan.command.slice(1), plan.workspaceRoot)
		return {
			...plan,
			executed: true,
			currentBranch: readGitCurrentBranch(plan.workspaceRoot),
		}
	}

	const files = plan.files ?? splitCursorGitFiles(getCursorRouteString(route, "files"))
	if (plan.all ?? getCursorRouteBoolean(route, "all")) {
		runGit(["add", "-A"], plan.workspaceRoot)
	} else if (files.length > 0) {
		runGit(["add", "--", ...files], plan.workspaceRoot)
	}
	if (!hasStagedGitChanges(plan.workspaceRoot)) {
		return {
			...plan,
			actionable: false,
			executed: false,
			reason: "No staged changes are available to commit.",
		}
	}
	runGit(plan.command.slice(1), plan.workspaceRoot)
	return {
		...plan,
		executed: true,
		commitHash: runGit(["rev-parse", "--short", "HEAD"], plan.workspaceRoot),
		currentBranch: readGitCurrentBranch(plan.workspaceRoot),
	}
}

export function formatCursorGitCommand(command: string[]): string {
	return command.map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ")
}

export function formatCursorGitHelperDetail(plan: CursorGitHelperPlan | CursorGitHelperResult): string {
	return [
		`Workspace: ${plan.workspaceRoot}`,
		`Current branch: ${plan.currentBranch ?? "(detached or unknown)"}`,
		`Working tree entries: ${plan.statusEntryCount}`,
		`Command: ${formatCursorGitCommand(plan.command)}`,
		...(plan.target ? [`Target: ${plan.target}`] : []),
		...(plan.branch ? [`Branch: ${plan.branch}`] : []),
		...(plan.base ? [`Base: ${plan.base}`] : []),
		...(plan.checkout !== undefined ? [`Checkout after create: ${plan.checkout ? "yes" : "no"}`] : []),
		...(plan.message ? [`Commit message: ${plan.message}`] : []),
		...(plan.stagingDescription ? [`Staging: ${plan.stagingDescription}`] : []),
		...(plan.files && plan.files.length > 0 ? [`Files: ${plan.files.join(", ")}`] : []),
		...(plan.amend ? ["Amend: yes"] : []),
		...("commitHash" in plan && plan.commitHash ? [`Commit: ${plan.commitHash}`] : []),
		...(plan.reason ? [`Reason: ${plan.reason}`] : []),
	].join("\n")
}
