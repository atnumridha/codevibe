import assert from "node:assert/strict";
import test from "node:test";

const { HubContext } = (await import(
	new URL("./state.ts", import.meta.url).href
)) as typeof import("./state");
const { broadcastHubState, broadcastHubStatus } = (await import(
	new URL("./state-payloads.ts", import.meta.url).href
)) as typeof import("./state-payloads");

function createBroadcastFixture() {
	const sent: Array<Record<string, unknown>> = [];
	const ctx = new HubContext();
	ctx.hubUrl = "http://127.0.0.1:8765";
	ctx.hubStartedAt = "2026-06-08T00:00:00.000Z";
	ctx.peers.add({
		displayName: "Browser",
		sending: false,
		socket: {
			send(raw: string) {
				sent.push(JSON.parse(raw) as Record<string, unknown>);
			},
		},
	} as never);
	return { ctx, sent };
}

test("full hub broadcast includes session summaries", () => {
	const { ctx, sent } = createBroadcastFixture();

	broadcastHubState(ctx);

	assert.deepEqual(
		sent.map((payload) => payload.type),
		["hub_state", "sessions"],
	);
});

test("health/status broadcast avoids full session payload", () => {
	const { ctx, sent } = createBroadcastFixture();

	broadcastHubStatus(ctx);

	assert.deepEqual(
		sent.map((payload) => payload.type),
		["hub_state"],
	);
});
