import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolContext } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createBashExecutor } from "./bash";

const ctx: AgentToolContext = {
	agentId: "agent-1",
	conversationId: "conv-1",
	iteration: 1,
};

const blockGitWritesCtx: AgentToolContext = {
	...ctx,
	metadata: {
		cursorSandboxPolicy: {
			source: "cursor-sandbox",
			effectiveAccess: "workspace",
			readablePaths: [process.cwd()],
			writablePaths: [process.cwd()],
			blockGitWrites: true,
		},
	},
};

const readOnlySandboxCtx: AgentToolContext = {
	...ctx,
	metadata: {
		cursorSandboxPolicy: {
			source: "cursor-sandbox",
			effectiveAccess: "readOnly",
			readablePaths: [process.cwd()],
			writablePaths: [],
			blockGitWrites: false,
		},
	},
};

describe("createBashExecutor", () => {
	it("runs a simple command and returns stdout", async () => {
		const bash = createBashExecutor();
		const output = await bash("echo hello", process.cwd(), ctx);
		expect(output.trim()).toBe("hello");
	});

	it("rejects on non-zero exit code", async () => {
		const bash = createBashExecutor();
		await expect(bash("exit 1", process.cwd(), ctx)).rejects.toThrow();
	});

	it("blocks known file-reading commands for files ignored by .cursorignore", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-bash-"));
		await fs.mkdir(path.join(dir, "secrets"), { recursive: true });
		await fs.writeFile(path.join(dir, ".cursorignore"), "secrets/\n", "utf-8");
		await fs.writeFile(path.join(dir, "secrets", "token.txt"), "secret", "utf-8");

		try {
			const bash = createBashExecutor();
			await expect(bash("cat secrets/token.txt", dir, ctx)).rejects.toThrow(
				"blocked by direct-access ignore settings",
			);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("blocks absolute paths inside cwd for known file-reading commands", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-bash-"));
		const ignoredFile = path.join(dir, "secrets", "token.txt");
		await fs.mkdir(path.dirname(ignoredFile), { recursive: true });
		await fs.writeFile(path.join(dir, ".cursorignore"), "secrets/\n", "utf-8");
		await fs.writeFile(ignoredFile, "secret", "utf-8");

		try {
			const bash = createBashExecutor();
			await expect(bash(`cat ${ignoredFile}`, dir, ctx)).rejects.toThrow(
				"blocked by direct-access ignore settings",
			);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("blocks known file-reading commands outside Cursor sandbox readable paths", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-bash-"));
		await fs.mkdir(path.join(dir, "private"), { recursive: true });
		await fs.mkdir(path.join(dir, "src"), { recursive: true });
		await fs.writeFile(path.join(dir, "private", "token.txt"), "secret", "utf-8");

		try {
			const bash = createBashExecutor();
			await expect(
				bash("cat private/token.txt", dir, {
					...ctx,
					metadata: {
						cursorSandboxPolicy: {
							source: "cursor-sandbox",
							readablePaths: [path.join(dir, "src")],
							writablePaths: [],
						},
					},
				}),
			).rejects.toThrow("outside Cursor sandbox read paths");
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("blocks git write commands when Cursor sandbox blockGitWrites is enabled", async () => {
		const bash = createBashExecutor();

		await expect(
			bash("git commit -m test", process.cwd(), blockGitWritesCtx),
		).rejects.toThrow(".cursor/sandbox.json blockGitWrites");
		await expect(
			bash("cd . && git push origin main", process.cwd(), blockGitWritesCtx),
		).rejects.toThrow(".cursor/sandbox.json blockGitWrites");
	});

	it("blocks structured git write commands with global git options", async () => {
		const bash = createBashExecutor();

		await expect(
			bash(
				{
					command: "git",
					args: ["-C", process.cwd(), "commit", "-m", "test"],
				},
				process.cwd(),
				blockGitWritesCtx,
			),
		).rejects.toThrow(".cursor/sandbox.json blockGitWrites");
	});

	it("allows read-only shell inspection commands in read-only Cursor sandbox mode", async () => {
		const bash = createBashExecutor();
		const output = await bash("pwd", process.cwd(), readOnlySandboxCtx);

		expect(output.trim()).toBe(process.cwd());
	});

	it("blocks shell writes in read-only Cursor sandbox mode", async () => {
		const bash = createBashExecutor();

		await expect(
			bash("echo hi > out.txt", process.cwd(), readOnlySandboxCtx),
		).rejects.toThrow("read-only mode");
		await expect(
			bash(
				{
					command: process.execPath,
					args: ["-e", "process.stdout.write('write')"],
				},
				process.cwd(),
				readOnlySandboxCtx,
			),
		).rejects.toThrow("read-only mode");
	});

	it("blocks command substitution in read-only Cursor sandbox mode", async () => {
		const bash = createBashExecutor();

		await expect(
			bash("git status $(touch out.txt)", process.cwd(), readOnlySandboxCtx),
		).rejects.toThrow("read-only mode");
		await expect(
			bash("git status `touch out.txt`", process.cwd(), readOnlySandboxCtx),
		).rejects.toThrow("read-only mode");
	});

	it("includes stderr in combined output on success", async () => {
		const bash = createBashExecutor({ combineOutput: true });
		const output = await bash(
			{
				command: process.execPath,
				args: [
					"-e",
					"process.stdout.write('ok'); process.stderr.write('warn')",
				],
			},
			process.cwd(),
			ctx,
		);
		expect(output).toContain("ok");
		expect(output).toContain("[stderr]");
		expect(output).toContain("warn");
	});

	it("excludes stderr when combineOutput is false", async () => {
		const bash = createBashExecutor({ combineOutput: false });
		const output = await bash(
			{
				command: process.execPath,
				args: [
					"-e",
					"process.stdout.write('ok'); process.stderr.write('warn')",
				],
			},
			process.cwd(),
			ctx,
		);
		expect(output.trim()).toBe("ok");
	});

	it("rejects on timeout", async () => {
		const bash = createBashExecutor({ timeoutMs: 50 });
		await expect(bash("sleep 10", process.cwd(), ctx)).rejects.toThrow(
			"timed out",
		);
	});

	it("truncates output exceeding maxOutputBytes", async () => {
		const bash = createBashExecutor({ maxOutputBytes: 10 });
		const output = await bash(
			{
				command: process.execPath,
				args: ["-e", "process.stdout.write('a'.repeat(100))"],
			},
			process.cwd(),
			ctx,
		);
		expect(output).toContain("[Output truncated:");
	});

	it("rejects when abort signal fires", async () => {
		const ac = new AbortController();
		const abortCtx: AgentToolContext = { ...ctx, signal: ac.signal };
		const bash = createBashExecutor();

		setTimeout(() => ac.abort(), 50);
		await expect(bash("sleep 10", process.cwd(), abortCtx)).rejects.toThrow(
			"aborted",
		);
	});
});

describe.runIf(process.platform === "win32")("createWindowsExecutor", () => {
	it("runs structured commands without shell parsing", async () => {
		const executor = createBashExecutor();
		const output = await executor(
			{
				command: process.execPath,
				args: ["-e", "process.stdout.write(process.argv[1])", "argv-ok"],
			},
			process.cwd(),
			ctx,
		);
		expect(output).toBe("argv-ok");
	});

	it("runs string commands through the shell", async () => {
		const executor = createBashExecutor();
		const output = await executor("echo shell-ok", process.cwd(), ctx);
		expect(output.trim()).toBe("shell-ok");
	});
});
