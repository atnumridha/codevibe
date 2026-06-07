import type {
	HubCommandEnvelope,
	HubReplyEnvelope,
	ToolApprovalRequest,
} from "@cline/shared";
import { createSessionId } from "@cline/shared";
import { errorReply, type HubTransportContext, okReply } from "./context";

function parseApprovalRequestPayload(
	envelope: HubCommandEnvelope,
): ToolApprovalRequest {
	const payload =
		envelope.payload && typeof envelope.payload === "object"
			? envelope.payload
			: {};
	const sessionId =
		typeof payload.sessionId === "string" && payload.sessionId.trim()
			? payload.sessionId.trim()
			: envelope.sessionId?.trim() || "";
	const agentId =
		typeof payload.agentId === "string" && payload.agentId.trim()
			? payload.agentId.trim()
			: "";
	const conversationId =
		typeof payload.conversationId === "string" && payload.conversationId.trim()
			? payload.conversationId.trim()
			: "";
	const iteration = Number(payload.iteration);
	const toolCallId =
		typeof payload.toolCallId === "string" && payload.toolCallId.trim()
			? payload.toolCallId.trim()
			: "";
	const toolName =
		typeof payload.toolName === "string" && payload.toolName.trim()
			? payload.toolName.trim()
			: "";
	if (!sessionId) {
		throw new Error("approval.request payload 'sessionId' is required.");
	}
	if (!agentId) {
		throw new Error("approval.request payload 'agentId' is required.");
	}
	if (!conversationId) {
		throw new Error("approval.request payload 'conversationId' is required.");
	}
	if (!Number.isFinite(iteration) || !Number.isInteger(iteration)) {
		throw new Error("approval.request payload 'iteration' must be an integer.");
	}
	if (!toolCallId) {
		throw new Error("approval.request payload 'toolCallId' is required.");
	}
	if (!toolName) {
		throw new Error("approval.request payload 'toolName' is required.");
	}
	return {
		sessionId,
		agentId,
		conversationId,
		iteration,
		toolCallId,
		toolName,
		input: payload.input,
		policy:
			payload.policy && typeof payload.policy === "object"
				? (payload.policy as ToolApprovalRequest["policy"])
				: ({} as ToolApprovalRequest["policy"]),
	};
}

function publishApprovalRequest(
	ctx: HubTransportContext,
	approvalId: string,
	request: ToolApprovalRequest,
): void {
	ctx.publish(
		ctx.buildEvent(
			"approval.requested",
			{
				approvalId,
				sessionId: request.sessionId,
				agentId: request.agentId,
				conversationId: request.conversationId,
				iteration: request.iteration,
				toolCallId: request.toolCallId,
				toolName: request.toolName,
				inputJson: JSON.stringify(request.input ?? null),
				policy: request.policy,
			},
			request.sessionId,
		),
	);
}

function enqueueApprovalRequest(
	ctx: HubTransportContext,
	request: ToolApprovalRequest,
	resolve: (result: { approved: boolean; reason?: string }) => void,
): { approvalId?: string; denied?: { approved: boolean; reason: string } } {
	const sessionId = request.sessionId;
	const state = ctx.sessionState.get(sessionId);
	if (state?.interactive === false) {
		return {
			denied: {
				approved: false,
				reason:
					"Tool approval requires an interactive session, but this session is non-interactive.",
			},
		};
	}
	const approvalId = createSessionId("approval_");
	ctx.pendingApprovals.set(approvalId, {
		sessionId,
		resolve,
	});
	publishApprovalRequest(ctx, approvalId, request);
	return { approvalId };
}

export async function requestToolApproval(
	ctx: HubTransportContext,
	request: ToolApprovalRequest,
): Promise<{ approved: boolean; reason?: string }> {
	return await new Promise((resolve) => {
		const queued = enqueueApprovalRequest(ctx, request, resolve);
		if (queued.denied) {
			resolve(queued.denied);
		}
	});
}

export async function handleApprovalRequest(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	try {
		const request = parseApprovalRequestPayload(envelope);
		const queued = enqueueApprovalRequest(ctx, request, () => {});
		if (queued.denied) {
			return okReply(envelope, {
				status: "rejected",
				approved: false,
				reason: queued.denied.reason,
			});
		}
		return okReply(envelope, {
			status: "pending",
			approvalId: queued.approvalId,
			sessionId: request.sessionId,
		});
	} catch (error) {
		return errorReply(
			envelope,
			"invalid_approval_request",
			error instanceof Error ? error.message : String(error),
		);
	}
}

export function resolvePendingApproval(
	ctx: HubTransportContext,
	approvalId: string,
	result: { approved: boolean; reason?: string },
): { sessionId: string } | undefined {
	const pending = ctx.pendingApprovals.get(approvalId);
	if (!pending) {
		return undefined;
	}
	ctx.pendingApprovals.delete(approvalId);
	pending.resolve(result);
	return { sessionId: pending.sessionId };
}

export function cancelPendingApprovals(
	ctx: HubTransportContext,
	filter: (approval: { approvalId: string; sessionId: string }) => boolean,
	reason: string,
): number {
	let cancelled = 0;
	for (const [approvalId, pending] of [...ctx.pendingApprovals.entries()]) {
		if (!filter({ approvalId, sessionId: pending.sessionId })) {
			continue;
		}
		ctx.pendingApprovals.delete(approvalId);
		pending.resolve({ approved: false, reason });
		ctx.publish(
			ctx.buildEvent(
				"approval.resolved",
				{ approvalId, approved: false, cancelled: true, reason },
				pending.sessionId,
			),
		);
		cancelled += 1;
	}
	return cancelled;
}

export async function handleApprovalRespond(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	const approvalId =
		typeof envelope.payload?.approvalId === "string"
			? envelope.payload.approvalId.trim()
			: "";
	const pending = ctx.pendingApprovals.get(approvalId);
	if (!pending) {
		return errorReply(
			envelope,
			"approval_not_found",
			`Unknown approval: ${approvalId}`,
		);
	}
	const reason =
		typeof envelope.payload?.reason === "string"
			? envelope.payload.reason
			: envelope.payload?.payload &&
					typeof envelope.payload.payload === "object" &&
					!Array.isArray(envelope.payload.payload) &&
					typeof (envelope.payload.payload as Record<string, unknown>)
						.reason === "string"
				? ((envelope.payload.payload as Record<string, unknown>)
						.reason as string)
				: undefined;
	const approved = envelope.payload?.approved === true;
	const resolved = resolvePendingApproval(ctx, approvalId, {
		approved,
		reason,
	});
	if (!resolved) {
		return errorReply(
			envelope,
			"approval_not_found",
			`Unknown approval: ${approvalId}`,
		);
	}
	ctx.publish(
		ctx.buildEvent(
			"approval.resolved",
			{ approvalId, approved, reason },
			resolved.sessionId,
		),
	);
	return okReply(envelope, { approvalId, approved });
}
