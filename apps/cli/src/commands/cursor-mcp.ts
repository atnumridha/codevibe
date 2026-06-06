import {
	buildCursorMcpInstallRequest,
	formatCursorMcpInstallDetail,
} from "@cline/core";
import {
	addServerRecord,
	getSettingsPath,
	loadServers,
} from "../wizards/mcp/settings";

export interface CursorMcpInstallCommandOptions {
	uri: string;
	confirmed?: boolean;
	json?: boolean;
	io: {
		writeln: (text?: string) => void;
		writeErr: (text: string) => void;
	};
}

function writeCommandError(
	options: CursorMcpInstallCommandOptions,
	message: string,
): number {
	if (options.json) {
		options.io.writeln(JSON.stringify({ installed: false, error: message }));
	} else {
		options.io.writeErr(message);
	}
	return 1;
}

export async function runCursorMcpInstallCommand(
	options: CursorMcpInstallCommandOptions,
): Promise<number> {
	try {
		const request = buildCursorMcpInstallRequest(options.uri);
		const detail = formatCursorMcpInstallDetail(request);
		const settingsPath = getSettingsPath();

		if (loadServers().some((server) => server.name === request.serverName)) {
			throw new Error(
				`An MCP server named "${request.serverName}" already exists`,
			);
		}

		if (!options.confirmed) {
			if (options.json) {
				options.io.writeln(
					JSON.stringify({
						installed: false,
						requiresConfirmation: true,
						serverName: request.serverName,
						detail,
						settingsPath,
					}),
				);
			} else {
				options.io.writeln(detail);
				options.io.writeln("");
				options.io.writeln(`Settings file: ${settingsPath}`);
				options.io.writeln("Re-run with --yes to install this MCP server.");
			}
			return 0;
		}

		addServerRecord(request.serverName, request.serverConfig);
		if (options.json) {
			options.io.writeln(
				JSON.stringify({
					installed: true,
					serverName: request.serverName,
					settingsPath,
				}),
			);
		} else {
			options.io.writeln(
				`Installed MCP server "${request.serverName}" in ${settingsPath}`,
			);
		}
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return writeCommandError(options, message);
	}
}

export async function runCursorUriCommand(
	options: CursorMcpInstallCommandOptions,
): Promise<number> {
	let path: string;
	try {
		path = new URL(options.uri).pathname || "/";
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return writeCommandError(options, message);
	}

	if (path === "/mcp/install") {
		return runCursorMcpInstallCommand(options);
	}

	const message = `Unsupported Cursor URI route for CLI: ${path}`;
	if (options.json) {
		options.io.writeln(JSON.stringify({ handled: false, error: message }));
		return 1;
	}
	options.io.writeErr(message);
	return 1;
}
