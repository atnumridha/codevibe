import type {
	CursorNdjsonIngestServerSettings,
	CursorNdjsonIngestServerStatus,
} from "./CursorNdjsonIngestServer"

const DEFAULT_BIND_ADDRESS = "127.0.0.1"

export interface CursorNdjsonIngestStartupServer {
	start(settings: CursorNdjsonIngestServerSettings): Promise<CursorNdjsonIngestServerStatus>
}

export interface CursorNdjsonIngestStartupOptions {
	settings: CursorNdjsonIngestServerSettings
	server: CursorNdjsonIngestStartupServer
	confirmNonLoopbackBindAddress: (bindAddress: string) => Promise<boolean>
}

export function shouldAutoStartCursorNdjsonIngest(settings: CursorNdjsonIngestServerSettings): boolean {
	return Number.isInteger(settings.port) && (settings.port ?? 0) > 0
}

export function isCursorNdjsonLoopbackBindAddress(bindAddress: string | undefined): boolean {
	const normalized = (bindAddress?.trim() || DEFAULT_BIND_ADDRESS).toLowerCase()
	return normalized === "localhost" || normalized === "::1" || normalized === "[::1]" || normalized.startsWith("127.")
}

export async function maybeAutoStartCursorNdjsonIngestServer({
	settings,
	server,
	confirmNonLoopbackBindAddress,
}: CursorNdjsonIngestStartupOptions): Promise<CursorNdjsonIngestServerStatus | undefined> {
	if (!shouldAutoStartCursorNdjsonIngest(settings)) {
		return undefined
	}
	const bindAddress = settings.bindAddress?.trim() || DEFAULT_BIND_ADDRESS
	if (!isCursorNdjsonLoopbackBindAddress(bindAddress) && !(await confirmNonLoopbackBindAddress(bindAddress))) {
		return undefined
	}
	return server.start(settings)
}
