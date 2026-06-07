import { expect } from "chai"
import fs from "fs/promises"
import http from "http"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, it } from "mocha"
import { resolveCursorAutomationIngestStorePath } from "./CursorAutomationIngestStore"
import { CursorNdjsonIngestServer } from "./CursorNdjsonIngestServer"

function request(
	url: string,
	options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ statusCode: number; body: string }> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			url,
			{
				method: options.method ?? "GET",
				headers: options.headers,
			},
			(res) => {
				let body = ""
				res.setEncoding("utf8")
				res.on("data", (chunk) => {
					body += chunk
				})
				res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body }))
			},
		)
		req.on("error", reject)
		if (options.body) {
			req.write(options.body)
		}
		req.end()
	})
}

describe("CursorNdjsonIngestServer", () => {
	let storageDir: string
	let server: CursorNdjsonIngestServer

	beforeEach(async () => {
		storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "codevibe-cursor-ndjson-server-"))
		server = new CursorNdjsonIngestServer(storageDir)
	})

	afterEach(async () => {
		await server.stop()
		await fs.rm(storageDir, { recursive: true, force: true })
	})

	it("starts on an auto port and exposes status plus a curl command with a debug session header", async () => {
		const status = await server.start({ port: 0, bindAddress: "127.0.0.1" })

		expect(status.running).to.equal(true)
		expect(status.url).to.match(/^http:\/\/127\.0\.0\.1:\d+$/)
		expect(server.buildCurlCommand()).to.contain("X-Debug-Session-Id:")

		const response = await request(`${status.url}/status`)
		expect(response.statusCode).to.equal(200)
		expect(JSON.parse(response.body)).to.deep.include({
			running: true,
			bindAddress: "127.0.0.1",
		})
		expect(JSON.parse(response.body)).not.to.have.property("sessionId")
	})

	it("ingests raw NDJSON using Cursor defaults", async () => {
		const status = await server.start({ port: 0, bindAddress: "127.0.0.1" })
		const ndjson = JSON.stringify({
			id: "evt-raw-1",
			type: "git.commit.created",
			payload: { branch: "main" },
		})

		const response = await request(`${status.url}/ingest`, {
			method: "POST",
			body: ndjson,
			headers: {
				"content-type": "application/x-ndjson",
				"x-debug-session-id": status.sessionId ?? "",
			},
		})
		const result = JSON.parse(response.body)

		expect(response.statusCode).to.equal(200)
		expect(result).to.deep.include({ accepted: 1, rejected: 0, stored: 1, strictFailed: false })
		expect(result.events[0]).to.deep.include({
			eventId: "evt-raw-1",
			eventType: "git.commit.created",
			source: "cursor",
		})

		const stored = await fs.readFile(resolveCursorAutomationIngestStorePath(storageDir), "utf8")
		expect(stored).to.contain("evt-raw-1")
	})

	it("ingests JSON config bodies posted to the root endpoint", async () => {
		const status = await server.start({ port: 0, bindAddress: "127.0.0.1" })
		const ndjson = JSON.stringify({
			id: "evt-config-1",
			type: "git.commit.created",
			payload: { branch: "main" },
		})

		const response = await request(`${status.url}/`, {
			method: "POST",
			body: JSON.stringify({
				config: {
					ndjson,
					defaultSource: "github",
					maxEvents: 1,
				},
			}),
			headers: {
				"content-type": "application/json",
				"x-debug-session-id": status.sessionId ?? "",
			},
		})
		const result = JSON.parse(response.body)

		expect(response.statusCode).to.equal(200)
		expect(result).to.deep.include({
			accepted: 1,
			rejected: 0,
			stored: 1,
			strictFailed: false,
			defaultSource: "github",
			maxEvents: 1,
		})
		expect(result.paramKeys).to.deep.equal([])
		expect(result.configKeys).to.deep.equal(["defaultSource", "maxEvents", "ndjson"])
		expect(result.events[0]).to.deep.include({
			eventId: "evt-config-1",
			eventType: "git.commit.created",
			source: "github",
		})
	})

	it("rejects ingest requests without the debug session header", async () => {
		const status = await server.start({ port: 0, bindAddress: "127.0.0.1" })
		const ndjson = JSON.stringify({
			id: "evt-raw-1",
			type: "git.commit.created",
		})

		const response = await request(`${status.url}/ingest`, {
			method: "POST",
			body: ndjson,
			headers: { "content-type": "application/x-ndjson" },
		})

		expect(response.statusCode).to.equal(401)
		expect(JSON.parse(response.body)).to.deep.equal({ error: "unauthorized" })
		try {
			await fs.stat(resolveCursorAutomationIngestStorePath(storageDir))
			throw new Error("expected store file to be missing")
		} catch (error) {
			expect((error as NodeJS.ErrnoException).code).to.equal("ENOENT")
		}
	})

	it("keeps strict-invalid ingest preview-only", async () => {
		const status = await server.start({ port: 0, bindAddress: "127.0.0.1" })
		const ndjson = [
			JSON.stringify({ id: "evt-ok", type: "git.commit.created" }),
			"{ bad json",
		].join("\n")

		const response = await request(`${status.url}/ingest?strict=true`, {
			method: "POST",
			body: ndjson,
			headers: {
				"content-type": "application/x-ndjson",
				"x-debug-session-id": status.sessionId ?? "",
			},
		})
		const result = JSON.parse(response.body)

		expect(response.statusCode).to.equal(422)
		expect(result).to.deep.include({ accepted: 1, rejected: 1, stored: 0, strictFailed: true })
		try {
			await fs.stat(resolveCursorAutomationIngestStorePath(storageDir))
			throw new Error("expected store file to be missing")
		} catch (error) {
			expect((error as NodeJS.ErrnoException).code).to.equal("ENOENT")
		}
	})
})
