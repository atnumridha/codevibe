import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import assert from "node:assert/strict";
import test from "node:test";

const { CURSOR_COMPATIBLE_WEBVIEW_ROUTES } = (await import(
	new URL("./http.ts", import.meta.url).href
)) as typeof import("./http");
const { STANDALONE_DESKTOP_COMMANDS } = (await import(
	new URL("./desktop-commands.ts", import.meta.url).href
)) as typeof import("./desktop-commands");
const { standaloneReadinessPayload } = (await import(
	new URL("./standalone-readiness.ts", import.meta.url).href
)) as typeof import("./standalone-readiness");

test("standalone readiness exposes VS-Code-free Cursor/Codex surfaces", () => {
	const payload = standaloneReadinessPayload("test-core");

	assert.equal(payload.app, "Codie");
	assert.equal(payload.mode, "standalone");
	assert.equal(payload.vscodeRequired, false);
	assert.equal(payload.coreVersion, "test-core");
	assert.equal(payload.runtime.ready, false);
	assert.equal(payload.runtime.hubUrlPresent, false);
	assert.equal(payload.runtime.hubHealthy, false);
	assert.equal(payload.runtime.clineConnected, false);
	assert.equal(payload.runtime.uiClientConnected, false);
	assert.equal(payload.auth.defaultProvider, "openai-codex");
	assert.equal(payload.auth.planProviderDefault, "openai-codex");
	assert.equal(payload.auth.actProviderDefault, "openai-codex");
	assert.equal(payload.auth.authSourceDefault, "codexHome");
	assert.deepEqual(payload.auth.codexFiles, [
		"auth.json",
		"installation_id",
		"models_cache.json",
	]);
	assert.equal(payload.auth.secretPolicy, "redacted");

	for (const route of CURSOR_COMPATIBLE_WEBVIEW_ROUTES) {
		assert.ok(payload.cursorCompatibility.routes.includes(route), route);
	}
	assert.ok(payload.cursorCompatibility.routes.includes("/settings"));
	for (const command of [
		"cursor_uri_preview",
		"cursor_uri_launch",
		"browser_action",
		"browser_snapshot",
		"browser_screenshot",
		"search_workspace_files",
		"list_background_agent_sessions",
		"cursor_mcp_install",
		"authorize_mcp_server_oauth",
		"cursor_plugin_add",
		"cursor_rule_open",
		"cursor_git_action",
		"cursor_automation_ingest",
	]) {
		assert.ok(payload.cursorCompatibility.desktopCommands.includes(command), command);
	}
	assert.equal(
		payload.cursorCompatibility.commandAvailability.cursor_uri_preview
			.available,
		false,
	);
	assert.equal(
		payload.cursorCompatibility.commandAvailability.cursor_uri_preview
			.requiresUiClient,
		true,
	);
	assert.equal(
		payload.cursorCompatibility.commandAvailability.browser_snapshot.available,
		true,
	);
	for (const surface of [
		"Compatibility",
		"Browser Tools",
		"Retrieval & Indexing",
		"Background Agents",
		"MCP",
		"Plugins",
		"Rules",
		"Git Helpers",
		"NDJSON Ingest",
	]) {
		assert.ok(payload.cursorCompatibility.settingsSurfaces.includes(surface), surface);
	}
});

test("standalone readiness does not expose secrets or legacy extension command IDs", () => {
	const payloadText = JSON.stringify(standaloneReadinessPayload("test-core"));
	assert.equal(payloadText.includes("access_token"), false);
	assert.equal(payloadText.includes("refresh_token"), false);
	assert.equal(payloadText.includes("id_token"), false);
	assert.equal(payloadText.includes("Authorization"), false);
	assert.equal(payloadText.includes("Bearer "), false);
	assert.equal(payloadText.includes("cline.plusButtonClicked"), false);
	assert.equal(payloadText.includes(process.env.HOME ?? ""), false);

	assert.equal(
		STANDALONE_DESKTOP_COMMANDS.some((command) => command.startsWith("cline.")),
		false,
	);
});

test("standalone readiness reports live hub availability without exposing local paths", async () => {
	const originalCodexHome = process.env.CODEX_HOME;
	const codexHome = await mkdtemp(join(tmpdir(), "codevibe-readiness-codex-"));
	process.env.CODEX_HOME = codexHome;
	try {
		await writeFile(join(codexHome, "auth.json"), "{}");
		await writeFile(join(codexHome, "installation_id"), "install-123\n");

		const payload = standaloneReadinessPayload("test-core", {
			hubUrl: "http://127.0.0.1:8765",
			hubHealthy: true,
			cline: {},
			uiClient: {},
			peers: { size: 1 },
			clients: { size: 2 },
			sessions: { size: 3 },
		});

		assert.deepEqual(payload.runtime, {
			ready: true,
			hubUrlPresent: true,
			hubHealthy: true,
			clineConnected: true,
			uiClientConnected: true,
			browserPeers: 1,
			connectedClients: 2,
			trackedSessions: 3,
		});
		assert.equal(payload.auth.codexHome.source, "CODEX_HOME");
		assert.equal(payload.auth.codexHome.pathRedacted, true);
		assert.equal(payload.auth.codexHome.authJsonPresent, true);
		assert.equal(payload.auth.codexHome.installationIdPresent, true);
		assert.equal(payload.auth.codexHome.modelsCachePresent, false);
		assert.equal(payload.auth.codexHome.usable, true);
		assert.equal(
			payload.cursorCompatibility.commandAvailability.cursor_uri_preview
				.available,
			true,
		);
		assert.equal(
			payload.cursorCompatibility.commandAvailability.search_workspace_files
				.available,
			true,
		);
		assert.equal(JSON.stringify(payload).includes(codexHome), false);
	} finally {
		if (originalCodexHome === undefined) {
			delete process.env.CODEX_HOME;
		} else {
			process.env.CODEX_HOME = originalCodexHome;
		}
	}
});
