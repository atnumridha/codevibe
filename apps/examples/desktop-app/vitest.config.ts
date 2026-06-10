import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: [
			{ find: "@", replacement: resolve(__dirname, "webview") },
			{
				find: "@cline/shared/storage",
				replacement: resolve(
					__dirname,
					"../../../sdk/packages/shared/src/storage/index.ts",
				),
			},
			{
				find: "@cline/shared/db",
				replacement: resolve(
					__dirname,
					"../../../sdk/packages/shared/src/db/index.ts",
				),
			},
			{
				find: /^@cline\/shared\/(.+)$/,
				replacement: resolve(__dirname, "../../../sdk/packages/shared/src/$1"),
			},
			{
				find: "@cline/agents",
				replacement: resolve(
					__dirname,
					"../../../sdk/packages/agents/src/index.ts",
				),
			},
			{
				find: "@cline/core/hub",
				replacement: resolve(
					__dirname,
					"../../../sdk/packages/core/src/hub/index.ts",
				),
			},
			{
				find: "@cline/core",
				replacement: resolve(
					__dirname,
					"../../../sdk/packages/core/src/index.ts",
				),
			},
			{
				find: "@cline/llms",
				replacement: resolve(
					__dirname,
					"../../../sdk/packages/llms/src/index.ts",
				),
			},
			{
				find: "@cline/shared",
				replacement: resolve(
					__dirname,
					"../../../sdk/packages/shared/src/index.ts",
				),
			},
		],
	},
	test: {
		environment: "node",
		include: ["sidecar/**/*.test.ts", "webview/**/*.test.ts"],
	},
});
