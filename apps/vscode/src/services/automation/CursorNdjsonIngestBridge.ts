import type { CursorNdjsonIngestServerStatus } from "./CursorNdjsonIngestServer"

const DEFAULT_STATUS: CursorNdjsonIngestServerStatus = {
	running: false,
	bindAddress: "127.0.0.1",
}

export interface CursorNdjsonIngestBridge {
	getStatus(): CursorNdjsonIngestServerStatus
	start(): Promise<CursorNdjsonIngestServerStatus>
	stop(): Promise<CursorNdjsonIngestServerStatus>
	reassignPort(): Promise<CursorNdjsonIngestServerStatus>
	buildCurlCommand(): Promise<string>
}

let activeBridge: CursorNdjsonIngestBridge | undefined

export function registerCursorNdjsonIngestBridge(bridge: CursorNdjsonIngestBridge): void {
	activeBridge = bridge
}

export function resetCursorNdjsonIngestBridge(): void {
	activeBridge = undefined
}

export function getCursorNdjsonIngestBridge(): CursorNdjsonIngestBridge {
	return activeBridge ?? missingBridge
}

const missingBridge: CursorNdjsonIngestBridge = {
	getStatus: () => ({ ...DEFAULT_STATUS }),
	start: async () => ({ ...DEFAULT_STATUS }),
	stop: async () => ({ ...DEFAULT_STATUS }),
	reassignPort: async () => ({ ...DEFAULT_STATUS }),
	buildCurlCommand: async () => {
		throw new Error("Codie compatibility NDJSON ingest is not available in this host.")
	},
}
