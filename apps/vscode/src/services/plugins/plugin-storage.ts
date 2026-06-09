import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

interface PluginManifest {
	paths?: string[]
}

interface PluginPackageManifest {
	plugins?: PluginManifest[]
}

export function resolveCodeVibeDir(): string {
	const envDir = process.env.CODEVIBE_DIR?.trim() || process.env.CLINE_DIR?.trim()
	if (envDir) {
		return envDir
	}
	return join(homedir(), ".codevibe")
}

export const resolveClineDir = resolveCodeVibeDir

export function isPluginModulePath(path: string): boolean {
	const dot = path.lastIndexOf(".")
	if (dot === -1) {
		return false
	}
	return path.slice(dot) === ".js" || path.slice(dot) === ".ts"
}

function readPluginPackageManifest(packageJsonPath: string): PluginPackageManifest | null {
	try {
		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
			codevibe?: PluginPackageManifest
			cline?: PluginPackageManifest
		}
		if (packageJson.codevibe && typeof packageJson.codevibe === "object") {
			return packageJson.codevibe
		}
		return packageJson.cline && typeof packageJson.cline === "object" ? packageJson.cline : null
	} catch {
		return null
	}
}

function getManifestPluginEntries(manifest: PluginPackageManifest | null): string[] {
	const entries = manifest?.plugins
	if (!Array.isArray(entries)) {
		return []
	}
	return entries.flatMap((entry) => entry.paths ?? [])
}

export function resolvePluginModuleEntries(directoryPath: string): string[] | null {
	const root = resolve(directoryPath)
	if (!existsSync(root) || !statSync(root).isDirectory()) {
		return null
	}

	const packageJsonPath = join(root, "package.json")
	if (existsSync(packageJsonPath)) {
		const entries = getManifestPluginEntries(readPluginPackageManifest(packageJsonPath))
			.map((entry) => resolve(root, entry))
			.filter((entryPath) => existsSync(entryPath) && statSync(entryPath).isFile() && isPluginModulePath(entryPath))
		if (entries.length > 0) {
			return entries
		}
	}

	for (const candidate of ["index.ts", "index.js"]) {
		const candidatePath = join(root, candidate)
		if (existsSync(candidatePath) && statSync(candidatePath).isFile()) {
			return [candidatePath]
		}
	}

	const directEntries = readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isFile() && isPluginModulePath(entry.name))
		.map((entry) => join(root, entry.name))
		.sort((left, right) => left.localeCompare(right))
	return directEntries.length > 0 ? directEntries : null
}
