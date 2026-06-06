import type {
	AgentToolContext,
	HubClientContribution,
	JsonValue,
} from "@cline/shared";
import {
	HUB_CHECKPOINT_CAPABILITY,
	HUB_COMPACTION_CAPABILITY,
	HUB_CUSTOM_TOOL_CAPABILITY_PREFIX,
	HUB_HOOK_CAPABILITY_PREFIX,
	HUB_MISTAKE_LIMIT_CAPABILITY,
	HUB_TOOL_EXECUTOR_CAPABILITY_PREFIX,
	HUB_USER_INSTRUCTIONS_SNAPSHOT_CAPABILITY,
	isHubToolExecutorName,
} from "@cline/shared";
import type { RuntimeCapabilities } from "../runtime/capabilities";
import type { StartSessionInput } from "../runtime/host/runtime-host";

const HUB_HOOK_NAMES = [
	"beforeRun",
	"afterRun",
	"beforeModel",
	"afterModel",
	"beforeTool",
	"afterTool",
	"onEvent",
] as const;

export type ClientContributionHandler = (input: {
	payload: Record<string, unknown>;
	abortSignal: AbortSignal;
	progress: (payload: Record<string, unknown>) => void;
}) => Promise<Record<string, unknown> | undefined>;

export interface ClientContributionRegistration {
	manifest: HubClientContribution[];
	handlers: Map<string, ClientContributionHandler>;
}

function toJsonRecord(
	value: Record<string, unknown> | undefined,
): Record<string, JsonValue | undefined> | undefined {
	if (!value) {
		return undefined;
	}
	return JSON.parse(JSON.stringify(value)) as Record<
		string,
		JsonValue | undefined
	>;
}

function toJsonSerializable(
	value: unknown,
): Record<string, JsonValue | undefined> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	return JSON.parse(JSON.stringify(value)) as Record<
		string,
		JsonValue | undefined
	>;
}

function parseToolContext(value: unknown): AgentToolContext {
	const payload =
		value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	return {
		agentId: typeof payload.agentId === "string" ? payload.agentId : "",
		conversationId:
			typeof payload.conversationId === "string" ? payload.conversationId : "",
		iteration: typeof payload.iteration === "number" ? payload.iteration : 0,
		metadata:
			payload.metadata &&
			typeof payload.metadata === "object" &&
			!Array.isArray(payload.metadata)
				? (payload.metadata as Record<string, unknown>)
				: undefined,
	};
}

function addClientContribution(
	registration: ClientContributionRegistration,
	contribution: HubClientContribution,
	handler: ClientContributionHandler,
): void {
	registration.manifest.push(contribution);
	registration.handlers.set(contribution.capabilityName, handler);
}

export function buildClientContributionRegistration(
	localRuntime: StartSessionInput["localRuntime"] | undefined,
	capabilities: RuntimeCapabilities,
): ClientContributionRegistration {
	const registration: ClientContributionRegistration = {
		manifest: [],
		handlers: new Map(),
	};

	for (const executor of Object.keys(capabilities.toolExecutors ?? {}).filter(
		isHubToolExecutorName,
	)) {
		const executorFn = capabilities.toolExecutors?.[executor] as
			| ((...args: unknown[]) => Promise<unknown>)
			| undefined;
		if (typeof executorFn !== "function") continue;
		addClientContribution(
			registration,
			{
				kind: "toolExecutor",
				executor,
				capabilityName: `${HUB_TOOL_EXECUTOR_CAPABILITY_PREFIX}${executor}`,
			},
			async ({ payload, abortSignal }) => {
				const args = Array.isArray(payload.args) ? [...payload.args] : [];
				const context = {
					...parseToolContext(payload.context),
					signal: abortSignal,
				};
				return { result: await executorFn(...args, context) };
			},
		);
	}

	for (const tool of localRuntime?.extraTools ?? []) {
		addClientContribution(
			registration,
			{
				kind: "tool",
				name: tool.name,
				description: tool.description,
				inputSchema: toJsonRecord(tool.inputSchema) ?? {},
				...(tool.lifecycle
					? {
							lifecycle: toJsonRecord(
								tool.lifecycle as Record<string, unknown>,
							),
						}
					: {}),
				capabilityName: `${HUB_CUSTOM_TOOL_CAPABILITY_PREFIX}${tool.name}`,
			},
			async ({ payload, abortSignal, progress }) => {
				const context = {
					...parseToolContext(payload.context),
					signal: abortSignal,
				};
				const result = await tool.execute(payload.input, {
					...context,
					emitUpdate: (update) => {
						progress({ update });
					},
				});
				return { result };
			},
		);
	}

	const hooks = localRuntime?.hooks as Record<string, unknown> | undefined;
	if (hooks) {
		for (const name of HUB_HOOK_NAMES) {
			const hook = hooks[name];
			if (typeof hook !== "function") continue;
			addClientContribution(
				registration,
				{
					kind: "hook",
					name,
					capabilityName: `${HUB_HOOK_CAPABILITY_PREFIX}${name}`,
				},
				async ({ payload }) => ({
					control: await hook(payload.context),
				}),
			);
		}
	}

	if (localRuntime?.compaction?.compact) {
		const compact = localRuntime.compaction.compact;
		addClientContribution(
			registration,
			{
				kind: "compaction",
				capabilityName: HUB_COMPACTION_CAPABILITY,
				config: toJsonSerializable(localRuntime.compaction),
			},
			async ({ payload }) => ({
				result: await compact(payload.context as never),
			}),
		);
	}

	if (localRuntime?.checkpoint?.createCheckpoint) {
		const createCheckpoint = localRuntime.checkpoint.createCheckpoint;
		addClientContribution(
			registration,
			{
				kind: "checkpoint",
				capabilityName: HUB_CHECKPOINT_CAPABILITY,
				config: toJsonSerializable(localRuntime.checkpoint),
			},
			async ({ payload }) => ({
				result: await createCheckpoint(payload.context as never),
			}),
		);
	}

	if (localRuntime?.onConsecutiveMistakeLimitReached) {
		const decide = localRuntime.onConsecutiveMistakeLimitReached;
		addClientContribution(
			registration,
			{
				kind: "mistakeLimit",
				capabilityName: HUB_MISTAKE_LIMIT_CAPABILITY,
			},
			async ({ payload }) => ({
				result: await decide(payload.context as never),
			}),
		);
	}

	if (localRuntime?.userInstructionService) {
		const service = localRuntime.userInstructionService;
		addClientContribution(
			registration,
			{
				kind: "userInstructionService",
				capabilityName: HUB_USER_INSTRUCTIONS_SNAPSHOT_CAPABILITY,
			},
			async () => {
				await service.start().catch(() => {});
				return {
					snapshot: {
						records: {
							skill: service.listRecords("skill"),
							rule: service.listRecords("rule"),
							workflow: service.listRecords("workflow"),
						},
						runtimeCommands: service.listRuntimeCommands(),
					},
				};
			},
		);
	}

	return registration;
}
