import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import * as fs from "node:fs"
import * as net from "node:net"
import * as os from "node:os"
import * as path from "node:path"
import * as health from "grpc-health-check"
import { CodeVibeApiServerMock } from "../src/test/e2e/fixtures/server/index"

type StandaloneManifest = {
	package?: {
		coreEntry?: unknown
		nodeTargetVersion?: unknown
	}
	launch?: {
		args?: unknown
		nodePath?: unknown
	}
	targets?: Array<{
		platform?: unknown
		arch?: unknown
		binariesPath?: unknown
	}>
}

type CliOptions = {
	zip: string
	timeoutMs: number
	keepTemp: boolean
}

type ManagedChild = {
	child: ChildProcess
	label: string
	stdout: string[]
	stderr: string[]
}

type NodeRuntime = {
	path: string
	version: string
	modules: string
}

const projectRoot = path.resolve(__dirname, "..")
const localTsxCli = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs")

function parseArgs(argv: string[]): CliOptions {
	const options: CliOptions = {
		zip: path.join(projectRoot, "dist-standalone", "standalone.zip"),
		timeoutMs: 90000,
		keepTemp: false,
	}
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index]
		if (arg === "--zip") {
			const value = argv[++index]
			if (!value) {
				throw new Error("--zip requires a value")
			}
			options.zip = path.resolve(process.cwd(), value)
		} else if (arg === "--timeout-ms") {
			const value = Number(argv[++index])
			if (!Number.isFinite(value) || value <= 0) {
				throw new Error("--timeout-ms requires a positive number")
			}
			options.timeoutMs = value
		} else if (arg === "--keep-temp") {
			options.keepTemp = true
		} else if (arg === "-h" || arg === "--help") {
			console.log("Usage: smoke-standalone-package.ts [--zip <path>] [--timeout-ms <ms>] [--keep-temp]")
			process.exit(0)
		} else {
			throw new Error(`Unknown argument: ${arg}`)
		}
	}
	return options
}

function readJsonFile<T>(filePath: string): T {
	return JSON.parse(fs.readFileSync(filePath, "utf8")) as T
}

function uniqueStrings(values: Array<string | undefined>): string[] {
	const seen = new Set<string>()
	const result: string[] = []
	for (const value of values) {
		if (!value || seen.has(value)) {
			continue
		}
		seen.add(value)
		result.push(value)
	}
	return result
}

function readNodeRuntime(binaryPath: string): NodeRuntime | undefined {
	try {
		const output = execFileSync(
			binaryPath,
			["-p", "JSON.stringify({version:process.versions.node,modules:process.versions.modules})"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		)
		const parsed = JSON.parse(output.trim()) as { version?: unknown; modules?: unknown }
		if (typeof parsed.version === "string" && typeof parsed.modules === "string") {
			return { path: binaryPath, version: parsed.version, modules: parsed.modules }
		}
	} catch {
		return undefined
	}
	return undefined
}

function findPathNodeCandidates(): string[] {
	try {
		return execFileSync("which", ["-a", "node"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean)
	} catch {
		return []
	}
}

function findNvmNodeCandidates(expectedMajor: string | undefined): string[] {
	if (!expectedMajor) {
		return []
	}
	const nvmRoot = path.join(os.homedir(), ".nvm", "versions", "node")
	if (!fs.existsSync(nvmRoot)) {
		return []
	}
	return fs
		.readdirSync(nvmRoot)
		.filter((entry) => entry.startsWith(`v${expectedMajor}.`))
		.map((entry) => path.join(nvmRoot, entry, "bin", "node"))
}

function resolveRuntimeNode(manifest: StandaloneManifest): NodeRuntime {
	const targetVersion = typeof manifest.package?.nodeTargetVersion === "string" ? manifest.package.nodeTargetVersion : undefined
	const expectedMajor = targetVersion?.split(".")[0]
	const candidates = uniqueStrings([
		process.env.CODEVIBE_STANDALONE_NODE,
		process.execPath,
		...findPathNodeCandidates(),
		...findNvmNodeCandidates(expectedMajor),
	])
	const runtimes = candidates.map(readNodeRuntime).filter((runtime): runtime is NodeRuntime => Boolean(runtime))
	if (!expectedMajor) {
		return runtimes[0] ?? { path: process.execPath, version: process.versions.node, modules: process.versions.modules }
	}
	const matchingRuntime = runtimes.find((runtime) => runtime.version.split(".")[0] === expectedMajor)
	if (matchingRuntime) {
		return matchingRuntime
	}
	throw new Error(
		`No Node ${expectedMajor} runtime found for standalone package target ${targetVersion}. ` +
			`Set CODEVIBE_STANDALONE_NODE to a compatible node binary. Checked: ${candidates.join(", ")}`,
	)
}

async function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer()
		server.unref()
		server.on("error", reject)
		server.listen(0, "127.0.0.1", () => {
			const address = server.address()
			if (!address || typeof address === "string") {
				server.close(() => reject(new Error("Failed to allocate a TCP port")))
				return
			}
			const { port } = address
			server.close((error) => {
				if (error) {
					reject(error)
				} else {
					resolve(port)
				}
			})
		})
	})
}

function appendBounded(lines: string[], data: Buffer) {
	const text = data.toString("utf8")
	for (const line of text.split(/\r?\n/)) {
		if (!line) {
			continue
		}
		lines.push(line)
		while (lines.length > 80) {
			lines.shift()
		}
	}
}

function spawnManaged(label: string, command: string, args: string[], options: Parameters<typeof spawn>[2]): ManagedChild {
	const child = spawn(command, args, {
		...options,
		stdio: ["ignore", "pipe", "pipe"],
	})
	const managed: ManagedChild = {
		child,
		label,
		stdout: [],
		stderr: [],
	}
	child.stdout?.on("data", (data: Buffer) => appendBounded(managed.stdout, data))
	child.stderr?.on("data", (data: Buffer) => appendBounded(managed.stderr, data))
	return managed
}

function formatChildTail(managed: ManagedChild): string {
	const output = [
		`${managed.label} stdout:`,
		...(managed.stdout.length > 0 ? managed.stdout.slice(-25) : ["<empty>"]),
		`${managed.label} stderr:`,
		...(managed.stderr.length > 0 ? managed.stderr.slice(-25) : ["<empty>"]),
	]
	return output.join("\n")
}

function createHealthClient(address: string) {
	const healthDef = protoLoader.loadSync(health.protoPath)
	const grpcObj = grpc.loadPackageDefinition(healthDef) as any
	const Health = grpcObj.grpc.health.v1.Health
	const opts: grpc.ChannelOptions = { "grpc.enable_http_proxy": 0 }
	return new Health(address, grpc.credentials.createInsecure(), opts)
}

async function checkHealthOnce(client: any): Promise<boolean> {
	return new Promise((resolve) => {
		client.check({ service: "" }, (error: unknown, response: any) => {
			if (error) {
				resolve(false)
				return
			}
			resolve(response?.status === 1 || response?.status === "SERVING")
		})
	})
}

async function waitForGrpcHealth(address: string, label: string, managed: ManagedChild, timeoutMs: number) {
	const client = createHealthClient(address)
	const deadline = Date.now() + timeoutMs
	try {
		while (Date.now() < deadline) {
			if (managed.child.exitCode !== null || managed.child.signalCode !== null) {
				throw new Error(`${label} exited before becoming healthy\n${formatChildTail(managed)}`)
			}
			if (await checkHealthOnce(client)) {
				return
			}
			await new Promise((resolve) => setTimeout(resolve, 500))
		}
		throw new Error(`${label} did not become healthy at ${address} within ${timeoutMs}ms\n${formatChildTail(managed)}`)
	} finally {
		client.close()
	}
}

function selectCurrentTarget(manifest: StandaloneManifest) {
	const target = manifest.targets?.find((entry) => entry.platform === process.platform && entry.arch === process.arch)
	if (!target || typeof target.binariesPath !== "string") {
		throw new Error(`standalone-manifest.json has no target for ${process.platform}-${process.arch}`)
	}
	return target
}

function resolveNodePath(manifest: StandaloneManifest, extractRoot: string): string {
	if (typeof manifest.launch?.nodePath !== "string") {
		throw new Error("standalone-manifest.json launch.nodePath must be a string")
	}
	const target = selectCurrentTarget(manifest)
	const rawEntries = manifest.launch.nodePath.replaceAll("{target.binariesPath}", target.binariesPath)
	return rawEntries
		.split(":")
		.map((entry) => {
			const trimmed = entry.trim()
			if (!trimmed) {
				throw new Error("standalone-manifest.json launch.nodePath includes an empty entry")
			}
			return path.resolve(extractRoot, trimmed)
		})
		.join(path.delimiter)
}

function getLaunchArgs(manifest: StandaloneManifest): string[] {
	if (!Array.isArray(manifest.launch?.args) || manifest.launch.args.length === 0) {
		throw new Error("standalone-manifest.json launch.args must be a non-empty array")
	}
	for (const arg of manifest.launch.args) {
		if (typeof arg !== "string") {
			throw new Error("standalone-manifest.json launch.args must contain only strings")
		}
	}
	if (typeof manifest.package?.coreEntry !== "string" || !manifest.launch.args.includes(manifest.package.coreEntry)) {
		throw new Error("standalone-manifest.json launch.args must include package.coreEntry")
	}
	return manifest.launch.args
}

async function stopChild(managed: ManagedChild): Promise<void> {
	const { child } = managed
	if (child.exitCode !== null || child.signalCode !== null) {
		return
	}
	await new Promise<void>((resolve) => {
		const timer = setTimeout(() => {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill("SIGKILL")
			}
			resolve()
		}, 2500)
		child.once("exit", () => {
			clearTimeout(timer)
			resolve()
		})
		child.kill("SIGINT")
	})
}

async function main() {
	const options = parseArgs(process.argv.slice(2))
	if (!fs.existsSync(options.zip)) {
		throw new Error(`standalone.zip not found at ${options.zip}; run npm --prefix apps/vscode run compile-standalone first`)
	}
	if (!fs.existsSync(localTsxCli)) {
		throw new Error(`Local tsx CLI not found at ${localTsxCli}`)
	}

	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codevibe-standalone-smoke-"))
	const extractRoot = path.join(tempRoot, "install")
	const codeVibeDir = path.join(tempRoot, "home")
	const workspaceDir = path.join(tempRoot, "workspace")
	const children: ManagedChild[] = []
	let stopping = false

	const cleanup = async () => {
		if (stopping) {
			return
		}
		stopping = true
		for (const managed of [...children].reverse()) {
			await stopChild(managed)
		}
		await CodeVibeApiServerMock.stopGlobalServer()
		if (!options.keepTemp) {
			fs.rmSync(tempRoot, { recursive: true, force: true })
		}
	}

	process.once("SIGINT", () => {
		cleanup().finally(() => process.exit(130))
	})
	process.once("SIGTERM", () => {
		cleanup().finally(() => process.exit(143))
	})

	try {
		fs.mkdirSync(extractRoot, { recursive: true })
		fs.mkdirSync(codeVibeDir, { recursive: true })
		fs.mkdirSync(workspaceDir, { recursive: true })
		execFileSync("unzip", ["-o", "-q", options.zip, "-d", extractRoot], { stdio: "pipe" })

		const manifestPath = path.join(extractRoot, "standalone-manifest.json")
		const manifest = readJsonFile<StandaloneManifest>(manifestPath)
		const launchArgs = getLaunchArgs(manifest)
		const nodePath = resolveNodePath(manifest, extractRoot)
		const runtimeNode = resolveRuntimeNode(manifest)
		const protobusPort = await getFreePort()
		const hostBridgePort = await getFreePort()
		const protobusAddress = `127.0.0.1:${protobusPort}`
		const hostBridgeAddress = `127.0.0.1:${hostBridgePort}`

		await CodeVibeApiServerMock.startGlobalServer()

		const hostBridge = spawnManaged("HostBridge", process.execPath, [localTsxCli, "scripts/test-hostbridge-server.ts"], {
			cwd: projectRoot,
			env: {
				...process.env,
				HOST_BRIDGE_ADDRESS: hostBridgeAddress,
				TEST_HOSTBRIDGE_WORKSPACE_DIR: workspaceDir,
			},
		})
		children.push(hostBridge)
		await waitForGrpcHealth(hostBridgeAddress, "HostBridge", hostBridge, options.timeoutMs)

		const core = spawnManaged("CodeVibe core", runtimeNode.path, launchArgs, {
			cwd: extractRoot,
			env: {
				...process.env,
				NODE_PATH: nodePath,
				DEV_WORKSPACE_FOLDER: workspaceDir,
				WORKSPACE_DIR: workspaceDir,
				PROTOBUS_ADDRESS: protobusAddress,
				HOST_BRIDGE_ADDRESS: hostBridgeAddress,
				E2E_TEST: "true",
				CODEVIBE_ENVIRONMENT: "local",
				CLINE_ENVIRONMENT: "local",
				CODEVIBE_DIR: codeVibeDir,
				CODEVIBE_DATA_DIR: path.join(codeVibeDir, "data"),
				CLINE_DIR: codeVibeDir,
				INSTALL_DIR: extractRoot,
			},
		})
		children.push(core)
		await waitForGrpcHealth(protobusAddress, "CodeVibe core", core, options.timeoutMs)

		console.log(
			JSON.stringify(
				{
					ok: true,
					zip: options.zip,
					extractedRoot: extractRoot,
					coreEntry: manifest.package?.coreEntry,
					nodeRuntime: runtimeNode,
					nodePathEntries: nodePath.split(path.delimiter),
					protobusAddress,
					hostBridgeAddress,
				},
				null,
				2,
			),
		)
	} finally {
		await cleanup()
	}
}

main().catch((error) => {
	console.error(`smoke-standalone-package: ${error instanceof Error ? error.message : String(error)}`)
	process.exit(1)
})
