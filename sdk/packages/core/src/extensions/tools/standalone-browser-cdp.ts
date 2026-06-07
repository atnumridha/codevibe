import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolContext } from "@cline/shared";
import { redactSensitiveBrowserText } from "./browser-redaction";
import {
	getStandaloneBrowserAutomationStatus,
	type StandaloneBrowserAutomationStatus,
} from "./standalone-browser";
import type {
	BrowserActionInput,
	BrowserScreenshotInput,
	BrowserSnapshotInput,
} from "./schemas";
import type {
	BrowserActionResult,
	BrowserSnapshotResult,
} from "./types";

type WebSocketLike = {
	send: (data: string) => void;
	close: () => void;
	addEventListener?: (
		type: string,
		listener: (event: { data?: unknown }) => void,
	) => void;
	onopen?: (() => void) | null;
	onmessage?: ((event: { data?: unknown }) => void) | null;
	onerror?: ((event: unknown) => void) | null;
	onclose?: (() => void) | null;
};

type CdpResult = Record<string, unknown>;
type CdpEventHandler = (params: Record<string, unknown>) => void;

type StandaloneBrowserAvailability = {
	available: boolean;
	reason?: string;
	nextStep?: string;
	executablePath?: string;
};

export type StandaloneBrowserCdpOptions = {
	host: string;
	viewport?: { width: number; height: number };
	safeBrowserEvaluateEnabled?: boolean;
	executablePath?: string;
};

const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const MAX_SNAPSHOT_TEXT_LENGTH = 12_000;
const MAX_SNAPSHOT_HTML_LENGTH = 12_000;
const MAX_LOG_LINES = 100;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateText(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, maxLength)}\n[truncated]`;
}

function stringifyError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function serializeEvaluateResult(value: unknown): string {
	if (value === undefined) return "undefined";
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
}

async function getOpenPort(): Promise<number> {
	return await new Promise<number>((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port =
				address && typeof address === "object" ? address.port : undefined;
			server.close(() => {
				if (typeof port === "number") {
					resolve(port);
				} else {
					reject(new Error("failed to allocate browser debug port"));
				}
			});
		});
	});
}

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	message: string,
): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

async function fetchJson<T>(
	url: string,
	init?: RequestInit,
	timeoutMs = 5_000,
): Promise<T> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, { ...init, signal: controller.signal });
		if (!response.ok) {
			throw new Error(`HTTP ${response.status} from ${url}`);
		}
		return (await response.json()) as T;
	} finally {
		clearTimeout(timeout);
	}
}

function configuredChromeExecutable(): string | undefined {
	const explicit =
		process.env.CODEVIBE_BROWSER_EXECUTABLE ||
		process.env.CHROME_PATH ||
		process.env.PUPPETEER_EXECUTABLE_PATH;
	return explicit && explicit.trim() ? explicit.trim() : undefined;
}

function candidateChromeExecutables(): string[] {
	const explicit = configuredChromeExecutable();
	const candidates = explicit ? [explicit] : [];
	if (process.platform === "darwin") {
		candidates.push(
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		);
	}
	if (process.platform === "linux") {
		candidates.push(
			"/usr/bin/google-chrome",
			"/usr/bin/google-chrome-stable",
			"/usr/bin/chromium",
			"/usr/bin/chromium-browser",
			"/snap/bin/chromium",
		);
	}
	if (process.platform === "win32") {
		for (const root of [
			process.env.PROGRAMFILES,
			process.env["PROGRAMFILES(X86)"],
			process.env.LOCALAPPDATA,
		]) {
			if (!root) continue;
			candidates.push(
				join(root, "Google", "Chrome", "Application", "chrome.exe"),
				join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
			);
		}
	}
	return [...new Set(candidates)];
}

function resolveChromeExecutable(
	explicitPath?: string,
): StandaloneBrowserAvailability {
	const explicit = explicitPath || configuredChromeExecutable();
	if (explicit) {
		return existsSync(explicit)
			? { available: true, executablePath: explicit }
			: {
					available: false,
					reason: `Configured Chrome executable does not exist: ${explicit}`,
					nextStep:
						"Set CODEVIBE_BROWSER_EXECUTABLE to a valid Chrome, Chromium, or Edge executable.",
				};
	}
	const executablePath = candidateChromeExecutables().find((candidate) =>
		existsSync(candidate),
	);
	if (executablePath) {
		return { available: true, executablePath };
	}
	return {
		available: false,
		reason: "No Chrome, Chromium, or Edge executable was found for standalone browser automation.",
		nextStep:
			"Install Chrome/Chromium or set CODEVIBE_BROWSER_EXECUTABLE to a browser executable.",
	};
}

function websocketAvailability(): StandaloneBrowserAvailability {
	const WebSocketCtor = (globalThis as { WebSocket?: unknown }).WebSocket;
	if (typeof WebSocketCtor === "function") return { available: true };
	return {
		available: false,
		reason: "This runtime does not provide a WebSocket client for Chrome DevTools Protocol.",
		nextStep:
			"Run CodeVibe with a Node or Bun runtime that provides global WebSocket.",
	};
}

function remoteValueToString(value: unknown): string {
	if (!value || typeof value !== "object") return String(value);
	const record = value as Record<string, unknown>;
	if ("unserializableValue" in record) return String(record.unserializableValue);
	if ("value" in record) return serializeEvaluateResult(record.value);
	if (typeof record.description === "string") return record.description;
	if (typeof record.type === "string") return record.type;
	return "";
}

function cdpErrorMessage(error: CdpResult): string {
	const message = typeof error.message === "string" ? error.message : "CDP error";
	const data = typeof error.data === "string" ? `: ${error.data}` : "";
	return `${message}${data}`;
}

class CdpConnection {
	private nextId = 1;
	private readonly pending = new Map<
		number,
		{
			resolve: (value: CdpResult) => void;
			reject: (error: Error) => void;
			timeout: ReturnType<typeof setTimeout>;
		}
	>();
	private readonly handlers = new Map<string, Set<CdpEventHandler>>();

	private constructor(private readonly socket: WebSocketLike) {
		const onMessage = (event: { data?: unknown }) => {
			this.handleMessage(event.data);
		};
		if (typeof socket.addEventListener === "function") {
			socket.addEventListener("message", onMessage);
		} else {
			socket.onmessage = onMessage;
		}
		socket.onclose = () => {
			for (const [id, pending] of this.pending.entries()) {
				clearTimeout(pending.timeout);
				pending.reject(new Error(`CDP socket closed before response ${id}`));
			}
			this.pending.clear();
		};
	}

	static async connect(url: string): Promise<CdpConnection> {
		const WebSocketCtor = (globalThis as {
			WebSocket?: new (url: string) => WebSocketLike;
		}).WebSocket;
		if (typeof WebSocketCtor !== "function") {
			throw new Error(
				"Runtime does not provide WebSocket for Chrome DevTools Protocol.",
			);
		}
		const socket = new WebSocketCtor(url);
		await withTimeout(
			new Promise<void>((resolve, reject) => {
				const handleOpen = () => resolve();
				const handleError = (error: unknown) =>
					reject(new Error(`CDP socket failed: ${stringifyError(error)}`));
				if (typeof socket.addEventListener === "function") {
					socket.addEventListener("open", handleOpen);
					socket.addEventListener("error", handleError);
				} else {
					socket.onopen = handleOpen;
					socket.onerror = handleError;
				}
			}),
			10_000,
			"Timed out connecting to Chrome DevTools Protocol.",
		);
		return new CdpConnection(socket);
	}

	async send(
		method: string,
		params: Record<string, unknown> = {},
		timeoutMs = 15_000,
	): Promise<CdpResult> {
		const id = this.nextId++;
		const response = new Promise<CdpResult>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`CDP command timed out: ${method}`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timeout });
		});
		this.socket.send(JSON.stringify({ id, method, params }));
		return await response;
	}

	on(method: string, handler: CdpEventHandler): () => void {
		const handlers = this.handlers.get(method) ?? new Set<CdpEventHandler>();
		handlers.add(handler);
		this.handlers.set(method, handlers);
		return () => handlers.delete(handler);
	}

	close(): void {
		this.socket.close();
	}

	private handleMessage(data: unknown): void {
		const text =
			typeof data === "string"
				? data
				: data instanceof ArrayBuffer
					? Buffer.from(data).toString("utf8")
					: Buffer.isBuffer(data)
						? data.toString("utf8")
						: String(data ?? "");
		let message: CdpResult;
		try {
			message = JSON.parse(text) as CdpResult;
		} catch {
			return;
		}
		const id = typeof message.id === "number" ? message.id : undefined;
		if (id !== undefined) {
			const pending = this.pending.get(id);
			if (!pending) return;
			this.pending.delete(id);
			clearTimeout(pending.timeout);
			if (message.error && typeof message.error === "object") {
				pending.reject(
					new Error(cdpErrorMessage(message.error as CdpResult)),
				);
				return;
			}
			pending.resolve((message.result as CdpResult | undefined) ?? {});
			return;
		}
		const method = typeof message.method === "string" ? message.method : "";
		const params =
			message.params && typeof message.params === "object"
				? (message.params as CdpResult)
				: {};
		for (const handler of this.handlers.get(method) ?? []) {
			handler(params);
		}
	}
}

export class StandaloneBrowserCdpAutomation {
	private browserProcess: ChildProcess | undefined;
	private page: CdpConnection | undefined;
	private debugPort: number | undefined;
	private profileDir: string | undefined;
	private logs: string[] = [];
	private currentMousePosition: string | undefined;

	constructor(private readonly options: StandaloneBrowserCdpOptions) {}

	getStatus(): StandaloneBrowserAutomationStatus {
		const websocket = websocketAvailability();
		const chrome = resolveChromeExecutable(this.options.executablePath);
		const available = websocket.available && chrome.available;
		return getStandaloneBrowserAutomationStatus({
			host: this.options.host,
			hasBrowserSnapshotExecutor: available,
			hasBrowserActionExecutor: available,
			hasBrowserScreenshotExecutor: available,
			safeBrowserEvaluateEnabled:
				this.options.safeBrowserEvaluateEnabled === true,
			unavailableReason: websocket.available ? chrome.reason : websocket.reason,
			nextStep: websocket.available ? chrome.nextStep : websocket.nextStep,
		});
	}

	async browserSnapshot(
		input: BrowserSnapshotInput = {},
		_context?: AgentToolContext,
	): Promise<BrowserSnapshotResult> {
		if (input.tab_id && input.tab_id !== "active") {
			throw new Error("Only the active standalone browser tab is supported.");
		}
		await this.ensurePage();
		return await this.captureSnapshot({
			includeScreenshot: input.include_screenshot === true,
			includeLogs: input.include_logs !== false,
		});
	}

	async browserScreenshot(
		input: BrowserScreenshotInput = {},
		_context?: AgentToolContext,
	): Promise<BrowserSnapshotResult> {
		if (input.tab_id && input.tab_id !== "active") {
			throw new Error("Only the active standalone browser tab is supported.");
		}
		await this.ensurePage();
		return await this.captureBase({
			includeScreenshot: true,
			includeLogs: true,
			fullPage: input.full_page === true,
		});
	}

	async browserAction(
		input: BrowserActionInput,
		_context?: AgentToolContext,
	): Promise<BrowserActionResult> {
		if (input.tab_id && input.tab_id !== "active") {
			throw new Error("Only the active standalone browser tab is supported.");
		}
		switch (input.action) {
			case "launch": {
				if (!input.url) throw new Error("url is required for launch");
				await this.launch(input.url);
				return await this.captureSnapshot({
					includeScreenshot: true,
					includeLogs: true,
				});
			}
			case "click": {
				if (!input.coordinate) throw new Error("coordinate is required for click");
				await this.ensurePage();
				await this.click(input.coordinate);
				return await this.captureSnapshot({
					includeScreenshot: true,
					includeLogs: true,
				});
			}
			case "type": {
				if (!input.text) throw new Error("text is required for type");
				await this.ensurePage();
				await this.page!.send("Input.insertText", { text: input.text });
				return await this.captureSnapshot({
					includeScreenshot: true,
					includeLogs: true,
				});
			}
			case "scroll_down":
			case "scroll_up": {
				await this.ensurePage();
				const top = input.action === "scroll_down" ? 600 : -600;
				await this.evaluateExpression(
					`window.scrollBy({ top: ${top}, behavior: "auto" })`,
				);
				await delay(300);
				return await this.captureSnapshot({
					includeScreenshot: true,
					includeLogs: true,
				});
			}
			case "evaluate": {
				if (this.options.safeBrowserEvaluateEnabled !== true) {
					throw new Error(
						"browser_action evaluate is disabled. Enable safe browser evaluate before running JavaScript in a page.",
					);
				}
				if (!input.text) throw new Error("text is required for evaluate");
				await this.ensurePage();
				const evaluationResult = await this.evaluateUserScript(input.text);
				return {
					...(await this.captureSnapshot({
						includeScreenshot: true,
						includeLogs: true,
					})),
					evaluationResult,
				};
			}
			case "close":
				await this.close();
				return {};
			default:
				throw new Error(`Unsupported browser action: ${String(input.action)}`);
		}
	}

	async close(): Promise<void> {
		this.page?.close();
		this.page = undefined;
		if (this.browserProcess) {
			this.browserProcess.kill();
			this.browserProcess = undefined;
		}
		if (this.profileDir) {
			await rm(this.profileDir, { recursive: true, force: true }).catch(() => {});
			this.profileDir = undefined;
		}
		this.debugPort = undefined;
		this.currentMousePosition = undefined;
		this.logs = [];
	}

	private async launch(url: string): Promise<void> {
		await this.close();
		const status = this.getStatus();
		if (!status.available) {
			throw new Error(status.reason ?? "Standalone browser is unavailable.");
		}
		const executablePath = resolveChromeExecutable(
			this.options.executablePath,
		).executablePath;
		if (!executablePath) {
			throw new Error("Chrome executable is unavailable.");
		}
		const port = await getOpenPort();
		const profileDir = await mkdtemp(join(tmpdir(), "codevibe-browser-"));
		this.debugPort = port;
		this.profileDir = profileDir;
		this.browserProcess = spawn(
			executablePath,
			[
				`--remote-debugging-port=${port}`,
				`--user-data-dir=${profileDir}`,
				"--no-first-run",
				"--no-default-browser-check",
				"--disable-notifications",
				"--disable-background-networking",
				`--window-size=${this.viewport.width},${this.viewport.height}`,
				"about:blank",
			],
			{ detached: true, stdio: "ignore" },
		);
		this.browserProcess.unref();
		const baseUrl = `http://127.0.0.1:${port}`;
		await this.waitForChrome(baseUrl);
		const target = await this.createTarget(baseUrl, url);
		if (typeof target.webSocketDebuggerUrl !== "string") {
			throw new Error("Chrome did not return a page websocket endpoint.");
		}
		this.page = await CdpConnection.connect(target.webSocketDebuggerUrl);
		await this.setupPage();
		await this.waitForLoad();
	}

	private async createTarget(
		baseUrl: string,
		url: string,
	): Promise<Record<string, unknown>> {
		const encoded = encodeURIComponent(url);
		try {
			return await fetchJson<Record<string, unknown>>(
				`${baseUrl}/json/new?${encoded}`,
				{ method: "PUT" },
			);
		} catch {
			return await fetchJson<Record<string, unknown>>(
				`${baseUrl}/json/new?${encoded}`,
			);
		}
	}

	private async waitForChrome(baseUrl: string): Promise<void> {
		const deadline = Date.now() + 10_000;
		let lastError = "";
		while (Date.now() < deadline) {
			try {
				await fetchJson<Record<string, unknown>>(`${baseUrl}/json/version`);
				return;
			} catch (error) {
				lastError = stringifyError(error);
				await delay(150);
			}
		}
		throw new Error(`Timed out waiting for Chrome debug endpoint: ${lastError}`);
	}

	private async setupPage(): Promise<void> {
		await this.ensurePage();
		await Promise.all([
			this.page!.send("Page.enable"),
			this.page!.send("Runtime.enable"),
			this.page!.send("Log.enable").catch(() => ({})),
			this.page!.send("Emulation.setDeviceMetricsOverride", {
				width: this.viewport.width,
				height: this.viewport.height,
				deviceScaleFactor: 1,
				mobile: false,
			}).catch(() => ({})),
		]);
		this.page!.on("Runtime.consoleAPICalled", (params) => {
			const args = Array.isArray(params.args) ? params.args : [];
			this.pushLog(args.map(remoteValueToString).filter(Boolean).join(" "));
		});
		this.page!.on("Log.entryAdded", (params) => {
			const entry =
				params.entry && typeof params.entry === "object"
					? (params.entry as Record<string, unknown>)
					: {};
			const text =
				typeof entry.text === "string"
					? entry.text
					: typeof entry.url === "string"
						? entry.url
						: "";
			this.pushLog(text);
		});
		this.page!.on("Runtime.exceptionThrown", (params) => {
			const details =
				params.exceptionDetails && typeof params.exceptionDetails === "object"
					? (params.exceptionDetails as Record<string, unknown>)
					: {};
			this.pushLog(
				`[Page Error] ${
					typeof details.text === "string" ? details.text : "uncaught exception"
				}`,
			);
		});
	}

	private async ensurePage(): Promise<void> {
		if (!this.page) {
			const status = this.getStatus();
			if (!status.available && status.reason) {
				throw new Error(status.reason);
			}
			throw new Error(
				"Browser is not launched. Start with browser_action launch before using browser tools.",
			);
		}
	}

	private async waitForLoad(timeoutMs = 7_000): Promise<void> {
		await this.ensurePage();
		await withTimeout(
			new Promise<void>((resolve) => {
				const off = this.page!.on("Page.loadEventFired", () => {
					off();
					resolve();
				});
				setTimeout(() => {
					off();
					resolve();
				}, timeoutMs);
			}),
			timeoutMs + 500,
			"Timed out waiting for page load.",
		).catch(() => {});
	}

	private async click(coordinate: string): Promise<void> {
		const [x, y] = coordinate.split(",").map((part) => Number(part.trim()));
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			throw new Error("coordinate must be formatted as x,y");
		}
		this.currentMousePosition = `${x},${y}`;
		await this.page!.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x,
			y,
			button: "none",
		});
		await this.page!.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			x,
			y,
			button: "left",
			clickCount: 1,
		});
		await this.page!.send("Input.dispatchMouseEvent", {
			type: "mouseReleased",
			x,
			y,
			button: "left",
			clickCount: 1,
		});
		await this.waitForLoad(1_500);
	}

	private async captureSnapshot(input: {
		includeScreenshot: boolean;
		includeLogs: boolean;
		fullPage?: boolean;
	}): Promise<BrowserSnapshotResult> {
		await this.ensurePage();
		const [base, title, text, html] = await Promise.all([
			this.captureBase(input),
			this.evaluateExpression<string>("document.title").catch(() => ""),
			this.evaluateExpression<string>(
				"(document.body?.innerText || document.documentElement?.innerText || '').trim()",
			).catch(() => ""),
			this.evaluateExpression<string>("document.documentElement?.outerHTML || ''")
				.catch(() => ""),
		]);
		return {
			...base,
			title,
			text: truncateText(typeof text === "string" ? text : "", MAX_SNAPSHOT_TEXT_LENGTH),
			html: truncateText(typeof html === "string" ? html : "", MAX_SNAPSHOT_HTML_LENGTH),
			nodes: [
				{
					role: "document",
					name: title || undefined,
					text:
						typeof text === "string" && text.trim()
							? truncateText(text.trim(), 1_000)
							: undefined,
				},
			],
		};
	}

	private async captureBase(input: {
		includeScreenshot: boolean;
		includeLogs: boolean;
		fullPage?: boolean;
	}): Promise<BrowserSnapshotResult> {
		await this.ensurePage();
		const url = await this.evaluateExpression<string>("location.href").catch(
			() => undefined,
		);
		const screenshot = input.includeScreenshot
			? await this.captureScreenshot(input.fullPage === true)
			: undefined;
		return {
			url: typeof url === "string" ? url : undefined,
			screenshot,
			logs: input.includeLogs ? this.drainLogs() : undefined,
			currentMousePosition: this.currentMousePosition,
		};
	}

	private async captureScreenshot(fullPage: boolean): Promise<string> {
		await this.ensurePage();
		const result = await this.page!.send("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: fullPage,
			fromSurface: true,
		});
		const data = typeof result.data === "string" ? result.data : "";
		if (!data) throw new Error("Chrome did not return screenshot data.");
		return `data:image/png;base64,${data}`;
	}

	private async evaluateExpression<T>(expression: string): Promise<T> {
		await this.ensurePage();
		const result = await this.page!.send("Runtime.evaluate", {
			expression,
			returnByValue: true,
			awaitPromise: true,
		});
		if (result.exceptionDetails) {
			throw new Error("Browser expression failed.");
		}
		const remote =
			result.result && typeof result.result === "object"
				? (result.result as Record<string, unknown>)
				: {};
		return remote.value as T;
	}

	private async evaluateUserScript(script: string): Promise<string> {
		const source = JSON.stringify(script);
		const result = await this.evaluateExpression<unknown>(`
			(async () => {
				const source = ${source};
				try {
					return await Promise.resolve(Function('"use strict"; return (' + source + ')')());
				} catch {
					return await Promise.resolve(Function('"use strict"; ' + source)());
				}
			})()
		`);
		return serializeEvaluateResult(result);
	}

	private pushLog(value: string | undefined): void {
		const text = redactSensitiveBrowserText(value?.trim());
		if (!text) return;
		this.logs.push(text);
		if (this.logs.length > MAX_LOG_LINES) {
			this.logs = this.logs.slice(-MAX_LOG_LINES);
		}
	}

	private drainLogs(): string | undefined {
		if (this.logs.length === 0) return undefined;
		const logs = this.logs.join("\n");
		this.logs = [];
		return logs;
	}

	private get viewport(): { width: number; height: number } {
		return this.options.viewport ?? DEFAULT_VIEWPORT;
	}
}

export function createStandaloneBrowserCdpAutomation(
	options: StandaloneBrowserCdpOptions,
): StandaloneBrowserCdpAutomation {
	return new StandaloneBrowserCdpAutomation(options);
}
