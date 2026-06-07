import { stat } from "node:fs/promises";
import path from "node:path";
import type {
	HubCommandEnvelope,
	HubPromptCommandExecuteResponse,
	HubPromptCommandListResponse,
	HubPromptCommandSummary,
	HubReplyEnvelope,
} from "@cline/shared";
import {
	createUserInstructionConfigService,
	type UserInstructionConfigService,
} from "../../../extensions/config";
import { errorReply, okReply, type HubTransportContext } from "./context";

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeCommandName(value: string): string {
	return value.trim().replace(/^\/+/, "");
}

function resolveClientWorkspaceRoot(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): string | undefined {
	const clientId = envelope.clientId?.trim();
	if (!clientId) {
		return undefined;
	}
	const workspaceContext = ctx.clients.get(clientId)?.workspaceContext;
	return (
		asString(workspaceContext?.workspaceRoot) ?? asString(workspaceContext?.cwd)
	);
}

async function resolveWorkspaceRoot(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<string> {
	const payload = envelope.payload ?? {};
	const root =
		asString(payload.workspaceRoot) ??
		asString(payload.cwd) ??
		resolveClientWorkspaceRoot(ctx, envelope);
	if (!root) {
		throw new Error(
			`${envelope.command} requires workspaceRoot, cwd, or a registered client workspaceContext.`,
		);
	}
	const resolved = path.resolve(root);
	const rootStat = await stat(resolved);
	if (!rootStat.isDirectory()) {
		throw new Error(`${envelope.command} workspaceRoot must be a directory.`);
	}
	return resolved;
}

async function withPromptCommandService<T>(
	workspaceRoot: string,
	cwd: string,
	run: (service: UserInstructionConfigService) => T | Promise<T>,
): Promise<T> {
	const service = createUserInstructionConfigService({
		skills: {
			workspacePath: workspaceRoot,
			includePluginSkills: true,
			cwd,
		},
		rules: { workspacePath: workspaceRoot },
		workflows: { workspacePath: workspaceRoot },
	});
	try {
		await service.start();
		return await run(service);
	} finally {
		service.stop();
	}
}

function summarizeCommand(
	command: ReturnType<UserInstructionConfigService["listRuntimeCommands"]>[number],
): HubPromptCommandSummary {
	return {
		id: command.id,
		name: command.name,
		kind: command.kind,
		...(command.description?.trim()
			? { description: command.description.trim() }
			: {}),
	};
}

export async function handlePromptCommandsList(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	try {
		const workspaceRoot = await resolveWorkspaceRoot(ctx, envelope);
		const cwd = asString(envelope.payload?.cwd) ?? workspaceRoot;
		const query = asString(envelope.payload?.query)?.toLowerCase() ?? "";
		const commands = await withPromptCommandService(workspaceRoot, cwd, (service) =>
			service
				.listRuntimeCommands()
				.map(summarizeCommand)
				.filter((command) => {
					if (!query) {
						return true;
					}
					return (
						command.name.toLowerCase().includes(query) ||
						command.id.toLowerCase().includes(query) ||
						command.description?.toLowerCase().includes(query)
					);
				}),
		);
		const response: HubPromptCommandListResponse = {
			query,
			workspaceRoot,
			count: commands.length,
			commands,
		};
		return okReply(envelope, response);
	} catch (error) {
		return errorReply(
			envelope,
			"prompt_commands_list_failed",
			error instanceof Error ? error.message : String(error),
		);
	}
}

export async function handlePromptCommandsExecute(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	try {
		const workspaceRoot = await resolveWorkspaceRoot(ctx, envelope);
		const cwd = asString(envelope.payload?.cwd) ?? workspaceRoot;
		const requestedName = normalizeCommandName(
			asString(envelope.payload?.name) ??
				asString(envelope.payload?.command) ??
				"",
		);
		if (!requestedName) {
			throw new Error("prompt_commands.execute requires name or command.");
		}
		const input = asString(envelope.payload?.input) ?? "";
		const command = await withPromptCommandService(workspaceRoot, cwd, (service) =>
			service
				.listRuntimeCommands()
				.find(
					(item) =>
						item.name === requestedName ||
						item.id === requestedName ||
						item.name === normalizeCommandName(requestedName),
				),
		);
		if (!command) {
			throw new Error(`Prompt command not found: ${requestedName}`);
		}
		const prompt = input
			? `${command.instructions}\n\n${input}`
			: command.instructions;
		const response: HubPromptCommandExecuteResponse = {
			name: command.name,
			kind: command.kind,
			prompt,
		};
		return okReply(envelope, response);
	} catch (error) {
		return errorReply(
			envelope,
			"prompt_commands_execute_failed",
			error instanceof Error ? error.message : String(error),
		);
	}
}
