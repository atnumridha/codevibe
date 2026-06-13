import type { Terminal } from "@microsoft/tui-test/lib/terminal/term";
import { expectVisible } from "../terminal.js";

export async function waitForAuthScreen(terminal: Terminal): Promise<void> {
	await expectVisible(terminal, [
		"Sign in with Codie Cloud",
		"Sign in with Codie",
		"Bring your own provider",
	]);
}
