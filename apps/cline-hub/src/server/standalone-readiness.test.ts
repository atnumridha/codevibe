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

	assert.equal(payload.app, "CodeVibe");
	assert.equal(payload.mode, "standalone");
	assert.equal(payload.vscodeRequired, false);
	assert.equal(payload.coreVersion, "test-core");
	assert.equal(payload.auth.defaultProvider, "openai-codex");
	assert.deepEqual(payload.auth.codexFiles, [
		"auth.json",
		"installation_id",
		"models_cache.json",
	]);
	assert.equal(payload.auth.secretPolicy, "redacted");

	for (const route of CURSOR_COMPATIBLE_WEBVIEW_ROUTES) {
		assert.ok(payload.cursorCompatibility.routes.includes(route), route);
	}
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

	assert.equal(
		STANDALONE_DESKTOP_COMMANDS.some((command) => command.startsWith("cline.")),
		false,
	);
});
