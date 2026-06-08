import { CURSOR_COMPATIBLE_WEBVIEW_ROUTES } from "./http";
import { STANDALONE_DESKTOP_COMMANDS } from "./desktop-commands";

export type StandaloneReadinessPayload = {
	app: "CodeVibe";
	mode: "standalone";
	vscodeRequired: false;
	coreVersion: string;
	auth: {
		defaultProvider: "openai-codex";
		codexHomeSupported: true;
		codexFiles: string[];
		secretPolicy: "redacted";
	};
	cursorCompatibility: {
		routes: readonly string[];
		desktopCommands: readonly string[];
		settingsSurfaces: readonly string[];
	};
	validation: {
		secretBearingMetadataRedacted: true;
		evidenceCommand: string;
	};
};

export function standaloneReadinessPayload(
	coreVersion: string,
): StandaloneReadinessPayload {
	return {
		app: "CodeVibe",
		mode: "standalone",
		vscodeRequired: false,
		coreVersion,
		auth: {
			defaultProvider: "openai-codex",
			codexHomeSupported: true,
			codexFiles: ["auth.json", "installation_id", "models_cache.json"],
			secretPolicy: "redacted",
		},
		cursorCompatibility: {
			routes: CURSOR_COMPATIBLE_WEBVIEW_ROUTES,
			desktopCommands: STANDALONE_DESKTOP_COMMANDS,
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
