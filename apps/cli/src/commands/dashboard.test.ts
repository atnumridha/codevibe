import { mkdirSync, mkdtempSync } from "node:fs";
import { arch, platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDashboardCommand, waitForProcessShutdown } from "./dashboard";

const ENV_KEYS = [
	"WORKSPACE_ROOT",
	"HOST",
	"CODEVIBE_HUB_DASHBOARD_PORT",
	"CLINE_HUB_DASHBOARD_PORT",
	"PUBLIC_URL",
	"ROOM_SECRET",
	"CODEVIBE_HUB_WEBVIEW_DIST_DIR",
	"CLINE_HUB_WEBVIEW_DIST_DIR",
	"CODEVIBE_WRAPPER_PATH",
	"CLINE_WRAPPER_PATH",
] as const;

const originalEnv = Object.fromEntries(
	ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
	for (const key of ENV_KEYS) {
		const value = originalEnv[key];
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
});

describe("runDashboardCommand", () => {
	it("starts the dashboard server, opens the invite URL, and waits for shutdown", async () => {
		const output: string[] = [];
		const errors: string[] = [];
		const opened: string[] = [];
		const stop = vi.fn();
		let observedEnv:
			| {
					workspaceRoot: string | undefined;
					host: string | undefined;
					codevibePort: string | undefined;
					legacyPort: string | undefined;
					publicUrl: string | undefined;
					roomSecret: string | undefined;
					codevibeWebviewDistDir: string | undefined;
					legacyWebviewDistDir: string | undefined;
			  }
			| undefined;
		const webviewDistDir = mkdtempSync(join(tmpdir(), "codevibe-webview-dist-"));
		mkdirSync(webviewDistDir, { recursive: true });
		process.env.CODEVIBE_HUB_WEBVIEW_DIST_DIR = webviewDistDir;

		const exitCode = await runDashboardCommand({
			cwd: "sdk",
			host: "127.0.0.1",
			port: "9090",
			publicUrl: "http://127.0.0.1:9090",
			roomSecret: "secret",
			io: {
				writeln: (text) => output.push(text ?? ""),
				writeErr: (text) => errors.push(text),
			},
			startServer: async () => {
				observedEnv = {
					workspaceRoot: process.env.WORKSPACE_ROOT,
					host: process.env.HOST,
					codevibePort: process.env.CODEVIBE_HUB_DASHBOARD_PORT,
					legacyPort: process.env.CLINE_HUB_DASHBOARD_PORT,
					publicUrl: process.env.PUBLIC_URL,
					roomSecret: process.env.ROOM_SECRET,
					codevibeWebviewDistDir: process.env.CODEVIBE_HUB_WEBVIEW_DIST_DIR,
					legacyWebviewDistDir: process.env.CLINE_HUB_WEBVIEW_DIST_DIR,
				};
				return {
					listenUrl: "http://127.0.0.1:9090/",
					publicUrl: "http://127.0.0.1:9090",
					inviteUrl: "http://127.0.0.1:9090/?roomSecret=secret",
					hubUrl: "ws://127.0.0.1:25463/hub",
					stop,
				};
			},
			openUrl: async (url) => {
				opened.push(url);
			},
			waitForShutdown: async (server) => {
				await server.stop();
			},
		});

		expect(exitCode).toBe(0);
		expect(observedEnv).toEqual({
			workspaceRoot: resolve("sdk"),
			host: "127.0.0.1",
			codevibePort: "9090",
			legacyPort: "9090",
			publicUrl: "http://127.0.0.1:9090",
			roomSecret: "secret",
			codevibeWebviewDistDir: webviewDistDir,
			legacyWebviewDistDir: webviewDistDir,
		});
		expect(opened).toEqual(["http://127.0.0.1:9090/?roomSecret=secret"]);
		expect(stop).toHaveBeenCalledTimes(1);
		expect(output.join("\n")).toContain("CodeVibe dashboard listening at");
		expect(output.join("\n")).toContain("ws://127.0.0.1:25463/hub");
		expect(errors).toEqual([]);
		expect(process.env.WORKSPACE_ROOT).toBe(originalEnv.WORKSPACE_ROOT);
		expect(process.env.CODEVIBE_HUB_WEBVIEW_DIST_DIR).toBe(webviewDistDir);
	});

	it("honors --no-open behavior", async () => {
		const openUrl = vi.fn();

		const exitCode = await runDashboardCommand({
			openBrowser: false,
			io: {
				writeln: () => {},
				writeErr: () => {},
			},
			startServer: async () => ({
				listenUrl: "http://127.0.0.1:8787/",
				publicUrl: "http://127.0.0.1:8787",
				inviteUrl: "http://127.0.0.1:8787",
				stop: vi.fn(),
			}),
			openUrl,
			waitForShutdown: async () => {},
		});

		expect(exitCode).toBe(0);
		expect(openUrl).not.toHaveBeenCalled();
	});

	it("finds webview assets from the published wrapper package layout", async () => {
		const root = mkdtempSync(join(tmpdir(), "codevibe-wrapper-layout-"));
		const wrapperPath = join(root, "node_modules", "codevibe", "bin", "codevibe");
		const platformName = platform() === "win32" ? "windows" : platform();
		const webviewDistDir = join(
			root,
			"node_modules",
			"codevibe",
			"node_modules",
			"@codevibe",
			`cli-${platformName}-${arch()}`,
			"cline-hub",
			"webview",
		);
		mkdirSync(join(wrapperPath, ".."), { recursive: true });
		mkdirSync(webviewDistDir, { recursive: true });
		process.env.CODEVIBE_WRAPPER_PATH = wrapperPath;
		delete process.env.CODEVIBE_HUB_WEBVIEW_DIST_DIR;
		delete process.env.CLINE_HUB_WEBVIEW_DIST_DIR;
		let observedWebviewDistDir: string | undefined;

		const exitCode = await runDashboardCommand({
			openBrowser: false,
			io: {
				writeln: () => {},
				writeErr: () => {},
			},
			startServer: async () => {
				observedWebviewDistDir = process.env.CODEVIBE_HUB_WEBVIEW_DIST_DIR;
				return {
					listenUrl: "http://127.0.0.1:8787/",
					publicUrl: "http://127.0.0.1:8787",
					inviteUrl: "http://127.0.0.1:8787",
					stop: vi.fn(),
				};
			},
			waitForShutdown: async () => {},
		});

		expect(exitCode).toBe(0);
		expect(observedWebviewDistDir).toBe(webviewDistDir);
	});

	it("settles shutdown when server stop rejects", async () => {
		const shutdown = waitForProcessShutdown({
			listenUrl: "http://127.0.0.1:8787/",
			publicUrl: "http://127.0.0.1:8787",
			inviteUrl: "http://127.0.0.1:8787",
			stop: vi.fn(async () => {
				throw new Error("stop failed");
			}),
		});

		process.emit("SIGINT", "SIGINT");

		await expect(shutdown).rejects.toThrow("stop failed");
	});
});
