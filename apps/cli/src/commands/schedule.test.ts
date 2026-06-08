import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createScheduleCommand } from "./schedule";

const mockSendHubCommand = vi.hoisted(() => vi.fn());
const mockEnsureCliHubServer = vi.hoisted(() => vi.fn());
const mockParseAutomationEventNdjson = vi.hoisted(() => vi.fn());

vi.mock("@cline/core", () => ({
	Llms: {
		BUILT_IN_PROVIDER: { OPENAI_CODEX: "openai-codex" },
		MODEL_COLLECTIONS_BY_PROVIDER_ID: {
			"openai-codex": { provider: { defaultModelId: "gpt-5.5" } },
		},
		normalizeProviderId: vi.fn((providerId: string) => providerId),
	},
	sendHubCommand: mockSendHubCommand,
	parseAutomationEventNdjson: mockParseAutomationEventNdjson,
}));

vi.mock("../utils/hub-runtime", () => ({
	ensureCliHubServer: mockEnsureCliHubServer,
	parseHubEndpointOverride: (rawAddress: string | undefined) => {
		const trimmed = rawAddress?.trim();
		if (!trimmed) {
			return {};
		}
		const parsed = new URL(
			trimmed.includes("://") ? trimmed : `ws://${trimmed}`,
		);
		return {
			host: parsed.hostname || undefined,
			port: parsed.port ? Number(parsed.port) : undefined,
			pathname:
				parsed.pathname && parsed.pathname !== "/"
					? parsed.pathname
					: undefined,
		};
	},
}));

async function runScheduleCommand(
	args: string[],
	io: { writeln: (text?: string) => void; writeErr: (text: string) => void },
): Promise<number> {
	let exitCode = 0;
	const cmd = createScheduleCommand(io, (code) => {
		exitCode = code;
	});
	await cmd.parseAsync(args, { from: "user" });
	return exitCode;
}

describe("runScheduleCommand list output", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('prints "No schedules found." for empty non-json list output', async () => {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
		mockSendHubCommand.mockResolvedValue({
			ok: true,
			payload: { schedules: [] },
		});

		const output: string[] = [];
		const errors: string[] = [];
		const code = await runScheduleCommand(
			["list", "--address", "127.0.0.1:25463"],
			{
				writeln: (text?: string) => {
					output.push(text ?? "");
				},
				writeErr: (text: string) => {
					errors.push(text);
				},
			},
		);

		expect(code).toBe(0);
		expect(errors).toEqual([]);
		expect(output).toEqual(["No schedules found."]);
		expect(mockSendHubCommand).toHaveBeenCalledWith(
			{ host: "127.0.0.1", port: 25463, pathname: "/hub" },
			{
				clientId: "cline-schedule",
				command: "schedule.list",
				payload: {
					limit: 100,
					enabled: undefined,
					tags: undefined,
				},
			},
		);
	});

	it("keeps JSON list output unchanged when --json is provided", async () => {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
		mockSendHubCommand.mockResolvedValue({
			ok: true,
			payload: { schedules: [] },
		});

		const output: string[] = [];
		const errors: string[] = [];
		const code = await runScheduleCommand(
			["list", "--json", "--address", "127.0.0.1:25463"],
			{
				writeln: (text?: string) => {
					output.push(text ?? "");
				},
				writeErr: (text: string) => {
					errors.push(text);
				},
			},
		);

		expect(code).toBe(0);
		expect(errors).toEqual([]);
		expect(output).toEqual(["[]"]);
		expect(mockSendHubCommand).toHaveBeenCalled();
	});
});

describe("runScheduleCommand create delivery metadata", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("maps --delivery-bot to delivery.userName", async () => {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
		mockSendHubCommand.mockResolvedValue({
			ok: true,
			payload: { schedule: { scheduleId: "sched_delivery" } },
		});

		const output: string[] = [];
		const errors: string[] = [];
		const code = await runScheduleCommand(
			[
				"create",
				"Daily summary",
				"--cron",
				"0 9 * * *",
				"--prompt",
				"Summarize yesterday",
				"--workspace",
				"/tmp/workspace",
				"--delivery-adapter",
				"telegram",
				"--delivery-bot",
				"my_bot",
				"--delivery-thread",
				"telegram:123456789",
				"--address",
				"127.0.0.1:25463",
			],
			{
				writeln: (text?: string) => {
					output.push(text ?? "");
				},
				writeErr: (text: string) => {
					errors.push(text);
				},
			},
		);

		expect(code).toBe(0);
		expect(errors).toEqual([]);
		expect(output).toEqual(['{\n  "scheduleId": "sched_delivery"\n}']);
		expect(mockSendHubCommand).toHaveBeenCalledWith(
			{ host: "127.0.0.1", port: 25463, pathname: "/hub" },
			{
				clientId: "cline-schedule",
				command: "schedule.create",
				payload: expect.objectContaining({
					metadata: {
						delivery: {
							adapter: "telegram",
							threadId: "telegram:123456789",
							userName: "my_bot",
						},
					},
				}),
			},
		);
	});
});

describe("runScheduleCommand event validate", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("validates Cursor-style automation NDJSON from a file", async () => {
		const sourcePath = join(
			tmpdir(),
			`cline-schedule-event-${Date.now()}-${Math.random()
				.toString(36)
				.slice(2)}.ndjson`,
		);
		await writeFile(
			sourcePath,
			`${JSON.stringify({ id: "evt_1", type: "git.commit.created" })}\n`,
			"utf8",
		);
		mockParseAutomationEventNdjson.mockReturnValue({
			events: [
				{
					eventId: "evt_1",
					eventType: "git.commit.created",
					source: "cursor",
					occurredAt: "2026-06-06T00:00:00.000Z",
					workspaceRoot: "/repo",
					payload: { secret: "secret-value", ref: "main" },
					attributes: { branch: "main" },
				},
			],
			rejected: [
				{
					lineNumber: 2,
					line: "{bad",
					reason: "invalid_json",
					message: "Unexpected token",
				},
			],
		});

		const output: string[] = [];
		const errors: string[] = [];
		try {
			const code = await runScheduleCommand(
				["event", "validate", sourcePath, "--json"],
				{
					writeln: (text?: string) => {
						output.push(text ?? "");
					},
					writeErr: (text: string) => {
						errors.push(text);
					},
				},
			);

			expect(code).toBe(0);
			expect(errors).toEqual([]);
			expect(mockEnsureCliHubServer).not.toHaveBeenCalled();
			expect(mockSendHubCommand).not.toHaveBeenCalled();
			expect(mockParseAutomationEventNdjson).toHaveBeenCalledWith(
				expect.stringContaining("evt_1"),
				{ defaultSource: "cursor" },
			);
			const parsed = JSON.parse(output[0] ?? "{}");
			expect(parsed).toMatchObject({
				source: sourcePath,
				defaultSource: "cursor",
				eventCount: 1,
				rejectedCount: 1,
				valid: true,
				events: [
					{
						eventId: "evt_1",
						eventType: "git.commit.created",
						payloadKeys: ["ref", "secret"],
						attributeKeys: ["branch"],
					},
				],
				rejected: [
					{
						lineNumber: 2,
						reason: "invalid_json",
						lineLength: 4,
					},
				],
			});
			expect(output[0]).not.toContain("secret-value");
			expect(output[0]).not.toContain("{bad");
		} finally {
			await rm(sourcePath, { force: true });
		}
	});

	it("passes source and size limits to Cursor automation NDJSON validation", async () => {
		const sourcePath = join(
			tmpdir(),
			`cline-schedule-event-${Date.now()}-${Math.random()
				.toString(36)
				.slice(2)}.ndjson`,
		);
		await writeFile(
			sourcePath,
			`${JSON.stringify({ id: "evt_1", type: "git.commit.created", source: "cursor" })}\n`,
			"utf8",
		);
		mockParseAutomationEventNdjson.mockReturnValue({
			events: [
				{
					eventId: "evt_1",
					eventType: "git.commit.created",
					source: "cursor",
					occurredAt: "2026-06-06T00:00:00.000Z",
				},
			],
			rejected: [],
		});

		const output: string[] = [];
		const errors: string[] = [];
		try {
			const code = await runScheduleCommand(
				[
					"event",
					"validate",
					sourcePath,
					"--allowed-sources",
					"cursor,github",
					"--max-line-bytes",
					"2048",
					"--max-events",
					"5",
					"--json",
				],
				{
					writeln: (text?: string) => {
						output.push(text ?? "");
					},
					writeErr: (text: string) => {
						errors.push(text);
					},
				},
			);

			expect(code).toBe(0);
			expect(errors).toEqual([]);
			expect(mockParseAutomationEventNdjson).toHaveBeenCalledWith(
				expect.stringContaining("evt_1"),
				{
					defaultSource: "cursor",
					allowedSources: ["cursor", "github"],
					maxLineBytes: 2048,
					maxEvents: 5,
				},
			);
			expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
				source: sourcePath,
				allowedSources: ["cursor", "github"],
				maxLineBytes: 2048,
				maxEvents: 5,
				eventCount: 1,
				rejectedCount: 0,
				valid: true,
			});
		} finally {
			await rm(sourcePath, { force: true });
		}
	});

	it("fails strict validation when any NDJSON line is rejected", async () => {
		const sourcePath = join(
			tmpdir(),
			`cline-schedule-event-${Date.now()}-${Math.random()
				.toString(36)
				.slice(2)}.ndjson`,
		);
		await writeFile(sourcePath, "{}\n", "utf8");
		mockParseAutomationEventNdjson.mockReturnValue({
			events: [
				{
					eventId: "evt_1",
					eventType: "git.commit.created",
					source: "cursor",
					occurredAt: "2026-06-06T00:00:00.000Z",
				},
			],
			rejected: [
				{
					lineNumber: 1,
					line: "{}",
					reason: "missing_field",
					message: "automation event requires eventId and eventType",
				},
			],
		});

		const output: string[] = [];
		const errors: string[] = [];
		try {
			const code = await runScheduleCommand(
				["event", "validate", sourcePath, "--strict", "--json"],
				{
					writeln: (text?: string) => {
						output.push(text ?? "");
					},
					writeErr: (text: string) => {
						errors.push(text);
					},
				},
			);

			expect(code).toBe(1);
			expect(errors).toEqual([]);
			expect(mockEnsureCliHubServer).not.toHaveBeenCalled();
			expect(mockSendHubCommand).not.toHaveBeenCalled();
			expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
				eventCount: 1,
				rejectedCount: 1,
				valid: false,
				strict: true,
			});
		} finally {
			await rm(sourcePath, { force: true });
		}
	});

	it("validates Cursor-style automation NDJSON from stdin", async () => {
		const stdinSpy = vi
			.spyOn(process.stdin, Symbol.asyncIterator)
			.mockImplementation(() => {
				async function* iterator(): AsyncGenerator<Buffer, undefined, unknown> {
					yield Buffer.from(
						`${JSON.stringify({ id: "evt_stdin", type: "git.checkout.completed" })}\n`,
						"utf8",
					);
					return undefined;
				}
				return iterator();
			});
		mockParseAutomationEventNdjson.mockReturnValue({
			events: [
				{
					eventId: "evt_stdin",
					eventType: "git.checkout.completed",
					source: "cursor",
					occurredAt: "2026-06-06T00:00:00.000Z",
				},
			],
			rejected: [],
		});

		const output: string[] = [];
		const errors: string[] = [];
		try {
			const code = await runScheduleCommand(
				["event", "validate", "-", "--json"],
				{
					writeln: (text?: string) => {
						output.push(text ?? "");
					},
					writeErr: (text: string) => {
						errors.push(text);
					},
				},
			);

			expect(code).toBe(0);
			expect(errors).toEqual([]);
			expect(mockEnsureCliHubServer).not.toHaveBeenCalled();
			expect(mockSendHubCommand).not.toHaveBeenCalled();
			expect(mockParseAutomationEventNdjson).toHaveBeenCalledWith(
				expect.stringContaining("evt_stdin"),
				{ defaultSource: "cursor" },
			);
			expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
				source: "stdin",
				eventCount: 1,
				rejectedCount: 0,
				valid: true,
			});
		} finally {
			stdinSpy.mockRestore();
		}
	});
});

describe("runScheduleCommand import", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("preserves exported modelSelection providerId/modelId values", async () => {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
		mockSendHubCommand.mockResolvedValue({
			ok: true,
			payload: { schedule: { scheduleId: "sched_123" } },
		});

		const sourcePath = join(
			tmpdir(),
			`cline-schedule-import-${Date.now()}.json`,
		);
		await writeFile(
			sourcePath,
			JSON.stringify({
				name: "Daily Review",
				cronPattern: "0 9 * * *",
				prompt: "review status",
				workspaceRoot: "/tmp/workspace",
				modelSelection: {
					providerId: "anthropic",
					modelId: "claude-sonnet-4-6",
				},
			}),
			"utf8",
		);

		const output: string[] = [];
		const errors: string[] = [];
		const code = await runScheduleCommand(
			["import", sourcePath, "--address", "127.0.0.1:25463"],
			{
				writeln: (text?: string) => {
					output.push(text ?? "");
				},
				writeErr: (text: string) => {
					errors.push(text);
				},
			},
		);

		expect(code).toBe(0);
		expect(errors).toEqual([]);
		expect(output).toEqual(['{\n  "scheduleId": "sched_123"\n}']);
		expect(mockSendHubCommand).toHaveBeenCalledWith(
			{ host: "127.0.0.1", port: 25463, pathname: "/hub" },
			{
				clientId: "cline-schedule",
				command: "schedule.create",
				payload: expect.objectContaining({
					provider: "anthropic",
					model: "claude-sonnet-4-6",
				}),
			},
		);
	});
});

describe("runScheduleCommand export", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("writes JSON content to the --to file path", async () => {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
		const scheduleRecord = {
			scheduleId: "sched_abc",
			name: "Daily Review",
			cronPattern: "0 9 * * *",
			prompt: "review status",
			workspaceRoot: "/tmp/workspace",
		};
		mockSendHubCommand.mockResolvedValue({
			ok: true,
			payload: { schedule: scheduleRecord },
		});

		const targetPath = join(
			tmpdir(),
			`cline-schedule-export-${Date.now()}-${Math.random()
				.toString(36)
				.slice(2)}.json`,
		);

		const output: string[] = [];
		const errors: string[] = [];
		try {
			const code = await runScheduleCommand(
				[
					"export",
					"sched_abc",
					"--to",
					targetPath,
					"--address",
					"127.0.0.1:25463",
				],
				{
					writeln: (text?: string) => {
						output.push(text ?? "");
					},
					writeErr: (text: string) => {
						errors.push(text);
					},
				},
			);

			expect(code).toBe(0);
			expect(errors).toEqual([]);
			expect(output).toEqual([`Exported schedule sched_abc to ${targetPath}`]);

			const written = await readFile(targetPath, "utf8");
			expect(written).toBe(JSON.stringify(scheduleRecord, null, 2));
			expect(mockSendHubCommand).toHaveBeenCalledWith(
				{ host: "127.0.0.1", port: 25463, pathname: "/hub" },
				{
					clientId: "cline-schedule",
					command: "schedule.get",
					payload: { scheduleId: "sched_abc" },
				},
			);
		} finally {
			await rm(targetPath, { force: true });
		}
	});

	it("writes YAML content when --to has a non-json extension", async () => {
		mockEnsureCliHubServer.mockResolvedValue({
			url: "ws://127.0.0.1:25463/hub",
			authToken: "test-token",
		});
		const scheduleRecord = {
			scheduleId: "sched_yaml",
			name: "Weekly Sync",
			cronPattern: "0 9 * * 1",
		};
		mockSendHubCommand.mockResolvedValue({
			ok: true,
			payload: { schedule: scheduleRecord },
		});

		const targetPath = join(
			tmpdir(),
			`cline-schedule-export-${Date.now()}-${Math.random()
				.toString(36)
				.slice(2)}.yaml`,
		);

		const output: string[] = [];
		const errors: string[] = [];
		try {
			const code = await runScheduleCommand(
				[
					"export",
					"sched_yaml",
					"--to",
					targetPath,
					"--address",
					"127.0.0.1:25463",
				],
				{
					writeln: (text?: string) => {
						output.push(text ?? "");
					},
					writeErr: (text: string) => {
						errors.push(text);
					},
				},
			);

			expect(code).toBe(0);
			expect(errors).toEqual([]);
			expect(output).toEqual([`Exported schedule sched_yaml to ${targetPath}`]);

			const yaml = await import("yaml");
			const written = await readFile(targetPath, "utf8");
			expect(written).toBe(yaml.stringify(scheduleRecord));
		} finally {
			await rm(targetPath, { force: true });
		}
	});
});
