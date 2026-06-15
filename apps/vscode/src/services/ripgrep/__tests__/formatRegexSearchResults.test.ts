import assert from "node:assert/strict"
import * as path from "node:path"
import { describe, it } from "mocha"
import { formatRegexSearchResults, type RegexSearchResult } from "../index"

describe("formatRegexSearchResults", () => {
	const cwd = path.join(path.sep, "repo")

	it("merges adjacent matches into compact line-numbered snippets", () => {
		const filePath = path.join(cwd, "src", "main.ts")
		const results: RegexSearchResult[] = [
			{
				filePath,
				line: 10,
				column: 6,
				match: "const needle = true\n",
				beforeContext: ["function run() {\n"],
				afterContext: ["const shared = 1\n"],
			},
			{
				filePath,
				line: 12,
				column: 9,
				match: "return needle\n",
				beforeContext: ["const shared = 1\n"],
				afterContext: ["}\n"],
			},
		]

		const output = formatRegexSearchResults(results, cwd)

		assert.equal((output.match(/src\/main\.ts/g) ?? []).length, 1)
		assert.match(output, /│---- lines 9-13/)
		assert.match(output, /│> 10 \| const needle = true/)
		assert.match(output, /│> 12 \| return needle/)
	})

	it("caps large search payloads instead of returning whole matching lines", () => {
		const hugeLine = "x".repeat(5_000)
		const results: RegexSearchResult[] = Array.from({ length: 300 }, (_, index) => ({
			filePath: path.join(cwd, "src", `file-${index}.ts`),
			line: 1,
			column: 0,
			match: `needle ${hugeLine}\n`,
			beforeContext: [],
			afterContext: [],
		}))

		const output = formatRegexSearchResults(results, cwd)

		assert.ok(Buffer.byteLength(output, "utf8") < 83 * 1024)
		assert.ok(!output.includes(hugeLine))
		assert.match(output, /\[line truncated\]/)
		assert.match(output, /Results truncated/)
	})
})
