import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyCursorSandboxToolPolicies,
	CursorSandboxConfigError,
	createCursorSandboxToolPolicies,
	isPathAllowedByCursorSandbox,
	parseCursorSandboxConfig,
	resolveCursorSandboxConfigPath,
	resolveCursorSandboxPolicy,
} from "./cursor-sandbox";

describe("Cursor sandbox config", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "core-cursor-sandbox-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("parses defaults for an empty config", () => {
		const config = parseCursorSandboxConfig({});

		expect(config).toEqual({
			type: "workspace_readwrite",
			additionalReadwritePaths: [],
			additionalReadonlyPaths: [],
			disableTmpWrite: false,
			enableSharedBuildCache: false,
			blockGitWrites: false,
			networkPolicy: { default: "deny", allow: [] },
		});
	});

	it("normalizes snake_case aliases and network_access", () => {
		const config = parseCursorSandboxConfig({
			type: "workspace_readonly",
			additional_readwrite_paths: ["../cache"],
			additional_readonly_paths: ["/var/log/project"],
			disable_tmp_write: true,
			enable_shared_build_cache: true,
			block_git_writes: true,
			network_access: true,
		});

		expect(config).toEqual({
			type: "workspace_readonly",
			additionalReadwritePaths: ["../cache"],
			additionalReadonlyPaths: ["/var/log/project"],
			disableTmpWrite: true,
			enableSharedBuildCache: true,
			blockGitWrites: true,
			networkPolicy: { default: "allow", allow: [] },
		});
	});

	it("accepts duplicate camelCase and snake_case aliases when values match", () => {
		const config = parseCursorSandboxConfig({
			additionalReadwritePaths: ["../cache"],
			additional_readwrite_paths: ["../cache"],
			additionalReadonlyPaths: ["/var/log/project"],
			additional_readonly_paths: ["/var/log/project"],
			disableTmpWrite: true,
			disable_tmp_write: true,
			enableSharedBuildCache: false,
			enable_shared_build_cache: false,
			blockGitWrites: true,
			block_git_writes: true,
			networkPolicy: { default: "deny", allow: ["api.example.com"] },
			network_policy: { default: "deny", allow: ["api.example.com"] },
			networkAccess: false,
			network_access: false,
		});

		expect(config).toEqual({
			type: "workspace_readwrite",
			additionalReadwritePaths: ["../cache"],
			additionalReadonlyPaths: ["/var/log/project"],
			disableTmpWrite: true,
			enableSharedBuildCache: false,
			blockGitWrites: true,
			networkPolicy: { default: "deny", allow: ["api.example.com"] },
		});
	});

	it("rejects invalid known fields and conflicting aliases", () => {
		expect(() => parseCursorSandboxConfig({ disableTmpWrite: "yes" })).toThrow(
			CursorSandboxConfigError,
		);
		expect(() =>
			parseCursorSandboxConfig({
				networkPolicy: { default: "deny" },
				network_access: true,
			}),
		).toThrow(CursorSandboxConfigError);
	});

	it("returns undefined when the sandbox file is absent or disabled", async () => {
		await expect(
			resolveCursorSandboxPolicy({ workspaceRoot: tempDir }),
		).resolves.toBeUndefined();
		await expect(
			resolveCursorSandboxPolicy({
				workspaceRoot: tempDir,
				policySetting: "disabled",
			}),
		).resolves.toBeUndefined();
	});

	it("loads workspace policies and normalizes readable and writable paths", async () => {
		await mkdir(path.join(tempDir, ".cursor"), { recursive: true });
		await writeFile(
			resolveCursorSandboxConfigPath(tempDir),
			JSON.stringify({
				additionalReadwritePaths: ["../cache"],
				additionalReadonlyPaths: ["../docs"],
				networkPolicy: { default: "allow", allow: ["api.example.com"] },
			}),
		);

		const policy = await resolveCursorSandboxPolicy({
			workspaceRoot: tempDir,
			policySetting: "workspace",
		});

		expect(policy).toMatchObject({
			source: "cursor-sandbox",
			status: "loaded",
			effectiveAccess: "workspace",
			allowReadAutoApprove: true,
			allowWriteAutoApprove: true,
			allowTerminalAutoApprove: true,
			allowNetworkAutoApprove: true,
		});
		expect(
			isPathAllowedByCursorSandbox(
				path.join(tempDir, "src/index.ts"),
				policy!.readablePaths,
			),
		).toBe(true);
		expect(
			isPathAllowedByCursorSandbox(
				path.resolve(tempDir, "../cache/out.txt"),
				policy!.writablePaths,
			),
		).toBe(true);
	});

	it("downgrades invalid configs to a read-only runtime policy", async () => {
		await mkdir(path.join(tempDir, ".cursor"), { recursive: true });
		await writeFile(
			resolveCursorSandboxConfigPath(tempDir),
			JSON.stringify({ type: "bad" }),
		);
		const logger = { warn: vi.fn() };

		const policy = await resolveCursorSandboxPolicy({
			workspaceRoot: tempDir,
			logger,
		});

		expect(policy).toMatchObject({
			status: "invalid",
			effectiveAccess: "readOnly",
			allowWriteAutoApprove: false,
			allowTerminalAutoApprove: false,
			allowNetworkAutoApprove: false,
			blockGitWrites: true,
		});
		expect(policy?.error).toContain("Invalid .cursor/sandbox.json");
		expect(logger.warn).toHaveBeenCalledTimes(1);
	});

	it("maps read-only sandbox policies to approval-required risky tools", async () => {
		await mkdir(path.join(tempDir, ".cursor"), { recursive: true });
		await writeFile(
			resolveCursorSandboxConfigPath(tempDir),
			JSON.stringify({ type: "workspace_readonly", networkAccess: false }),
		);
		const policy = await resolveCursorSandboxPolicy({ workspaceRoot: tempDir });

		const toolPolicies = createCursorSandboxToolPolicies(policy!);

		expect(toolPolicies["*"]).toEqual({ autoApprove: false });
		expect(toolPolicies.read_files).toEqual({ autoApprove: true });
		expect(toolPolicies.search_codebase).toEqual({ autoApprove: true });
		expect(toolPolicies.editor).toEqual({ autoApprove: false });
		expect(toolPolicies.apply_patch).toEqual({ autoApprove: false });
		expect(toolPolicies.run_commands).toEqual({ autoApprove: false });
		expect(toolPolicies.fetch_web_content).toEqual({ autoApprove: false });
	});

	it("exposes read-only command permissions for headless Cursor sandbox hosts", async () => {
		await mkdir(path.join(tempDir, ".cursor"), { recursive: true });
		await writeFile(
			resolveCursorSandboxConfigPath(tempDir),
			JSON.stringify({
				type: "workspace_readonly",
				blockGitWrites: true,
				networkPolicy: { default: "allow" },
			}),
		);

		const policy = await resolveCursorSandboxPolicy({
			workspaceRoot: tempDir,
			policySetting: "workspace",
		});

		expect(policy?.commandPermissions).toMatchObject({
			allowRedirects: false,
		});
		expect(policy?.commandPermissions?.allow).toContain("git status *");
		expect(policy?.commandPermissions?.deny).toContain("git commit *");
	});

	it("exposes git-write deny permissions without read-only allowlists", async () => {
		await mkdir(path.join(tempDir, ".cursor"), { recursive: true });
		await writeFile(
			resolveCursorSandboxConfigPath(tempDir),
			JSON.stringify({
				blockGitWrites: true,
				networkPolicy: { default: "allow" },
			}),
		);

		const policy = await resolveCursorSandboxPolicy({
			workspaceRoot: tempDir,
			policySetting: "workspace",
		});

		expect(policy?.effectiveAccess).toBe("workspace");
		expect(policy?.commandPermissions).toMatchObject({
			allowRedirects: true,
		});
		expect(policy?.commandPermissions?.allow).toBeUndefined();
		expect(policy?.commandPermissions?.deny).toContain("git push *");
	});

	it("merges sandbox tool policies into existing runtime policies", async () => {
		await mkdir(path.join(tempDir, ".cursor"), { recursive: true });
		await writeFile(
			resolveCursorSandboxConfigPath(tempDir),
			JSON.stringify({
				networkPolicy: { default: "allow" },
			}),
		);
		const policy = await resolveCursorSandboxPolicy({
			workspaceRoot: tempDir,
			policySetting: "workspace",
		});
		const target = {
			"*": { autoApprove: true },
			editor: { enabled: true, autoApprove: false },
			run_commands: { enabled: true, autoApprove: true },
		};

		applyCursorSandboxToolPolicies(target, policy);

		expect(target).toMatchObject({
			"*": { autoApprove: false },
			editor: { enabled: true, autoApprove: false },
			run_commands: { enabled: true, autoApprove: true },
			fetch_web_content: { autoApprove: true },
		});
	});

	it("does not widen an existing global approval-off policy", async () => {
		await mkdir(path.join(tempDir, ".cursor"), { recursive: true });
		await writeFile(
			resolveCursorSandboxConfigPath(tempDir),
			JSON.stringify({
				networkPolicy: { default: "allow" },
			}),
		);
		const policy = await resolveCursorSandboxPolicy({
			workspaceRoot: tempDir,
			policySetting: "workspace",
		});
		const target = {
			"*": { autoApprove: false },
		};

		applyCursorSandboxToolPolicies(target, policy);

		expect(target).toMatchObject({
			"*": { autoApprove: false },
			read_files: { autoApprove: false },
			search_codebase: { autoApprove: false },
			editor: { autoApprove: false },
			run_commands: { autoApprove: false },
			fetch_web_content: { autoApprove: false },
		});
	});
});
