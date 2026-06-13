/**
 * Web Search Executor
 *
 * Built-in implementation for privacy-friendly HTML web search.
 */

import type { AgentToolContext } from "@cline/shared";
import type { WebSearchExecutor } from "../types";
import { assertUrlAllowedByCursorSandboxPolicy } from "./access-ignore";

export interface WebSearchExecutorOptions {
	timeoutMs?: number;
	maxResponseBytes?: number;
	userAgent?: string;
	searchEndpoint?: string;
}

function decodeHtmlEntities(value: string): string {
	return value
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
		.replace(/\s+/g, " ")
		.trim();
}

function stripHtml(value: string): string {
	return decodeHtmlEntities(value.replace(/<[^>]+>/g, " "));
}

function resultBlockForAnchor(html: string, anchorIndex: number): string {
	const nextResultMatch = html
		.slice(anchorIndex + 1)
		.search(/<div[^>]+class="[^"]*\bresult\b[^"]*"/i);
	const nextResultIndex =
		nextResultMatch >= 0 ? anchorIndex + 1 + nextResultMatch : -1;
	return nextResultIndex >= 0
		? html.slice(anchorIndex, nextResultIndex)
		: html.slice(anchorIndex);
}

function extractSearchResults(
	html: string,
	limit: number,
): Array<{ title: string; url: string; snippet?: string }> {
	const results: Array<{ title: string; url: string; snippet?: string }> = [];
	const linkPattern =
		/<a[^>]+class="[^"]*\bresult__a\b[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
	for (const linkMatch of html.matchAll(linkPattern)) {
		const item = resultBlockForAnchor(html, linkMatch.index ?? 0);
		const rawUrl = decodeHtmlEntities(linkMatch[1]);
		const title = stripHtml(linkMatch[2]);
		const snippetMatch =
			item.match(
				/<a[^>]+class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
			) ??
			item.match(
				/<div[^>]+class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
			);
		const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : undefined;
		const url = rawUrl.startsWith("//duckduckgo.com/l/?")
			? (new URL(`https:${rawUrl}`).searchParams.get("uddg") ?? rawUrl)
			: rawUrl;
		results.push({ title, url, ...(snippet ? { snippet } : {}) });
		if (results.length >= limit) {
			break;
		}
	}
	return results;
}

async function readResponseText(
	response: Response,
	maxResponseBytes: number,
): Promise<string> {
	const reader = response.body?.getReader();
	if (!reader) {
		return response.text();
	}
	const chunks: Uint8Array[] = [];
	let totalSize = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		totalSize += value.length;
		if (totalSize > maxResponseBytes) {
			await reader.cancel();
			throw new Error(`Search response too large: exceeded ${maxResponseBytes} bytes`);
		}
		chunks.push(value);
	}
	const buffer = new Uint8Array(totalSize);
	let offset = 0;
	for (const chunk of chunks) {
		buffer.set(chunk, offset);
		offset += chunk.length;
	}
	return new TextDecoder("utf-8").decode(buffer);
}

export function createWebSearchExecutor(
	options: WebSearchExecutorOptions = {},
): WebSearchExecutor {
	const {
		timeoutMs = 15000,
		maxResponseBytes = 1_000_000,
		userAgent = "Mozilla/5.0 (compatible; CodieBot/1.0)",
		searchEndpoint = "https://duckduckgo.com/html/",
	} = options;

	return async (
		query: string,
		limit: number,
		context: AgentToolContext,
	): Promise<string> => {
		const searchUrl = new URL(searchEndpoint);
		searchUrl.searchParams.set("q", query);
		assertUrlAllowedByCursorSandboxPolicy(context, searchUrl);

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		let contextAbortHandler: (() => void) | undefined;
		if (context.signal) {
			contextAbortHandler = () => controller.abort();
			context.signal.addEventListener("abort", contextAbortHandler);
		}

		try {
			const response = await fetch(searchUrl, {
				headers: {
					"User-Agent": userAgent,
					Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.7",
					"Accept-Language": "en-US,en;q=0.9",
				},
				signal: controller.signal,
			});
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}
			const html = await readResponseText(response, maxResponseBytes);
			const results = extractSearchResults(html, limit);
			if (results.length === 0) {
				return `Search query: ${query}\nNo results found.`;
			}
			return [
				`Search query: ${query}`,
				"Results:",
				...results.flatMap((result, index) => [
					`${index + 1}. ${result.title}`,
					`URL: ${result.url}`,
					...(result.snippet ? [`Snippet: ${result.snippet}`] : []),
					"",
				]),
			].join("\n").trim();
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				throw new Error(`Search timed out after ${timeoutMs}ms`);
			}
			throw error;
		} finally {
			clearTimeout(timeout);
			if (context.signal && contextAbortHandler) {
				context.signal.removeEventListener("abort", contextAbortHandler);
			}
		}
	};
}
