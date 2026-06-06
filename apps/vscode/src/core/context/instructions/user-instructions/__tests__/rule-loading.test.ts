import { expect } from "chai"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { getLocalCursorRules } from "../external-rules"
import { getRuleFilesTotalContentWithMetadata } from "../rule-helpers"

describe("rule loading with paths frontmatter", () => {
	it("filters rules by evaluationContext.paths", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cline-rules-test-"))
		try {
			const rulesDir = path.join(tmp, ".clinerules")
			await fs.mkdir(rulesDir, { recursive: true })
			await fs.writeFile(path.join(rulesDir, "universal.md"), "Always on")
			await fs.writeFile(path.join(rulesDir, "scoped.md"), `---\npaths:\n  - "src/**"\n---\n\nOnly for src`)

			const files = ["universal.md", "scoped.md"]
			const toggles: Record<string, boolean> = {
				[path.join(rulesDir, "universal.md")]: true,
				[path.join(rulesDir, "scoped.md")]: true,
			}

			const res1 = await getRuleFilesTotalContentWithMetadata(files, rulesDir, toggles, {
				evaluationContext: { paths: ["src/index.ts"] },
			})
			expect(res1.content).to.contain("universal.md")
			expect(res1.content).to.contain("scoped.md")
			expect(res1.content).to.not.contain("paths:")
			expect(res1.activatedConditionalRules.map((r) => r.name)).to.include("global:scoped.md")

			const res2 = await getRuleFilesTotalContentWithMetadata(files, rulesDir, toggles, {
				evaluationContext: { paths: ["docs/readme.md"] },
			})
			expect(res2.content).to.contain("universal.md")
			expect(res2.content).to.not.contain("scoped.md")
		} finally {
			await fs.rm(tmp, { recursive: true, force: true })
		}
	})

	it("treats invalid YAML frontmatter as fail-open and preserves the raw frontmatter for the LLM", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cline-rules-test-"))
		try {
			const rulesDir = path.join(tmp, ".clinerules")
			await fs.mkdir(rulesDir, { recursive: true })
			// Intentionally invalid YAML (unquoted '*' is a YAML alias indicator)
			await fs.writeFile(
				path.join(rulesDir, "invalid.md"),
				`---\npaths: *\n---\n\nInvalid YAML, but should still be included`,
			)

			const files = ["invalid.md"]
			const toggles: Record<string, boolean> = {
				[path.join(rulesDir, "invalid.md")]: true,
			}

			const res = await getRuleFilesTotalContentWithMetadata(files, rulesDir, toggles, {
				evaluationContext: { paths: ["src/index.ts"] },
			})

			// Fail-open: included even though frontmatter cannot be parsed.
			expect(res.content).to.contain("invalid.md")
			// Preserve raw frontmatter fence/content for the LLM.
			expect(res.content).to.contain("---")
			expect(res.content).to.contain("paths:")
		} finally {
			await fs.rm(tmp, { recursive: true, force: true })
		}
	})

	it("treats paths: [] as match-nothing (fail-closed)", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cline-rules-test-"))
		try {
			const rulesDir = path.join(tmp, ".clinerules")
			await fs.mkdir(rulesDir, { recursive: true })
			await fs.writeFile(path.join(rulesDir, "scoped-empty.md"), `---\npaths: []\n---\n\nShould never activate`)

			const files = ["scoped-empty.md"]
			const toggles: Record<string, boolean> = {
				[path.join(rulesDir, "scoped-empty.md")]: true,
			}

			const res = await getRuleFilesTotalContentWithMetadata(files, rulesDir, toggles, {
				evaluationContext: { paths: ["src/index.ts"] },
			})

			expect(res.content).to.not.contain("scoped-empty.md")
		} finally {
			await fs.rm(tmp, { recursive: true, force: true })
		}
	})

	it("keeps activatedConditionalRules order stable (matches input file order)", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cline-rules-test-"))
		try {
			const rulesDir = path.join(tmp, ".clinerules")
			await fs.mkdir(rulesDir, { recursive: true })
			await fs.writeFile(path.join(rulesDir, "a.md"), `---\npaths:\n  - "src/**"\n---\n\nA`)
			await fs.writeFile(path.join(rulesDir, "b.md"), `---\npaths:\n  - "src/**"\n---\n\nB`)
			await fs.writeFile(path.join(rulesDir, "c.md"), `---\npaths:\n  - "src/**"\n---\n\nC`)

			const files = ["a.md", "b.md", "c.md"]
			const toggles: Record<string, boolean> = {
				[path.join(rulesDir, "a.md")]: true,
				[path.join(rulesDir, "b.md")]: true,
				[path.join(rulesDir, "c.md")]: true,
			}

			const res = await getRuleFilesTotalContentWithMetadata(files, rulesDir, toggles, {
				evaluationContext: { paths: ["src/index.ts"] },
			})

			expect(res.activatedConditionalRules.map((r) => r.name)).to.deep.equal(files.map((f) => `global:${f}`))
		} finally {
			await fs.rm(tmp, { recursive: true, force: true })
		}
	})

	it("loads .cursorrules and .cursor/rules/*.mdc with Cursor globs", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cursor-rules-test-"))
		try {
			const cursorRulesDir = path.join(tmp, ".cursor", "rules")
			await fs.mkdir(cursorRulesDir, { recursive: true })
			await fs.writeFile(path.join(tmp, ".cursorrules"), `---\nglobs:\n  - "src/**"\n---\n\nLegacy Cursor rule`)
			await fs.writeFile(
				path.join(cursorRulesDir, "frontend.mdc"),
				`---\nalwaysApply: false\nglobs:\n  - "web/**"\n---\n\nFrontend Cursor rule`,
			)
			await fs.writeFile(
				path.join(cursorRulesDir, "manual.mdc"),
				`---\nalwaysApply: false\ndescription: "Use manually for release tasks"\n---\n\nManual Cursor rule`,
			)

			const toggles: Record<string, boolean> = {
				[path.join(tmp, ".cursorrules")]: true,
				[path.join(cursorRulesDir, "frontend.mdc")]: true,
				[path.join(cursorRulesDir, "manual.mdc")]: true,
			}

			const srcResult = await getLocalCursorRules(tmp, toggles, {
				evaluationContext: { paths: ["src/index.ts"] },
			})
			expect(srcResult.fileInstructions).to.contain("Legacy Cursor rule")
			expect(srcResult.directoryInstructions).to.equal(undefined)
			expect(srcResult.activatedConditionalRules.map((rule) => rule.name)).to.deep.equal(["workspace:.cursorrules"])
			expect(srcResult.activatedConditionalRules[0].matchedConditions.globs).to.deep.equal(["src/**"])

			const webResult = await getLocalCursorRules(tmp, toggles, {
				evaluationContext: { paths: ["web/App.tsx"] },
			})
			expect(webResult.fileInstructions).to.equal(undefined)
			expect(webResult.directoryInstructions).to.contain("Frontend Cursor rule")
			expect(webResult.directoryInstructions).to.not.contain("Manual Cursor rule")
			expect(webResult.activatedConditionalRules.map((rule) => rule.name)).to.deep.equal([
				"workspace:.cursor/rules/frontend.mdc",
			])
			expect(webResult.activatedConditionalRules[0].matchedConditions.globs).to.deep.equal(["web/**"])
		} finally {
			await fs.rm(tmp, { recursive: true, force: true })
		}
	})
})
