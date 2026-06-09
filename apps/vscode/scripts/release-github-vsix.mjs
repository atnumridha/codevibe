#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

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

function resolveInputs(rawOptions) {
	const version = readPackageVersion()
	const repo = parseRepo(rawOptions.repo ?? "atnumridha/codevibe")
	const tag = rawOptions.tag ?? `v${version}`
	const vsixPath = path.resolve(process.cwd(), rawOptions.vsix ?? defaultVsixPath(version))
	const notes = rawOptions.notesFile
		? fs.readFileSync(path.resolve(process.cwd(), rawOptions.notesFile), "utf8")
		: rawOptions.notes
	const title = rawOptions.title ?? tag
	const stat = fs.statSync(vsixPath)
	if (!stat.isFile() || stat.size <= 0) {
		throw new Error(`VSIX path must point at a non-empty file: ${vsixPath}`)
	}

	return {
		...rawOptions,
		repo,
		tag,
		vsixPath,
		assetName: path.basename(vsixPath),
		title,
		notes,
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

async function main() {
	const rawOptions = parseArgs(process.argv.slice(2))
	const inputs = resolveInputs(rawOptions)
	if (inputs.dryRun) {
		printDryRun(inputs)
		return
	}

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
