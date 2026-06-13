import { randomUUID } from "node:crypto"
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { URL } from "node:url"
import { ingestCursorAutomationEvents } from "./CursorAutomationIngestStore"
import { parseAutomationEventNdjson, type ParseAutomationEventNdjsonOptions } from "./AutomationEventNdjson"

const AUTO_PORT_START = 7242
const AUTO_PORT_END = 7942
const DEFAULT_BIND_ADDRESS = "127.0.0.1"
const DEFAULT_MAX_LINE_BYTES = 16 * 1024
const DEFAULT_MAX_EVENTS = 100
const MAX_MAX_LINE_BYTES = 64 * 1024
const MAX_MAX_EVENTS = 1_000
const MAX_REQUEST_BYTES = 1024 * 1024
const CURSOR_BOOLEAN_STRING_VALUES = new Set(["true", "false", "1", "0", "yes", "no"])

export interface CursorNdjsonIngestServerSettings {
	port?: number
	bindAddress?: string
}

export interface CursorNdjsonIngestServerStatus {
	running: boolean
	bindAddress: string
	port?: number
	url?: string
	sessionId?: string
}

interface ParsedIngestPayload {
	ndjson: string
	strict: boolean
	options: ParseAutomationEventNdjsonOptions
	paramKeys: string[]
	configKeys: string[]
}

function normalizeBindAddress(bindAddress?: string): string {
	return bindAddress?.trim() || DEFAULT_BIND_ADDRESS
}

function normalizePort(port?: number): number {
	return Number.isInteger(port) && port !== undefined && port >= 0 && port <= 65535 ? port : 0
}

function parseBoolean(value: unknown, key: string): boolean {
	if (value === undefined) {
		return false
	}
	if (typeof value === "boolean") {
		return value
	}
	const normalized = typeof value === "string" ? value.trim().toLowerCase() : undefined
	if (!normalized || !CURSOR_BOOLEAN_STRING_VALUES.has(normalized)) {
		throw new Error(`${key} must be one of true, false, 1, 0, yes, or no`)
	}
	return ["true", "1", "yes"].includes(normalized)
}

function readPositiveInteger(value: unknown, key: string, maximum: number): number | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined
	}
	const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN
	if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${key} must be a positive integer`)
	}
	if (parsed > maximum) {
		throw new Error(`${key} must be less than or equal to ${maximum}`)
	}
	return parsed
}

function readAllowedSources(value: unknown): string[] | undefined {
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : undefined
	if (!raw) {
		return undefined
	}
	if (raw.some((source) => typeof source !== "string")) {
		throw new Error("allowedSources must contain only strings")
	}
	const sources = raw.map((source) => source.trim()).filter(Boolean)
	return sources.length > 0 ? sources : undefined
}

function toPublicUrl(bindAddress: string, port: number): string {
	const host = bindAddress === "0.0.0.0" || bindAddress === "::" ? "127.0.0.1" : bindAddress
	const bracketedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host
	return `http://${bracketedHost}:${port}`
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
	const payload = `${JSON.stringify(body)}\n`
	response.writeHead(statusCode, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(payload),
	})
	response.end(payload)
}

function readDebugSessionId(request: IncomingMessage): string | undefined {
	const value = request.headers["x-debug-session-id"]
	const raw = Array.isArray(value) ? value[0] : value
	return typeof raw === "string" && raw.trim() ? raw.trim() : undefined
}

function readRequestBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let bytes = 0
		const chunks: Buffer[] = []
		request.on("data", (chunk: Buffer | string) => {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
			bytes += buffer.byteLength
			if (bytes > MAX_REQUEST_BYTES) {
				reject(new Error(`request body exceeds ${MAX_REQUEST_BYTES} byte limit`))
				request.destroy()
				return
			}
			chunks.push(buffer)
		})
		request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
		request.on("error", reject)
	})
}

function toPublicStatus(status: CursorNdjsonIngestServerStatus): CursorNdjsonIngestServerStatus {
	const publicStatus = { ...status }
	delete publicStatus.sessionId
	return publicStatus
}

function parseRequestPayload(request: IncomingMessage, rawBody: string): ParsedIngestPayload {
	const requestUrl = new URL(request.url || "/", "http://localhost")
	const query = requestUrl.searchParams
	const contentType = String(request.headers["content-type"] ?? "").toLowerCase()
	const fromJson = contentType.includes("application/json") && rawBody.trim() ? (JSON.parse(rawBody) as unknown) : undefined
	const record = fromJson && typeof fromJson === "object" && !Array.isArray(fromJson) ? (fromJson as Record<string, unknown>) : {}
	const config = record.config && typeof record.config === "object" && !Array.isArray(record.config) ? (record.config as Record<string, unknown>) : {}
	const read = (key: string): unknown => query.get(key) ?? record[key] ?? config[key]
	const ndjson = typeof read("ndjson") === "string" ? String(read("ndjson")) : typeof read("input") === "string" ? String(read("input")) : rawBody

	if (!ndjson.trim()) {
		throw new Error("ndjson or input is required")
	}

	const options: ParseAutomationEventNdjsonOptions = {
		defaultSource: typeof read("defaultSource") === "string" ? String(read("defaultSource")) : "cursor",
		allowedSources: readAllowedSources(read("allowedSources")),
		maxLineBytes: readPositiveInteger(read("maxLineBytes"), "maxLineBytes", MAX_MAX_LINE_BYTES) ?? DEFAULT_MAX_LINE_BYTES,
		maxEvents: readPositiveInteger(read("maxEvents"), "maxEvents", MAX_MAX_EVENTS) ?? DEFAULT_MAX_EVENTS,
	}

	return {
		ndjson,
		strict: parseBoolean(read("strict"), "strict"),
		options,
		paramKeys: Array.from(query.keys()).sort(),
		configKeys: Object.keys(config).sort(),
	}
}

function listen(server: Server, port: number, bindAddress: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const onError = (error: NodeJS.ErrnoException) => {
			server.off("listening", onListening)
			reject(error)
		}
		const onListening = () => {
			server.off("error", onError)
			const address = server.address()
			resolve(typeof address === "object" && address ? address.port : port)
		}
		server.once("error", onError)
		server.once("listening", onListening)
		server.listen(port, bindAddress)
	})
}

async function listenAuto(server: Server, bindAddress: string, excludedPort?: number): Promise<number> {
	let lastError: unknown
	for (let port = AUTO_PORT_START; port <= AUTO_PORT_END; port++) {
		if (port === excludedPort) {
			continue
		}
		try {
			return await listen(server, port, bindAddress)
		} catch (error) {
			lastError = error
			const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined
			if (code !== "EADDRINUSE") {
				throw error
			}
		}
	}
	throw lastError instanceof Error
		? lastError
		: new Error("No free Codie compatibility NDJSON ingest port was found")
}

export class CursorNdjsonIngestServer {
	private server?: Server
	private status: CursorNdjsonIngestServerStatus = {
		running: false,
		bindAddress: DEFAULT_BIND_ADDRESS,
	}

	constructor(private readonly storageDir: string) {}

	getStatus(): CursorNdjsonIngestServerStatus {
		return { ...this.status }
	}

	async start(settings: CursorNdjsonIngestServerSettings = {}): Promise<CursorNdjsonIngestServerStatus> {
		if (this.server && this.status.running) {
			return this.getStatus()
		}

		const bindAddress = normalizeBindAddress(settings.bindAddress)
		const requestedPort = normalizePort(settings.port)
		const sessionId = randomUUID()
		const server = http.createServer((request, response) => {
			void this.handleRequest(request, response)
		})
		const port = requestedPort > 0 ? await listen(server, requestedPort, bindAddress) : await listenAuto(server, bindAddress)

		this.server = server
		this.status = {
			running: true,
			bindAddress,
			port,
			url: toPublicUrl(bindAddress, port),
			sessionId,
		}
		return this.getStatus()
	}

	async reassignPort(settings: CursorNdjsonIngestServerSettings = {}): Promise<CursorNdjsonIngestServerStatus> {
		const previousPort = this.status.port
		await this.stop()
		const bindAddress = normalizeBindAddress(settings.bindAddress)
		const sessionId = randomUUID()
		const server = http.createServer((request, response) => {
			void this.handleRequest(request, response)
		})
		const port = await listenAuto(server, bindAddress, previousPort)
		this.server = server
		this.status = {
			running: true,
			bindAddress,
			port,
			url: toPublicUrl(bindAddress, port),
			sessionId,
		}
		return this.getStatus()
	}

	async stop(): Promise<CursorNdjsonIngestServerStatus> {
		const server = this.server
		this.server = undefined
		if (server) {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()))
			})
		}
		this.status = {
			running: false,
			bindAddress: this.status.bindAddress || DEFAULT_BIND_ADDRESS,
		}
		return this.getStatus()
	}

	buildCurlCommand(): string {
		if (!this.status.running || !this.status.url || !this.status.sessionId) {
			throw new Error("Codie compatibility NDJSON ingest server is not running")
		}
		return [
			"curl",
			"-X",
			"POST",
			quote(`${this.status.url}/ingest`),
			"-H",
			quote("Content-Type: application/x-ndjson"),
			"-H",
			quote(`X-Debug-Session-Id: ${this.status.sessionId}`),
			"--data-binary",
			"@events.ndjson",
		].join(" ")
	}

	dispose(): void {
		void this.stop()
	}

	private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
		try {
			const requestUrl = new URL(request.url || "/", "http://localhost")
			if (request.method === "GET" && requestUrl.pathname === "/status") {
				sendJson(response, 200, toPublicStatus(this.getStatus()))
				return
			}
			if (request.method !== "POST" || (requestUrl.pathname !== "/" && requestUrl.pathname !== "/ingest")) {
				sendJson(response, 404, { error: "not_found" })
				return
			}
			if (!this.status.sessionId || readDebugSessionId(request) !== this.status.sessionId) {
				sendJson(response, 401, { error: "unauthorized" })
				return
			}

			const payload = parseRequestPayload(request, await readRequestBody(request))
			const validation = parseAutomationEventNdjson(payload.ndjson, payload.options)
			const result = await ingestCursorAutomationEvents(this.storageDir, {
				strict: payload.strict,
				validation,
				options: payload.options,
				paramKeys: payload.paramKeys,
				configKeys: payload.configKeys,
			})
			sendJson(response, result.strictFailed ? 422 : 200, result)
		} catch (error) {
			sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
		}
	}
}

function quote(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`
}
