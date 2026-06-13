import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

const { providerSettingsManager } = (await import(
	new URL("./deps.ts", import.meta.url).href
)) as typeof import("./deps");
const { HubContext } = (await import(
	new URL("./state.ts", import.meta.url).href
)) as typeof import("./state");
const { resolveBrowserDefaults } = (await import(
	new URL("./providers.ts", import.meta.url).href
)) as typeof import("./providers");
const { resolveLaunchContext } = (await import(
	new URL("./sessions.ts", import.meta.url).href
)) as typeof import("./sessions");

const originalGetLastUsedProviderSettings =
	providerSettingsManager.getLastUsedProviderSettings.bind(providerSettingsManager);
const originalEnv = {
	CODEVIBE_PROVIDER: process.env.CODEVIBE_PROVIDER,
	CODEVIBE_MODEL: process.env.CODEVIBE_MODEL,
	CLINE_PROVIDER: process.env.CLINE_PROVIDER,
	CLINE_MODEL: process.env.CLINE_MODEL,
};

function stubLastUsedProviderSettings(
	value: ReturnType<typeof providerSettingsManager.getLastUsedProviderSettings>,
): void {
	Object.defineProperty(providerSettingsManager, "getLastUsedProviderSettings", {
		configurable: true,
		value: () => value,
	});
}

function restoreEnv(): void {
	for (const [key, value] of Object.entries(originalEnv)) {
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
}

afterEach(() => {
	Object.defineProperty(providerSettingsManager, "getLastUsedProviderSettings", {
		configurable: true,
		value: originalGetLastUsedProviderSettings,
	});
	restoreEnv();
});

test("browser defaults stay on OpenAI Codex when last-used provider differs", () => {
	delete process.env.CODEVIBE_PROVIDER;
	delete process.env.CODEVIBE_MODEL;
	delete process.env.CLINE_PROVIDER;
	delete process.env.CLINE_MODEL;
	stubLastUsedProviderSettings({
		provider: "openrouter",
		model: "anthropic/claude-sonnet-4.6",
	});

	const defaults = resolveBrowserDefaults(new HubContext());

	assert.equal(defaults.provider, "openai-codex");
	assert.equal(defaults.model, "gpt-5.5-pro");
});

test("launch context stays on OpenAI Codex when last-used provider differs", () => {
	delete process.env.CODEVIBE_PROVIDER;
	delete process.env.CODEVIBE_MODEL;
	delete process.env.CLINE_PROVIDER;
	delete process.env.CLINE_MODEL;
	stubLastUsedProviderSettings({
		provider: "openrouter",
		model: "anthropic/claude-sonnet-4.6",
	});

	const launchContext = resolveLaunchContext(new HubContext());

	assert.equal(launchContext.providerId, "openai-codex");
	assert.equal(launchContext.modelId, "gpt-5.5-pro");
});

test("explicit launch provider can reuse its matching last-used model", () => {
	delete process.env.CODEVIBE_PROVIDER;
	delete process.env.CODEVIBE_MODEL;
	delete process.env.CLINE_PROVIDER;
	delete process.env.CLINE_MODEL;
	stubLastUsedProviderSettings({
		provider: "openrouter",
		model: "anthropic/claude-sonnet-4.6",
	});

	const launchContext = resolveLaunchContext(new HubContext(), {
		provider: "openrouter",
	});

	assert.equal(launchContext.providerId, "openrouter");
	assert.equal(launchContext.modelId, "anthropic/claude-sonnet-4.6");
});

test("environment provider remains an explicit Hub default", () => {
	process.env.CODEVIBE_PROVIDER = "openrouter";
	process.env.CODEVIBE_MODEL = "openai/gpt-5";
	delete process.env.CLINE_PROVIDER;
	delete process.env.CLINE_MODEL;
	stubLastUsedProviderSettings({
		provider: "anthropic",
		model: "claude-sonnet-4-5",
	});

	const defaults = resolveBrowserDefaults(new HubContext());
	const launchContext = resolveLaunchContext(new HubContext());

	assert.equal(defaults.provider, "openrouter");
	assert.equal(defaults.model, "openai/gpt-5");
	assert.equal(launchContext.providerId, "openrouter");
	assert.equal(launchContext.modelId, "openai/gpt-5");
});
