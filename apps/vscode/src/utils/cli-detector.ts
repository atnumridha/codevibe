import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

/**
 * Check if the CodeVibe CLI tool is installed on the system.
 * The legacy cline command remains a compatibility fallback for existing installs.
 * @returns true if CLI is installed, false otherwise
 */
export async function isClineCliInstalled(): Promise<boolean> {
	for (const command of ["codevibe version", "cline version"]) {
		try {
			const { stdout } = await execAsync(command, {
				timeout: 5000, // 5 second timeout
			})

			if (
				stdout.includes("CodeVibe CLI Version") ||
				stdout.includes("CodeVibe Core Version") ||
				stdout.includes("Cline CLI Version") ||
				stdout.includes("Cline Core Version")
			) {
				return true
			}
		} catch {
			// Command failed, which likely means CLI is not installed or not in PATH.
		}
	}

	return false
}
