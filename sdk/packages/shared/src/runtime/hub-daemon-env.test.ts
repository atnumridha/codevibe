import { describe, expect, it } from "vitest";
import { codeVibeEnvName } from "./codevibe-env";
import {
	CLINE_RUN_AS_HUB_DAEMON_ENV,
	isHubDaemonProcess,
} from "./hub-daemon-env";

describe("hub daemon environment helpers", () => {
	it("detects hub daemon mode from the shared sentinel", () => {
		expect(
			isHubDaemonProcess({
				[CLINE_RUN_AS_HUB_DAEMON_ENV]: "1",
			}),
		).toBe(true);
		expect(
			isHubDaemonProcess({
				[CLINE_RUN_AS_HUB_DAEMON_ENV]: "0",
			}),
		).toBe(false);
	});

	it("prefers the CodeVibe daemon sentinel over the legacy Cline sentinel", () => {
		expect(
			isHubDaemonProcess({
				[codeVibeEnvName(CLINE_RUN_AS_HUB_DAEMON_ENV)]: "1",
				[CLINE_RUN_AS_HUB_DAEMON_ENV]: "0",
			}),
		).toBe(true);
	});
});
