import { readFile } from "node:fs/promises";
import {
	parseAutomationEventNdjson,
	type AutomationEventEnvelope,
	type AutomationEventNdjsonRejectReason,
} from "@cline/core";
import { emitJsonOrText } from "./common";
import type { CommandIo } from "./types";

export interface ScheduleEventValidationSummary {
	eventId: string;
	eventType: string;
	source: string;
	occurredAt: string;
	subject?: string;
	workspaceRoot?: string;
	dedupeKey?: string;
	payloadKeys?: string[];
	attributeKeys?: string[];
}

export interface ScheduleEventRejectedSummary {
	lineNumber: number;
	reason: AutomationEventNdjsonRejectReason;
	message: string;
	lineLength: number;
}

export interface ScheduleEventValidationReport {
	source: string;
	defaultSource?: string;
	eventCount: number;
	rejectedCount: number;
	valid: boolean;
	strict: boolean;
	events: ScheduleEventValidationSummary[];
	rejected: ScheduleEventRejectedSummary[];
}

export interface RunScheduleEventValidateOptions {
	source: string;
	defaultSource?: string;
	json?: boolean;
	strict?: boolean;
	io: CommandIo;
}

function recordKeys(value: unknown): string[] | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const keys = Object.keys(value).sort();
	return keys.length > 0 ? keys : undefined;
}

function summarizeEvent(
	event: AutomationEventEnvelope,
): ScheduleEventValidationSummary {
	const payloadKeys = recordKeys(event.payload);
	const attributeKeys = recordKeys(event.attributes);
	return {
		eventId: event.eventId,
		eventType: event.eventType,
		source: event.source,
		occurredAt: event.occurredAt,
		...(event.subject ? { subject: event.subject } : {}),
		...(event.workspaceRoot ? { workspaceRoot: event.workspaceRoot } : {}),
		...(event.dedupeKey ? { dedupeKey: event.dedupeKey } : {}),
		...(payloadKeys ? { payloadKeys } : {}),
		...(attributeKeys ? { attributeKeys } : {}),
	};
}

function summarizeRejectedLine(input: {
	lineNumber: number;
	reason: AutomationEventNdjsonRejectReason;
	message: string;
	line: string;
}): ScheduleEventRejectedSummary {
	return {
		lineNumber: input.lineNumber,
		reason: input.reason,
		message: input.message,
		lineLength: input.line.length,
	};
}

async function readStdin(): Promise<string> {
	let input = "";
	for await (const chunk of process.stdin) {
		input += typeof chunk === "string" ? chunk : chunk.toString("utf8");
	}
	return input;
}

async function readNdjsonSource(source: string): Promise<{
	label: string;
	input: string;
}> {
	if (source === "-") {
		return {
			label: "stdin",
			input: await readStdin(),
		};
	}
	return {
		label: source,
		input: await readFile(source, "utf8"),
	};
}

function writeTextReport(
	io: CommandIo,
	report: ScheduleEventValidationReport,
): void {
	io.writeln(
		`Validated ${report.eventCount} automation event(s) from ${report.source}.`,
	);
	if (report.rejectedCount > 0) {
		io.writeln(`${report.rejectedCount} line(s) rejected:`);
		for (const rejected of report.rejected) {
			io.writeln(
				`- line ${rejected.lineNumber}: ${rejected.reason} - ${rejected.message}`,
			);
		}
	}
	if (report.eventCount === 0) {
		io.writeln("No valid automation events found.");
	}
	if (report.strict && report.rejectedCount > 0) {
		io.writeln("Strict validation failed because one or more lines were rejected.");
	}
}

export async function runScheduleEventValidateCommand(
	options: RunScheduleEventValidateOptions,
): Promise<number> {
	const source = options.source.trim() || "-";
	const defaultSource = options.defaultSource?.trim() || undefined;
	const loaded = await readNdjsonSource(source);
	const parsed = parseAutomationEventNdjson(loaded.input, { defaultSource });
	const report: ScheduleEventValidationReport = {
		source: loaded.label,
		...(defaultSource ? { defaultSource } : {}),
		eventCount: parsed.events.length,
		rejectedCount: parsed.rejected.length,
		strict: !!options.strict,
		valid:
			parsed.events.length > 0 &&
			(!options.strict || parsed.rejected.length === 0),
		events: parsed.events.map(summarizeEvent),
		rejected: parsed.rejected.map(summarizeRejectedLine),
	};

	if (options.json) {
		emitJsonOrText(true, options.io, report);
	} else {
		writeTextReport(options.io, report);
	}

	return report.valid ? 0 : 1;
}
