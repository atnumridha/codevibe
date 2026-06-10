import assert from "node:assert/strict";
import test from "node:test";
import {
	cursorSettingsSectionFromPreview,
	cursorSettingsSectionFromSearch,
	isCursorLinkPreviewIntentPath,
	isCursorSettingsIntentPath,
} from "../src/lib/cursor-settings-intent.ts";

test("maps Cursor settings query params to CodeVibe Hub sections", () => {
	assert.equal(
		cursorSettingsSectionFromSearch("?section=Providers"),
		"Providers",
	);
	assert.equal(
		cursorSettingsSectionFromSearch("?tab=Cursor%20Links"),
		"Compatibility",
	);
	assert.equal(
		cursorSettingsSectionFromSearch("?section=codex-auth"),
		"Providers",
	);
	assert.equal(cursorSettingsSectionFromSearch("?tab=NDJSON"), "Compatibility");
	assert.equal(
		cursorSettingsSectionFromSearch("?section=totally-custom-label"),
		"General",
	);
});

test("maps Cursor settings preview data with the same section resolver", () => {
	assert.equal(
		cursorSettingsSectionFromPreview({
			query: "openai-codex-auth",
			sourceParam: "section",
		}),
		"Providers",
	);
	assert.equal(
		cursorSettingsSectionFromPreview({
			query: "MCP Servers",
			sourceParam: "tab",
		}),
		"MCP",
	);
});

test("treats settings routes as direct section navigation instead of preview intents", () => {
	assert.equal(
		isCursorSettingsIntentPath("/settings", "?section=Providers"),
		true,
	);
	assert.equal(
		isCursorLinkPreviewIntentPath("/settings", "?section=Providers"),
		false,
	);
	assert.equal(
		isCursorLinkPreviewIntentPath("/createchat", "?text=hello"),
		true,
	);
});
