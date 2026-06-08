import assert from "node:assert/strict";
import test from "node:test";

const { CURSOR_COMPATIBLE_WEBVIEW_ROUTES, isWebviewRoute } = (await import(
	new URL("./http.ts", import.meta.url).href
)) as typeof import("./http");

test("Cursor-compatible standalone routes are served by the SPA", () => {
	for (const pathname of CURSOR_COMPATIBLE_WEBVIEW_ROUTES) {
		assert.equal(isWebviewRoute(pathname), true, pathname);
	}
});

test("static asset paths are not treated as standalone deep links", () => {
	assert.equal(isWebviewRoute("/assets/index.js"), false);
	assert.equal(isWebviewRoute("/mcp/install/extra"), false);
});

test("Cursor-compatible standalone routes tolerate trailing slashes", () => {
	assert.equal(isWebviewRoute("/createchat/"), true);
	assert.equal(isWebviewRoute("/plugin/add/"), true);
});
