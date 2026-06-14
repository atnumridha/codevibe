import { Anthropic } from "@anthropic-ai/sdk"
import { createReadStream } from "fs"
import fs from "fs/promises"
import { isBinaryFile } from "isbinaryfile"
import * as path from "path"
import * as readline from "readline"
import { extractImageContent } from "./extract-images"
import { callTextExtractionFunctions } from "./extract-text"

const RICH_TEXT_EXTENSIONS = new Set([".pdf", ".docx", ".ipynb", ".xlsx"])

export type FileLineWindow = {
	start: number
	end: number
	totalLines: number
	lines: string[]
}

export type FileContentResult = {
	text: string
	imageBlock?: Anthropic.ImageBlockParam
	lineWindow?: FileLineWindow
}

export async function extractPlainTextLineWindow(
	absolutePath: string,
	options: { startLine?: number; endLine?: number; maxLines: number },
): Promise<FileContentResult | undefined> {
	try {
		await fs.access(absolutePath)
	} catch (_error) {
		throw new Error(`File not found: ${absolutePath}`)
	}

	const fileExtension = path.extname(absolutePath).toLowerCase()
	if (RICH_TEXT_EXTENSIONS.has(fileExtension)) {
		return undefined
	}

	if (await isBinaryFile(absolutePath).catch(() => false)) {
		return undefined
	}

	const fileStat = await fs.stat(absolutePath)
	if (fileStat.size > 100 * 1000 * 1024) {
		throw new Error(`File is too large to read into context.`)
	}

	const requestedStart = Math.max(1, options.startLine ?? 1)
	const requestedEnd =
		options.endLine !== undefined ? Math.max(1, options.endLine) : requestedStart + options.maxLines - 1
	const shouldSwapBounds = options.endLine !== undefined && requestedEnd < requestedStart
	const start = shouldSwapBounds ? requestedEnd : requestedStart
	const end = shouldSwapBounds ? requestedStart : requestedEnd
	const lines: string[] = []
	let totalLines = 0

	const stream = createReadStream(absolutePath, { encoding: "utf8" })
	const reader = readline.createInterface({ input: stream, crlfDelay: Infinity })
	try {
		for await (const line of reader) {
			totalLines++
			if (totalLines >= start && totalLines <= end) {
				lines.push(line)
			}
		}
	} catch (error) {
		throw new Error(`Error reading file: ${error instanceof Error ? error.message : String(error)}`)
	}

	return {
		text: lines.join("\n"),
		lineWindow: {
			start,
			end: lines.length > 0 ? start + lines.length - 1 : Math.min(start, totalLines),
			totalLines,
			lines,
		},
	}
}

/**
 * Extract content from a file, handling both text and images
 * Extra logic for handling images based on whether the model supports images
 */
export async function extractFileContent(absolutePath: string, modelSupportsImages: boolean): Promise<FileContentResult> {
	// Check if file exists first
	try {
		await fs.access(absolutePath)
	} catch (_error) {
		throw new Error(`File not found: ${absolutePath}`)
	}

	const fileExtension = path.extname(absolutePath).toLowerCase()
	const imageExtensions = [".png", ".jpg", ".jpeg", ".webp"]
	const isImage = imageExtensions.includes(fileExtension)

	if (isImage && modelSupportsImages) {
		const imageResult = await extractImageContent(absolutePath)

		if (imageResult.success) {
			return {
				text: "Successfully read image",
				imageBlock: imageResult.imageBlock,
			}
		} else {
			throw new Error(imageResult.error)
		}
	} else if (isImage && !modelSupportsImages) {
		throw new Error(`Current model does not support image input`)
	} else {
		// Handle text files using existing extraction functions
		try {
			const textContent = await callTextExtractionFunctions(absolutePath)
			return {
				text: textContent,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			throw new Error(`Error reading file: ${errorMessage}`)
		}
	}
}
