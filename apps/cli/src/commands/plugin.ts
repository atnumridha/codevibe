import {
	installPlugin,
	uninstallPlugin,
	type PluginInstallIo,
	type PluginInstallOptions,
	type PluginUninstallOptions,
} from "@cline/core";

export {
	installPlugin,
	isOfficialPluginSlug,
	parsePluginSource,
	type PluginInstallIo,
	type PluginInstallOptions,
	type PluginInstallResult,
} from "@cline/core";

export async function runPluginInstallCommand(
	options: PluginInstallOptions & { json?: boolean },
): Promise<number> {
	try {
		const result = await installPlugin(options);
		if (options.json) {
			process.stdout.write(JSON.stringify(result));
			return 0;
		}
		options.io?.writeln(`Installed plugin from ${result.source}`);
		options.io?.writeln(`  Path: ${result.installPath}`);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		options.io?.writeErr(message);
		return 1;
	}
}

export async function runPluginUninstallCommand(
	options: PluginUninstallOptions & { json?: boolean; io?: PluginInstallIo },
): Promise<number> {
	try {
		const result = await uninstallPlugin(options);
		if (options.json) {
			process.stdout.write(JSON.stringify(result));
			return 0;
		}
		options.io?.writeln(`Uninstalled plugin ${result.name}`);
		options.io?.writeln(`  Removed: ${result.installPath}`);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		options.io?.writeErr(message);
		return 1;
	}
}
