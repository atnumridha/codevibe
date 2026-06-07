import fs from "fs/promises"
import { after, beforeEach, describe, it } from "mocha"
import os from "os"
import path from "path"
import { ClineIgnoreController } from "./ClineIgnoreController"
import "should"

describe("ClineIgnoreController", () => {
	let tempDir: string
	let controller: ClineIgnoreController

	beforeEach(async () => {
		// Create a temp directory for testing
		tempDir = path.join(os.tmpdir(), `llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(tempDir)

		// Create default .clineignore file
		await fs.writeFile(
			path.join(tempDir, ".clineignore"),
			[".env", "*.secret", "private/", "# This is a comment", "", "temp.*", "file-with-space-at-end.* ", "**/.git/**"].join(
				"\n",
			),
		)

		controller = new ClineIgnoreController(tempDir)
		await controller.initialize()
	})

	after(async () => {
		// Clean up temp directory
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	describe("Default Patterns", () => {
		// it("should block access to common ignored files", async () => {
		// 	const results = [
		// 		controller.validateAccess(".env"),
		// 		controller.validateAccess(".git/config"),
		// 		controller.validateAccess("node_modules/package.json"),
		// 	]
		// 	results.forEach((result) => result.should.be.false())
		// })

		it("should allow access to regular files", async () => {
			const results = [
				controller.validateAccess("src/index.ts"),
				controller.validateAccess("README.md"),
				controller.validateAccess("package.json"),
			]
			results.forEach((result) => result.should.be.true())
		})

		it("should block access to .clineignore file", async () => {
			const result = controller.validateAccess(".clineignore")
			result.should.be.false()
		})
	})

	describe("Custom Patterns", () => {
		it("should block access to custom ignored patterns", async () => {
			const results = [
				controller.validateAccess("config.secret"),
				controller.validateAccess("private/data.txt"),
				controller.validateAccess("temp.json"),
				controller.validateAccess("nested/deep/file.secret"),
				controller.validateAccess("private/nested/deep/file.txt"),
			]
			results.forEach((result) => result.should.be.false())
		})

		it("should allow access to non-ignored files", async () => {
			const results = [
				controller.validateAccess("public/data.txt"),
				controller.validateAccess("config.json"),
				controller.validateAccess("src/temp/file.ts"),
				controller.validateAccess("nested/deep/file.txt"),
				controller.validateAccess("not-private/data.txt"),
			]
			results.forEach((result) => result.should.be.true())
		})

		it("should block direct access using root .cursorignore patterns", async () => {
			await fs.rm(path.join(tempDir, ".clineignore"), { force: true })
			await fs.writeFile(path.join(tempDir, ".cursorignore"), ["cursor-private/", "*.cursor-secret"].join("\n"))

			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			controller.validateAccess("cursor-private/data.txt").should.be.false()
			controller.validateAccess("nested/value.cursor-secret").should.be.false()
			controller.validateAccess(".cursorignore").should.be.false()
			controller.validateAccess("src/index.ts").should.be.true()
		})

		it("should block direct access using root .cursorindexingignore patterns", async () => {
			await fs.rm(path.join(tempDir, ".clineignore"), { force: true })
			await fs.writeFile(
				path.join(tempDir, ".cursorindexingignore"),
				["generated/*.tmp", "*.snapshot", "!generated/keep.tmp"].join("\n"),
			)

			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			controller.validateAccess("generated/build.tmp").should.be.false()
			controller.validateAccess("ui/home.snapshot").should.be.false()
			controller.validateAccess("generated/keep.tmp").should.be.true()
			controller.validateAccess(".cursorindexingignore").should.be.false()
		})

		it("should validate file-reading commands against Cursor ignore files", async () => {
			await fs.rm(path.join(tempDir, ".clineignore"), { force: true })
			await fs.writeFile(path.join(tempDir, ".cursorignore"), "secrets/\n")

			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			controller.validateCommand("cat secrets/token.txt").should.equal("secrets/token.txt")
			;(controller.validateCommand("cat public/readme.md") === undefined).should.be.true()
		})

		it("should handle pattern edge cases", async () => {
			await fs.writeFile(
				path.join(tempDir, ".clineignore"),
				["*.secret", "private/", "*.tmp", "data-*.json", "temp/*"].join("\n"),
			)

			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			const results = [
				controller.validateAccess("data-123.json"), // Should be false (wildcard)
				controller.validateAccess("data.json"), // Should be true (doesn't match pattern)
				controller.validateAccess("script.tmp"), // Should be false (extension match)
			]

			results[0].should.be.false() // data-123.json
			results[1].should.be.true() // data.json
			results[2].should.be.false() // script.tmp
		})

		// ToDo: handle negation patterns successfully

		// it("should handle negation patterns", async () => {
		// 	await fs.writeFile(
		// 		path.join(tempDir, ".clineignore"),
		// 		[
		// 			"temp/*", // Ignore everything in temp
		// 			"!temp/allowed/*", // But allow files in temp/allowed
		// 			"docs/**/*.md", // Ignore all markdown files in docs
		// 			"!docs/README.md", // Except README.md
		// 			"!docs/CONTRIBUTING.md", // And CONTRIBUTING.md
		// 			"assets/", // Ignore all assets
		// 			"!assets/public/", // Except public assets
		// 			"!assets/public/*.png", // Specifically allow PNGs in public assets
		// 		].join("\n"),
		// 	)

		// 	controller = new ClineIgnoreController(tempDir)

		// 	const results = [
		// 		// Basic negation
		// 		controller.validateAccess("temp/file.txt"), // Should be false (in temp/)
		// 		controller.validateAccess("temp/allowed/file.txt"), // Should be true (negated)
		// 		controller.validateAccess("temp/allowed/nested/file.txt"), // Should be true (negated with nested)

		// 		// Multiple negations in same path
		// 		controller.validateAccess("docs/guide.md"), // Should be false (matches docs/**/*.md)
		// 		controller.validateAccess("docs/README.md"), // Should be true (negated)
		// 		controller.validateAccess("docs/CONTRIBUTING.md"), // Should be true (negated)
		// 		controller.validateAccess("docs/api/guide.md"), // Should be false (nested markdown)

		// 		// Nested negations
		// 		controller.validateAccess("assets/logo.png"), // Should be false (in assets/)
		// 		controller.validateAccess("assets/public/logo.png"), // Should be true (negated and matches *.png)
		// 		controller.validateAccess("assets/public/data.json"), // Should be true (in negated public/)
		// 	]

		// 	results[0].should.be.false() // temp/file.txt
		// 	results[1].should.be.true() // temp/allowed/file.txt
		// 	results[2].should.be.true() // temp/allowed/nested/file.txt
		// 	results[3].should.be.false() // docs/guide.md
		// 	results[4].should.be.true() // docs/README.md
		// 	results[5].should.be.true() // docs/CONTRIBUTING.md
		// 	results[6].should.be.false() // docs/api/guide.md
		// 	results[7].should.be.false() // assets/logo.png
		// 	results[8].should.be.true() // assets/public/logo.png
		// 	results[9].should.be.true() // assets/public/data.json
		// })

		it("should handle comments in .clineignore", async () => {
			// Create a new .clineignore with comments
			await fs.writeFile(
				path.join(tempDir, ".clineignore"),
				["# Comment line", "*.secret", "private/", "temp.*"].join("\n"),
			)

			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			const result = controller.validateAccess("test.secret")
			result.should.be.false()
		})
	})

	describe("Path Handling", () => {
		it("should handle absolute paths and match ignore patterns", async () => {
			// Test absolute path that should be allowed
			const allowedPath = path.join(tempDir, "src/file.ts")
			const allowedResult = controller.validateAccess(allowedPath)
			allowedResult.should.be.true()

			// Test absolute path that matches an ignore pattern (*.secret)
			const ignoredPath = path.join(tempDir, "config.secret")
			const ignoredResult = controller.validateAccess(ignoredPath)
			ignoredResult.should.be.false()

			// Test absolute path in ignored directory (private/)
			const ignoredDirPath = path.join(tempDir, "private/data.txt")
			const ignoredDirResult = controller.validateAccess(ignoredDirPath)
			ignoredDirResult.should.be.false()
		})

		it("should handle relative paths and match ignore patterns", async () => {
			// Test relative path that should be allowed
			const allowedResult = controller.validateAccess("./src/file.ts")
			allowedResult.should.be.true()

			// Test relative path that matches an ignore pattern (*.secret)
			const ignoredResult = controller.validateAccess("./config.secret")
			ignoredResult.should.be.false()

			// Test relative path in ignored directory (private/)
			const ignoredDirResult = controller.validateAccess("./private/data.txt")
			ignoredDirResult.should.be.false()
		})

		it("should normalize paths with backslashes", async () => {
			const result = controller.validateAccess("src\\file.ts")
			result.should.be.true()
		})
	})

	describe("Batch Filtering", () => {
		it("should filter an array of paths", async () => {
			const paths = ["src/index.ts", ".env", "lib/utils.ts", ".git/config", "dist/bundle.js"]

			const filtered = controller.filterPaths(paths)
			filtered.should.deepEqual(["src/index.ts", "lib/utils.ts", "dist/bundle.js"])
		})
	})

	describe("Error Handling", () => {
		it("should handle invalid paths", async () => {
			// Test with an invalid path containing null byte
			const result = controller.validateAccess("\0invalid")
			result.should.be.true()
		})

		it("should handle missing .clineignore gracefully", async () => {
			// Create a new controller in a directory without .clineignore
			const emptyDir = path.join(os.tmpdir(), `llm-test-empty-${Date.now()}`)
			await fs.mkdir(emptyDir)

			try {
				const controller = new ClineIgnoreController(emptyDir)
				await controller.initialize()
				const result = controller.validateAccess("file.txt")
				result.should.be.true()
			} finally {
				await fs.rm(emptyDir, { recursive: true, force: true })
			}
		})

		it("should handle empty .clineignore", async () => {
			await fs.writeFile(path.join(tempDir, ".clineignore"), "")

			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			const result = controller.validateAccess("regular-file.txt")
			result.should.be.true()
		})
	})

	describe("Include Directive", () => {
		it("should load patterns from an included file", async () => {
			// Create a .gitignore file with patterns "*.log" and "debug/"
			await fs.writeFile(path.join(tempDir, ".gitignore"), ["*.log", "debug/"].join("\n"))

			// Create a .clineignore file that includes .gitignore and adds an extra pattern "secret.txt"
			await fs.writeFile(path.join(tempDir, ".clineignore"), ["!include .gitignore", "secret.txt"].join("\n"))

			// Initialize the controller to load the updated .clineignore
			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			// "server.log" should be ignored due to the "*.log" pattern from .gitignore
			controller.validateAccess("server.log").should.be.false()
			// "debug/app.js" should be ignored due to the "debug/" pattern from .gitignore
			controller.validateAccess("debug/app.js").should.be.false()
			// "secret.txt" should be ignored as specified directly in .clineignore
			controller.validateAccess("secret.txt").should.be.false()
			// Other files should be allowed
			controller.validateAccess("app.js").should.be.true()
		})

		it("should handle non-existent included file gracefully", async () => {
			// Create a .clineignore file that includes a non-existent file
			await fs.writeFile(path.join(tempDir, ".clineignore"), ["!include missing-file.txt"].join("\n"))

			// Initialize the controller
			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			// Validate access to a regular file; it should be allowed because the missing include should not break everything
			controller.validateAccess("regular-file.txt").should.be.true()
		})

		it("should handle non-existent included file gracefully alongside a valid pattern", async () => {
			// Test with an include directive for a non-existent file alongside a valid pattern ("*.tmp")
			await fs.writeFile(path.join(tempDir, ".clineignore"), ["!include non-existent.txt", "*.tmp"].join("\n"))

			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			// "file.tmp" should be ignored because of the "*.tmp" pattern
			controller.validateAccess("file.tmp").should.be.false()
			// Files that do not match "*.tmp" should be allowed
			controller.validateAccess("file.log").should.be.true()
		})

		it("should ignore included files outside the workspace", async () => {
			const outsideIgnoreName = `outside-ignore-${Date.now()}-${Math.random().toString(36).slice(2)}`
			const outsideIgnorePath = path.join(path.dirname(tempDir), outsideIgnoreName)

			try {
				await fs.writeFile(outsideIgnorePath, "outside-only.secret\n")
				await fs.writeFile(
					path.join(tempDir, ".clineignore"),
					[`!include ../${outsideIgnoreName}`, "workspace-only.secret"].join("\n"),
				)

				controller = new ClineIgnoreController(tempDir)
				await controller.initialize()

				controller.validateAccess("outside-only.secret").should.be.true()
				controller.validateAccess("workspace-only.secret").should.be.false()
			} finally {
				await fs.rm(outsideIgnorePath, { force: true })
			}
		})

		it("should ignore absolute include paths", async () => {
			const outsideIgnorePath = path.join(
				path.dirname(tempDir),
				`absolute-ignore-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			)

			try {
				await fs.writeFile(outsideIgnorePath, "absolute-only.secret\n")
				await fs.writeFile(
					path.join(tempDir, ".clineignore"),
					[`!include ${outsideIgnorePath}`, "workspace-only.secret"].join("\n"),
				)

				controller = new ClineIgnoreController(tempDir)
				await controller.initialize()

				controller.validateAccess("absolute-only.secret").should.be.true()
				controller.validateAccess("workspace-only.secret").should.be.false()
			} finally {
				await fs.rm(outsideIgnorePath, { force: true })
			}
		})

		it("should ignore include symlinks that resolve outside the workspace", async function () {
			const outsideIgnorePath = path.join(
				path.dirname(tempDir),
				`symlink-ignore-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			)
			const symlinkPath = path.join(tempDir, "linked-ignore")

			try {
				await fs.writeFile(outsideIgnorePath, "symlink-only.secret\n")
				await fs.symlink(outsideIgnorePath, symlinkPath)
				await fs.writeFile(
					path.join(tempDir, ".clineignore"),
					["!include linked-ignore", "workspace-only.secret"].join("\n"),
				)

				controller = new ClineIgnoreController(tempDir)
				await controller.initialize()

				controller.validateAccess("symlink-only.secret").should.be.true()
				controller.validateAccess("workspace-only.secret").should.be.false()
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "EPERM") {
					this.skip()
					return
				}
				throw error
			} finally {
				await fs.rm(symlinkPath, { force: true })
				await fs.rm(outsideIgnorePath, { force: true })
			}
		})
	})
})
