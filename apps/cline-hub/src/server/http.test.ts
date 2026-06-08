import assert from "node:assert/strict";
import test from "node:test";

const { isWebviewRoute } = (await import(
	new URL("./http.ts", import.meta.url).href
)) as typeof import("./http");

test("Cursor-compatible standalone routes are served by the SPA", () => {
	for (const pathname of [
		"/createchat",
		"/mcp/install",
		"/background-agent",
		"/settings",
		"/prompt",
		"/command",
		"/rule",
		"/pr-review",
		"/plugin/add",
		"/glass",
		"/automation/ingest",
		"/git/checkout",
		"/git/branch",
		"/git/commit",
	]) {
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
