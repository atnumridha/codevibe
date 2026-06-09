import { readCodeVibeEnv } from "./codevibe-env";

export const CLINE_RUN_AS_HUB_DAEMON_ENV = "CLINE_RUN_AS_HUB_DAEMON";

export function isHubDaemonProcess(
	env: Record<string, string | undefined> = process.env,
): boolean {
	return readCodeVibeEnv(CLINE_RUN_AS_HUB_DAEMON_ENV, env) === "1";
}
