#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import zlib from "node:zlib"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.join(__dirname, "..")
const defaultPackageJsonPath = path.join(projectRoot, "package.json")

function usage() {
	console.error(`Usage: release-github-vsix.mjs --repo <owner/name> --tag <tag> --vsix <path> [options]

Creates or updates a GitHub Release and uploads the VSIX asset without requiring gh.
Requires GITHUB_TOKEN or GH_TOKEN unless --dry-run is passed.

Options:
  --title <text>        Release title. Defaults to the tag.
  --notes <text>        Release body text.
  --notes-file <path>   Read release body text from a file.
  --target-commitish <ref>
                        Commit/ref to create a new release tag from. Defaults to the current HEAD.
  --prerelease          Mark the release as a prerelease.
  --draft               Create or keep the release as a draft.
  --dry-run             Validate inputs and print the planned release request only.
  -h, --help            Show this help.`)
}

function parseArgs(argv) {
	const options = {
		repo: undefined,
		tag: undefined,
		vsix: undefined,
		title: undefined,
		notes: "",
		notesFile: undefined,
		targetCommitish: undefined,
		prerelease: false,
		draft: false,
		dryRun: false,
	}

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index]
		if (arg === "--repo") {
			options.repo = requireValue(argv, ++index, arg)
		} else if (arg === "--tag") {
			options.tag = requireValue(argv, ++index, arg)
		} else if (arg === "--vsix") {
			options.vsix = requireValue(argv, ++index, arg)
		} else if (arg === "--title") {
			options.title = requireValue(argv, ++index, arg)
		} else if (arg === "--notes") {
			options.notes = requireValue(argv, ++index, arg)
		} else if (arg === "--notes-file") {
			options.notesFile = requireValue(argv, ++index, arg)
		} else if (arg === "--target-commitish") {
			options.targetCommitish = requireValue(argv, ++index, arg)
		} else if (arg === "--prerelease") {
			options.prerelease = true
		} else if (arg === "--draft") {
			options.draft = true
		} else if (arg === "--dry-run") {
			options.dryRun = true
		} else if (arg === "-h" || arg === "--help") {
			usage()
			process.exit(0)
		} else {
			throw new Error(`Unknown argument: ${arg}`)
		}
	}

	return options
}

function requireValue(argv, index, flag) {
	const value = argv[index]
	if (!value || value.startsWith("--")) {
		throw new Error(`${flag} requires a value`)
	}
	return value
}

function parseRepo(repo) {
	const match = /^([^/\s]+)\/([^/\s]+)$/.exec(repo ?? "")
	if (!match) {
		throw new Error("--repo must be in owner/name form")
	}
	return { owner: match[1], name: match[2], slug: `${match[1]}/${match[2]}` }
}

function readPackageVersion() {
	const packageJson = JSON.parse(fs.readFileSync(defaultPackageJsonPath, "utf8"))
	return packageJson.version
}

function defaultVsixPath(version) {
	return path.join(projectRoot, "dist", `codevibe-${version}.vsix`)
}

function findZipEndOfCentralDirectory(buffer) {
	const minimumOffset = Math.max(0, buffer.length - 22 - 0xffff)
	for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
		if (buffer.readUInt32LE(offset) === 0x06054b50) {
			return offset
		}
	}
	throw new Error("VSIX artifact is not a readable zip archive")
}

function listZipEntries(zipPath) {
	const buffer = fs.readFileSync(zipPath)
	const eocdOffset = findZipEndOfCentralDirectory(buffer)
	const entryCount = buffer.readUInt16LE(eocdOffset + 10)
	const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16)
	const entries = new Map()
	let offset = centralDirectoryOffset
	for (let index = 0; index < entryCount; index += 1) {
		if (buffer.readUInt32LE(offset) !== 0x02014b50) {
			throw new Error(`VSIX central directory is corrupt at entry ${index}`)
		}
		const compressionMethod = buffer.readUInt16LE(offset + 10)
		const compressedSize = buffer.readUInt32LE(offset + 20)
		const fileNameLength = buffer.readUInt16LE(offset + 28)
		const extraFieldLength = buffer.readUInt16LE(offset + 30)
		const fileCommentLength = buffer.readUInt16LE(offset + 32)
		const localHeaderOffset = buffer.readUInt32LE(offset + 42)
		const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength)
		entries.set(fileName, {
			compressionMethod,
			compressedSize,
			localHeaderOffset,
		})
		offset += 46 + fileNameLength + extraFieldLength + fileCommentLength
	}
	return { buffer, entries }
}

function readZipEntry(zip, entryName) {
	const entry = zip.entries.get(entryName)
	if (!entry) {
		throw new Error(`VSIX artifact is missing ${entryName}`)
	}
	const { buffer } = zip
	if (buffer.readUInt32LE(entry.localHeaderOffset) !== 0x04034b50) {
		throw new Error(`VSIX local file header is corrupt for ${entryName}`)
	}
	const fileNameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26)
	const extraFieldLength = buffer.readUInt16LE(entry.localHeaderOffset + 28)
	const dataOffset = entry.localHeaderOffset + 30 + fileNameLength + extraFieldLength
	const compressed = buffer.subarray(dataOffset, dataOffset + entry.compressedSize)
	if (entry.compressionMethod === 0) {
		return compressed
	}
	if (entry.compressionMethod === 8) {
		return zlib.inflateRawSync(compressed)
	}
	throw new Error(`VSIX entry ${entryName} uses unsupported compression method ${entry.compressionMethod}`)
}

function validateVsixArtifact(vsixPath, version) {
	const zip = listZipEntries(vsixPath)
	const entries = [...zip.entries.keys()]
	for (const requiredEntry of ["extension/package.json", "extension/dist/extension.js", "extension.vsixmanifest"]) {
		if (!zip.entries.has(requiredEntry)) {
			throw new Error(`VSIX artifact is missing ${requiredEntry}`)
		}
	}
	if (!entries.some((entryName) => entryName.startsWith("extension/webview-ui/build/"))) {
		throw new Error("VSIX artifact is missing extension/webview-ui/build assets")
	}
	for (const entryName of entries) {
		if (entryName.endsWith(".vsix")) {
			throw new Error(`VSIX artifact must not include nested VSIX artifact ${entryName}`)
		}
	}

	const packagedPackageJson = JSON.parse(readZipEntry(zip, "extension/package.json").toString("utf8"))
	if (packagedPackageJson.name !== "codevibe") {
		throw new Error(`VSIX package name mismatch: expected codevibe, found ${packagedPackageJson.name ?? "missing"}`)
	}
	if (packagedPackageJson.publisher !== "atnumridha") {
		throw new Error(`VSIX publisher mismatch: expected atnumridha, found ${packagedPackageJson.publisher ?? "missing"}`)
	}
	if (packagedPackageJson.version !== version) {
		throw new Error(`VSIX version mismatch: expected ${version}, found ${packagedPackageJson.version ?? "missing"}`)
	}
	if (!String(packagedPackageJson.displayName ?? "").includes("Codie")) {
		throw new Error("VSIX package displayName must use Codie branding")
	}

	const manifest = readZipEntry(zip, "extension.vsixmanifest").toString("utf8")
	for (const expected of [`Version="${version}"`, 'Id="codevibe"', 'Publisher="atnumridha"']) {
		if (!manifest.includes(expected)) {
			throw new Error(`VSIX manifest is missing ${expected}`)
		}
	}
}

function getCurrentGitHead() {
	const result = spawnSync("git", ["rev-parse", "HEAD"], {
		cwd: path.join(projectRoot, "..", ".."),
		encoding: "utf8",
	})
	if (result.status !== 0) {
		throw new Error(`Unable to resolve current git HEAD for release target: ${result.stderr || result.stdout}`)
	}
	return result.stdout.trim()
}

function resolveInputs(rawOptions) {
	const version = readPackageVersion()
	const repo = parseRepo(rawOptions.repo ?? "atnumridha/codevibe")
	const tag = rawOptions.tag ?? `v${version}`
	const vsixPath = path.resolve(process.cwd(), rawOptions.vsix ?? defaultVsixPath(version))
	const notes = rawOptions.notesFile
		? fs.readFileSync(path.resolve(process.cwd(), rawOptions.notesFile), "utf8")
		: rawOptions.notes
	const title = rawOptions.title ?? tag
	const targetCommitish = rawOptions.targetCommitish ?? getCurrentGitHead()
	const stat = fs.statSync(vsixPath)
	if (!stat.isFile() || stat.size <= 0) {
		throw new Error(`VSIX path must point at a non-empty file: ${vsixPath}`)
	}
	validateVsixArtifact(vsixPath, version)

	return {
		...rawOptions,
		repo,
		tag,
		vsixPath,
		assetName: path.basename(vsixPath),
		title,
		notes,
		targetCommitish,
		vsixBytes: stat.size,
		version,
	}
}

function getGithubToken() {
	return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ""
}

function redactToken(text, token) {
	return token ? String(text).split(token).join("[redacted]") : String(text)
}

async function githubRequest(url, options, token, requestOptions = {}) {
	const method = options.method ?? "GET"
	const response = await fetch(url, {
		...options,
		headers: {
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			Authorization: `Bearer ${token}`,
			...(options.headers ?? {}),
		},
	})
	const text = await response.text()
	const body = parseJsonBody(text)

	if (requestOptions.allow404 && response.status === 404) {
		return null
	}

	if (!response.ok) {
		const message = body?.message || text || response.statusText
		throw new Error(redactToken(`GitHub API ${method} ${url} failed ${response.status}: ${message}`, token))
	}

	return body
}

function parseJsonBody(text) {
	if (!text) {
		return undefined
	}
	try {
		return JSON.parse(text)
	} catch {
		return text
	}
}

async function findReleaseByTag(inputs, token) {
	const tag = encodeURIComponent(inputs.tag)
	const url = `https://api.github.com/repos/${inputs.repo.owner}/${inputs.repo.name}/releases/tags/${tag}`
	return githubRequest(url, {}, token, { allow404: true })
}

async function createRelease(inputs, token) {
	const url = `https://api.github.com/repos/${inputs.repo.owner}/${inputs.repo.name}/releases`
	return githubRequest(
		url,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				tag_name: inputs.tag,
				target_commitish: inputs.targetCommitish,
				name: inputs.title,
				body: inputs.notes,
				prerelease: inputs.prerelease,
				draft: inputs.draft,
			}),
		},
		token,
	)
}

async function updateRelease(inputs, release, token) {
	const url = `https://api.github.com/repos/${inputs.repo.owner}/${inputs.repo.name}/releases/${release.id}`
	return githubRequest(
		url,
		{
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: inputs.title,
				body: inputs.notes,
				prerelease: inputs.prerelease,
				draft: inputs.draft,
			}),
		},
		token,
	)
}

async function listAssets(release, token) {
	const assets = await githubRequest(release.assets_url, {}, token)
	return Array.isArray(assets) ? assets : []
}

async function deleteExistingAsset(inputs, release, token) {
	const assets = await listAssets(release, token)
	const existing = assets.find((asset) => asset?.name === inputs.assetName)
	if (!existing) {
		return false
	}
	const url = `https://api.github.com/repos/${inputs.repo.owner}/${inputs.repo.name}/releases/assets/${existing.id}`
	await githubRequest(url, { method: "DELETE" }, token)
	return true
}

async function uploadAsset(inputs, release, token) {
	const uploadBase = String(release.upload_url).replace(/\{.*$/, "")
	const uploadUrl = `${uploadBase}?name=${encodeURIComponent(inputs.assetName)}`
	const body = fs.readFileSync(inputs.vsixPath)
	return githubRequest(
		uploadUrl,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/octet-stream",
				"Content-Length": String(inputs.vsixBytes),
			},
			body,
		},
		token,
	)
}

function printDryRun(inputs) {
	console.log(
		JSON.stringify(
			{
				dryRun: true,
				repo: inputs.repo.slug,
				tag: inputs.tag,
				targetCommitish: inputs.targetCommitish,
				title: inputs.title,
				vsixPath: inputs.vsixPath,
				assetName: inputs.assetName,
				vsixBytes: inputs.vsixBytes,
				prerelease: inputs.prerelease,
				draft: inputs.draft,
				notesBytes: Buffer.byteLength(inputs.notes),
			},
			null,
			2,
		),
	)
}

function runReleasePreflight() {
	if (process.env.CODEVIBE_SKIP_RELEASE_PREFLIGHT === "true") {
		console.warn("Skipping Codie VSIX release preflight because CODEVIBE_SKIP_RELEASE_PREFLIGHT=true")
		return
	}
	const result = spawnSync(process.execPath, [path.join(__dirname, "package-github-vsix.mjs"), "--preflight"], {
		cwd: projectRoot,
		env: process.env,
		stdio: "inherit",
	})
	if (result.status !== 0) {
		throw new Error("Codie VSIX release preflight failed")
	}
}

async function main() {
	const rawOptions = parseArgs(process.argv.slice(2))
	const inputs = resolveInputs(rawOptions)
	if (inputs.dryRun) {
		printDryRun(inputs)
		return
	}
	runReleasePreflight()

	const token = getGithubToken()
	if (!token) {
		throw new Error("Set GITHUB_TOKEN or GH_TOKEN to create a GitHub Release locally, or use .github/workflows/ext-vscode-github-release.yml.")
	}

	let release = await findReleaseByTag(inputs, token)
	if (release) {
		release = await updateRelease(inputs, release, token)
		console.log(`Updated GitHub Release ${inputs.repo.slug}@${inputs.tag}`)
	} else {
		release = await createRelease(inputs, token)
		console.log(`Created GitHub Release ${inputs.repo.slug}@${inputs.tag}`)
	}

	const replacedAsset = await deleteExistingAsset(inputs, release, token)
	const asset = await uploadAsset(inputs, release, token)
	console.log(`${replacedAsset ? "Replaced" : "Uploaded"} ${inputs.assetName} (${inputs.vsixBytes} bytes)`)
	console.log(release.html_url || asset.browser_download_url)
}

main().catch((error) => {
	console.error(`release-github-vsix: ${error instanceof Error ? error.message : String(error)}`)
	process.exit(1)
})
