import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { CURSOR_COMPATIBLE_WEBVIEW_ROUTES } from "./http";
import { STANDALONE_DESKTOP_COMMANDS } from "./desktop-commands";

const CODEX_HOME_FILES = [
	"auth.json",
	"installation_id",
	"models_cache.json",
] as const;

const UI_CLIENT_DESKTOP_COMMANDS = new Set<string>([
	"cursor_uri_preview",
	"search_workspace_files",
]);

const HUB_CORE_DESKTOP_COMMANDS = new Set<string>([
	"list_cli_sessions",
	"list_discovered_sessions",
	"list_background_agent_sessions",
	"dismiss_background_agent_session",
	"delete_background_agent_session",
	"open_background_agent_worktree",
	"reveal_background_agent_worktree",
]);

export type StandaloneReadinessRuntimeState = {
	hubUrl?: string;
	hubHealthy?: boolean;
	cline?: unknown;
	uiClient?: unknown;
	peers?: { size: number };
	clients?: { size: number };
	sessions?: { size: number };
};

export type StandaloneReadinessPayload = {
	app: "Codie";
	mode: "standalone";
	vscodeRequired: false;
	coreVersion: string;
	runtime: {
		ready: boolean;
		hubUrlPresent: boolean;
		hubHealthy: boolean;
		clineConnected: boolean;
		uiClientConnected: boolean;
		browserPeers: number;
		connectedClients: number;
		trackedSessions: number;
	};
	auth: {
		defaultProvider: "openai-codex";
		planProviderDefault: "openai-codex";
		actProviderDefault: "openai-codex";
		authSourceDefault: "codexHome";
		codexHomeSupported: true;
		codexFiles: string[];
		codexHome: {
			source: "CODEX_HOME" | "home";
			pathRedacted: true;
			authJsonPresent: boolean;
			installationIdPresent: boolean;
			modelsCachePresent: boolean;
			usable: boolean;
		};
		secretPolicy: "redacted";
	};
	cursorCompatibility: {
		routes: readonly string[];
		desktopCommands: readonly string[];
		commandAvailability: Record<
			string,
			{
				available: boolean;
				requiresHubCore: boolean;
				requiresUiClient: boolean;
			}
		>;
		settingsSurfaces: readonly string[];
	};
	validation: {
		secretBearingMetadataRedacted: true;
		evidenceCommand: string;
	};
};

function codexHomeStatus(): StandaloneReadinessPayload["auth"]["codexHome"] {
	const explicitCodexHome = process.env.CODEX_HOME?.trim();
	const codexHome = explicitCodexHome || join(homedir(), ".codex");
	const authJsonPresent = existsSync(join(codexHome, "auth.json"));
	const installationIdPresent = existsSync(join(codexHome, "installation_id"));
	const modelsCachePresent = existsSync(join(codexHome, "models_cache.json"));
	return {
		source: explicitCodexHome ? "CODEX_HOME" : "home",
		pathRedacted: true,
		authJsonPresent,
		installationIdPresent,
		modelsCachePresent,
		usable: authJsonPresent,
	};
}

function runtimeStatus(
	state?: StandaloneReadinessRuntimeState,
): StandaloneReadinessPayload["runtime"] {
	const hubUrlPresent = Boolean(state?.hubUrl?.trim());
	const hubHealthy = state?.hubHealthy === true;
	const clineConnected = Boolean(state?.cline);
	const uiClientConnected = Boolean(state?.uiClient);
	return {
		ready: hubUrlPresent && hubHealthy && clineConnected && uiClientConnected,
		hubUrlPresent,
		hubHealthy,
		clineConnected,
		uiClientConnected,
		browserPeers: state?.peers?.size ?? 0,
		connectedClients: state?.clients?.size ?? 0,
		trackedSessions: state?.sessions?.size ?? 0,
	};
}

function commandAvailability(
	runtime: StandaloneReadinessPayload["runtime"],
): StandaloneReadinessPayload["cursorCompatibility"]["commandAvailability"] {
	return Object.fromEntries(
		STANDALONE_DESKTOP_COMMANDS.map((command) => {
			const requiresUiClient = UI_CLIENT_DESKTOP_COMMANDS.has(command);
			const requiresHubCore =
				requiresUiClient || HUB_CORE_DESKTOP_COMMANDS.has(command);
			return [
				command,
				{
					available:
						(!requiresHubCore || runtime.clineConnected) &&
						(!requiresUiClient || runtime.uiClientConnected),
					requiresHubCore,
					requiresUiClient,
				},
			];
		}),
	);
}

export function standaloneReadinessPayload(
	coreVersion: string,
	state?: StandaloneReadinessRuntimeState,
): StandaloneReadinessPayload {
	const runtime = runtimeStatus(state);
	return {
		app: "Codie",
		mode: "standalone",
		vscodeRequired: false,
		coreVersion,
		runtime,
		auth: {
			defaultProvider: "openai-codex",
			planProviderDefault: "openai-codex",
			actProviderDefault: "openai-codex",
			authSourceDefault: "codexHome",
			codexHomeSupported: true,
			codexFiles: [...CODEX_HOME_FILES],
			codexHome: codexHomeStatus(),
			secretPolicy: "redacted",
		},
		cursorCompatibility: {
			routes: CURSOR_COMPATIBLE_WEBVIEW_ROUTES,
			desktopCommands: STANDALONE_DESKTOP_COMMANDS,
			commandAvailability: commandAvailability(runtime),
			settingsSurfaces: [
				"Compatibility",
				"Browser Tools",
				"Retrieval & Indexing",
				"Background Agents",
				"MCP",
				"Plugins",
				"Rules",
				"Git Helpers",
				"NDJSON Ingest",
			],
		},
		validation: {
			secretBearingMetadataRedacted: true,
			evidenceCommand:
				"node apps/vscode/scripts/collect-cursor-parity-evidence.mjs --run-standalone-ui",
		},
	};
}
