import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
	buildCursorAgentTaskRouteRequest,
	buildCursorRuleRouteRequest,
	buildCursorSettingsRouteRequest,
	buildCursorMcpInstallRequest,
	formatCursorMcpInstallDetail,
	resolveCursorCommandFileRouteRequest,
} from "@cline/core";
import { resolveGlobalSettingsPath } from "@cline/shared/storage";
import {
	addServerRecord,
	getSettingsPath,
	loadServers,
} from "../wizards/mcp/settings";

export interface CursorMcpInstallCommandOptions {
	uri: string;
	confirmed?: boolean;
	json?: boolean;
	cwd?: string;
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

function writeUriError(
	options: CursorMcpInstallCommandOptions,
	message: string,
): number {
	if (options.json) {
		options.io.writeln(JSON.stringify({ handled: false, error: message }));
	} else {
		options.io.writeErr(message);
	}
	return 1;
}

function writeSettingsRoute(options: CursorMcpInstallCommandOptions): number {
	const request = buildCursorSettingsRouteRequest(options.uri);
	const settingsPath = resolveGlobalSettingsPath();
	if (options.json) {
		options.io.writeln(
			JSON.stringify({
				handled: true,
				route: "settings",
				settingsPath,
				query: request.query,
				sourceParam: request.sourceParam,
			}),
		);
		return 0;
	}

	options.io.writeln(`Settings file: ${settingsPath}`);
	if (request.query) {
		options.io.writeln(`Requested settings query: ${request.query}`);
	}
	return 0;
}

function writeCursorRuleRoute(options: CursorMcpInstallCommandOptions): number {
	const request = buildCursorRuleRouteRequest(options.uri);
	if (request.kind === "review") {
		if (options.json) {
			options.io.writeln(
				JSON.stringify({
					handled: true,
					route: "rule",
					requiresReview: true,
					reason: request.reason,
					name: request.name,
					path: request.path,
				}),
			);
		} else {
			options.io.writeln(request.reason);
			options.io.writeln("Start an agent task with this deeplink before writing rule content.");
		}
		return 0;
	}

	const cwd = resolve(options.cwd ?? process.cwd());
	const filePath = resolve(cwd, request.relativePath);
	const relativePath = relative(cwd, filePath);
	if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
		throw new Error("Cursor rule path must stay inside the workspace");
	}

	if (!options.confirmed) {
		if (options.json) {
			options.io.writeln(
				JSON.stringify({
					handled: true,
					route: "rule",
					created: false,
					requiresConfirmation: true,
					filename: request.filename,
					filePath,
				}),
			);
		} else {
			options.io.writeln(`Cursor rule: ${request.filename}`);
			options.io.writeln(`File: ${filePath}`);
			options.io.writeln("Re-run with --yes to create or reuse this rule file.");
		}
		return 0;
	}

	mkdirSync(dirname(filePath), { recursive: true });
	let created = true;
	try {
		writeFileSync(filePath, "", { flag: "wx" });
	} catch (error) {
		const code =
			error && typeof error === "object" && "code" in error
				? (error as { code?: unknown }).code
				: undefined;
		if (code !== "EEXIST") {
			throw error;
		}
		created = false;
	}

	if (options.json) {
		options.io.writeln(
			JSON.stringify({
				handled: true,
				route: "rule",
				created,
				filename: request.filename,
				filePath,
			}),
		);
	} else {
		options.io.writeln(
			`${created ? "Created" : "Reused"} Cursor rule "${request.filename}" at ${filePath}`,
		);
	}
	return 0;
}

function writeAgentTaskRoute(options: CursorMcpInstallCommandOptions): number {
	const request = buildCursorAgentTaskRouteRequest(options.uri);
	const commandFileRequest = resolveCursorCommandFileRouteRequest(request, {
		workspaceRoot: resolve(options.cwd ?? process.cwd()),
	});
	const taskPrompt = commandFileRequest?.taskPrompt ?? request.taskPrompt;
	if (options.json) {
		options.io.writeln(
			JSON.stringify({
				handled: true,
				route: commandFileRequest?.kind ?? request.kind,
				path: request.path,
				requiresAgent: true,
				prompt: request.prompt,
				taskPrompt,
				paramKeys: Object.keys(request.params).sort(),
				commandFile: commandFileRequest
					? {
							commandName: commandFileRequest.commandName,
							filename: commandFileRequest.filename,
							relativePath: commandFileRequest.relativePath,
							filePath: commandFileRequest.filePath,
						}
					: undefined,
			}),
		);
		return 0;
	}

	options.io.writeln(
		commandFileRequest
			? `Cursor command file "${commandFileRequest.relativePath}" requires an agent task.`
			: `Cursor ${request.kind} deeplink requires an agent task.`,
	);
	options.io.writeln("");
	options.io.writeln(taskPrompt);
	return 0;
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
		return writeUriError(options, message);
	}

	if (path === "/mcp/install") {
		return runCursorMcpInstallCommand(options);
	}
	if (path === "/settings") {
		try {
			return writeSettingsRoute(options);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return writeUriError(options, message);
		}
	}
	if (path === "/rule") {
		try {
			return writeCursorRuleRoute(options);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return writeUriError(options, message);
		}
	}

	try {
		return writeAgentTaskRoute(options);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!message.startsWith("Unsupported Cursor agent task route:")) {
			return writeUriError(options, message);
		}
	}

	const message = `Unsupported Cursor URI route for CLI: ${path}`;
	if (options.json) {
		options.io.writeln(JSON.stringify({ handled: false, error: message }));
		return 1;
	}
	options.io.writeErr(message);
	return 1;
}
