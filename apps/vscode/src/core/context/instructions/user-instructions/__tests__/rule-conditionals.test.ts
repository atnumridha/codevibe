import { expect } from "chai"
import { evaluateRuleConditionals, extractPathLikeStrings } from "../rule-conditionals"

describe("rule-conditionals", () => {
	describe("evaluateRuleConditionals(paths)", () => {
		it("treats missing paths as universal", () => {
			const res = evaluateRuleConditionals({}, { paths: [] })
			expect(res.passed).to.equal(true)
		})

		it("treats empty paths list in frontmatter as match-nothing (fail-closed)", () => {
			const res = evaluateRuleConditionals({ paths: [] }, { paths: ["src/index.ts"] })
			expect(res.passed).to.equal(false)
		})

		it("does not activate path-scoped rules with empty context", () => {
			const res = evaluateRuleConditionals({ paths: ["src/**"] }, { paths: [] })
			expect(res.passed).to.equal(false)
		})

		it("matches when any candidate path matches any glob", () => {
			const res = evaluateRuleConditionals({ paths: ["src/**", "apps/**"] }, { paths: ["src/index.ts"] })
			expect(res.passed).to.equal(true)
			expect(res.matchedConditions.paths).to.deep.equal(["src/**"])
		})

		it("ignores invalid paths type (fail-open)", () => {
			const res = evaluateRuleConditionals({ paths: "src/**" as any }, { paths: [] })
			expect(res.passed).to.equal(true)
		})
	})

	describe("evaluateRuleConditionals(cursor)", () => {
		it("treats globs as Cursor path-scoped auto-attach patterns", () => {
			const res = evaluateRuleConditionals(
				{ globs: ["src/**", "apps/**"] },
				{ paths: ["apps/web/src/App.tsx"] },
				{ dialect: "cursor" },
			)
			expect(res.passed).to.equal(true)
			expect(res.matchedConditions.globs).to.deep.equal(["apps/**"])
		})

		it("keeps globs as ordinary metadata outside the Cursor dialect", () => {
			const res = evaluateRuleConditionals({ globs: ["src/**"] }, { paths: [] })
			expect(res.passed).to.equal(true)
			expect(res.matchedConditions).to.deep.equal({})
		})

		it("lets alwaysApply true override non-matching globs", () => {
			const res = evaluateRuleConditionals(
				{ alwaysApply: true, globs: ["src/**"] },
				{ paths: ["docs/readme.md"] },
				{ dialect: "cursor" },
			)
			expect(res.passed).to.equal(true)
			expect(res.matchedConditions).to.deep.equal({})
		})

		it("does not auto-attach alwaysApply false rules without paths or globs", () => {
			const res = evaluateRuleConditionals(
				{ alwaysApply: false, description: "Use this when editing tests" },
				{ paths: ["src/index.ts"] },
				{ dialect: "cursor" },
			)
			expect(res.passed).to.equal(false)
		})

		it("allows alwaysApply false rules to auto-attach when globs match", () => {
			const res = evaluateRuleConditionals(
				{ alwaysApply: false, globs: ["src/**"] },
				{ paths: ["src/index.ts"] },
				{ dialect: "cursor" },
			)
			expect(res.passed).to.equal(true)
			expect(res.matchedConditions.globs).to.deep.equal(["src/**"])
		})
	})

	describe("extractPathLikeStrings", () => {
		it("extracts basic relative paths", () => {
			const res = extractPathLikeStrings("edit apps/web/src/App.tsx and packages/foo/src")
			expect(res).to.deep.equal(["apps/web/src/App.tsx", "packages/foo/src"])
		})

		it("extracts simple filenames with extensions (no slashes)", () => {
			const res = extractPathLikeStrings("Does foo.md exist? If not, create foo.md")
			expect(res).to.deep.equal(["foo.md"])
		})

		it("does not extract bare words without an extension", () => {
			const res = extractPathLikeStrings("Please create foo and then update bar")
			expect(res).to.deep.equal([])
		})

		it("ignores URLs", () => {
			const res = extractPathLikeStrings("see https://example.com/a/b and edit src/index.ts")
			expect(res).to.deep.equal(["src/index.ts"])
		})

		it("ignores fenced code blocks", () => {
			const text =
				"Please update src/index.ts\n\n```ts\n// example code\nconst p = 'apps/web/src/App.tsx'\n// also: packages/foo/src\n```\n\nThanks!"
			const res = extractPathLikeStrings(text)
			expect(res).to.deep.equal(["src/index.ts"])
		})

		it("does not extract URLs inside code fences", () => {
			const text = "```\nSee https://example.com/a/b and src/index.ts\n```\nBut edit docs/readme.md"
			const res = extractPathLikeStrings(text)
			expect(res).to.deep.equal(["docs/readme.md"])
		})

		it("extracts paths from stack traces (outside code fences)", () => {
			const text = "Error: boom\n    at foo (src/index.ts:12:3)\n    at bar (apps/web/src/App.tsx:5:1)"
			const res = extractPathLikeStrings(text)
			expect(res).to.deep.equal(["src/index.ts", "apps/web/src/App.tsx"])
		})
	})
})
