import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import {
	CursorSandboxConfigError,
	isPathAllowedByCursorSandbox,
	parseCursorSandboxConfig,
	resolveCursorSandboxPolicy,
} from "./cursor-sandbox"
import { CommandPermissionController } from "@core/permissions"

describe("cursor-sandbox config", () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cursor-sandbox-test-"))
	})

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	async function writeSandboxConfig(value: unknown): Promise<string> {
		const cursorDir = path.join(tempDir, ".cursor")
		await fs.mkdir(cursorDir, { recursive: true })
		const configPath = path.join(cursorDir, "sandbox.json")
		await fs.writeFile(configPath, JSON.stringify(value), "utf8")
		return configPath
	}

	it("parses Cursor sandbox defaults conservatively", () => {
		const config = parseCursorSandboxConfig({})

		config.type.should.equal("workspace_readwrite")
		config.additionalReadwritePaths.should.eql([])
		config.additionalReadonlyPaths.should.eql([])
		config.disableTmpWrite.should.equal(false)
		config.enableSharedBuildCache.should.equal(false)
		config.blockGitWrites.should.equal(false)
		config.networkPolicy.should.eql({ default: "deny", allow: [] })
	})

	it("accepts legacy snake-case aliases", () => {
		const config = parseCursorSandboxConfig({
			type: "workspace_readwrite",
			additional_readwrite_paths: ["../cache"],
			additional_readonly_paths: ["/var/log"],
			disable_tmp_write: true,
			enable_shared_build_cache: true,
			block_git_writes: true,
			network_access: false,
		})

		config.additionalReadwritePaths.should.eql(["../cache"])
		config.additionalReadonlyPaths.should.eql(["/var/log"])
		config.disableTmpWrite.should.equal(true)
		config.enableSharedBuildCache.should.equal(true)
		config.blockGitWrites.should.equal(true)
		config.networkPolicy.should.eql({ default: "deny", allow: [] })
	})

	it("rejects invalid known fields and conflicting aliases", () => {
		const invalidKnownField = () => parseCursorSandboxConfig({ disableTmpWrite: "yes" })
		const conflictingAliases = () =>
			parseCursorSandboxConfig({
				additionalReadwritePaths: ["cache-a"],
				additional_readwrite_paths: ["cache-b"],
			})

		invalidKnownField.should.throw(CursorSandboxConfigError)
		conflictingAliases.should.throw(CursorSandboxConfigError)
	})

	it("returns undefined when no sandbox config exists", async () => {
		const policy = await resolveCursorSandboxPolicy({
			workspaceRoot: tempDir,
			enabled: true,
			policySetting: "prompt",
		})

		should(policy).be.undefined()
	})

	it("prompt policy loads config without enabling write or terminal auto-approval", async () => {
		await writeSandboxConfig({
			type: "workspace_readwrite",
			additionalReadwritePaths: ["../cache"],
			networkPolicy: { default: "deny", allow: ["api.github.com"] },
		})

		const policy = await resolveCursorSandboxPolicy({
			workspaceRoot: tempDir,
			enabled: true,
			policySetting: "prompt",
		})

		should(policy).be.ok()
		policy!.status.should.equal("loaded")
		policy!.effectiveAccess.should.equal("prompt")
		policy!.allowWriteAutoApprove.should.equal(false)
		policy!.allowTerminalAutoApprove.should.equal(false)
		policy!.allowNetworkAutoApprove.should.equal(false)
		policy!.writablePaths.should.eql([])
		isPathAllowedByCursorSandbox(path.join(tempDir, "src/index.ts"), policy!.readablePaths).should.equal(true)
	})

	it("workspace policy maps readwrite config to writable sandbox paths", async () => {
		await writeSandboxConfig({
			type: "workspace_readwrite",
			additionalReadwritePaths: ["../cache"],
			networkPolicy: { default: "allow" },
		})

		const policy = await resolveCursorSandboxPolicy({
			workspaceRoot: tempDir,
			enabled: true,
			policySetting: "workspace",
		})

		should(policy).be.ok()
		policy!.effectiveAccess.should.equal("workspace")
		policy!.allowWriteAutoApprove.should.equal(true)
		policy!.allowTerminalAutoApprove.should.equal(true)
		policy!.allowNetworkAutoApprove.should.equal(true)
		isPathAllowedByCursorSandbox(path.join(tempDir, "src/index.ts"), policy!.writablePaths).should.equal(true)
		isPathAllowedByCursorSandbox(path.resolve(tempDir, "../cache/out.txt"), policy!.writablePaths).should.equal(true)
	})

	it("read-only sandbox config maps to command permission allowlist", async () => {
		await writeSandboxConfig({
			type: "workspace_readonly",
			networkPolicy: { default: "allow" },
		})

		const policy = await resolveCursorSandboxPolicy({
			workspaceRoot: tempDir,
			enabled: true,
			policySetting: "workspace",
		})

		should(policy).be.ok()
		policy!.effectiveAccess.should.equal("readOnly")
		policy!.allowWriteAutoApprove.should.equal(false)
		policy!.commandPermissions!.allow!.should.containEql("git status *")
		policy!.commandPermissions!.allowRedirects!.should.equal(false)
	})

	it("blockGitWrites maps to command permissions without blocking unrelated redirects", async () => {
		await writeSandboxConfig({
			type: "workspace_readwrite",
			blockGitWrites: true,
			networkPolicy: { default: "allow" },
		})

		const policy = await resolveCursorSandboxPolicy({
			workspaceRoot: tempDir,
			enabled: true,
			policySetting: "workspace",
		})

		should(policy).be.ok()
		policy!.blockGitWrites.should.equal(true)
		policy!.commandPermissions!.deny!.should.containEql("git commit *")
		policy!.commandPermissions!.allowRedirects!.should.equal(true)

		const controller = new CommandPermissionController(policy!.commandPermissions)
		controller.validateCommand("git status --short").allowed.should.equal(true)
		controller.validateCommand("echo ok > out.txt").allowed.should.equal(true)
		controller.validateCommand("git commit -m test").allowed.should.equal(false)
		controller.validateCommand("git push origin main").allowed.should.equal(false)
	})

	it("invalid config fails closed to read-only policy", async () => {
		await writeSandboxConfig({ type: "workspace_readwrite", disableTmpWrite: "nope" })
		const warnings: string[] = []

		const policy = await resolveCursorSandboxPolicy({
			workspaceRoot: tempDir,
			enabled: true,
			policySetting: "workspace",
			logger: { warn: (message) => warnings.push(message) },
		})

		should(policy).be.ok()
		policy!.status.should.equal("invalid")
		policy!.effectiveAccess.should.equal("readOnly")
		policy!.allowWriteAutoApprove.should.equal(false)
		policy!.allowTerminalAutoApprove.should.equal(false)
		policy!.networkPolicy.should.eql({ default: "deny", allow: [] })
		policy!.blockGitWrites.should.equal(true)
		warnings.length.should.equal(1)
	})
})
