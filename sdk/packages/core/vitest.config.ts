import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const packageRoot = fileURLToPath(new URL(".", import.meta.url));
const sharedSrc = resolve(packageRoot, "../shared/src");

export default defineConfig({
	resolve: {
		alias: [
			{ find: "@cline/shared/db", replacement: resolve(sharedSrc, "db/index.ts") },
			{ find: "@cline/shared/storage", replacement: resolve(sharedSrc, "storage/index.ts") },
			{ find: "@cline/shared", replacement: resolve(sharedSrc, "index.ts") },
		],
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		exclude: ["src/**/*.e2e.test.ts"],
	},
});
