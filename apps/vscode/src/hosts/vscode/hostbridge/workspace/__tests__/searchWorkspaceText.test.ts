import { strict as assert } from "node:assert"
import * as path from "node:path"
import { afterEach, describe, it } from "mocha"
import sinon from "sinon"
import * as vscode from "vscode"
import * as ripgrepModule from "@services/ripgrep"
import { searchWorkspaceText } from "@/hosts/vscode/hostbridge/workspace/searchWorkspaceText"
import { SearchWorkspaceTextRequest } from "@/shared/proto/host/workspace"

describe("Hostbridge - Workspace - searchWorkspaceText", () => {
	const originalFindTextInFiles = (vscode.workspace as any).findTextInFiles
	const originalFindFiles = (vscode.workspace as any).findFiles
	const originalFs = (vscode.workspace as any).fs

	afterEach(() => {
		if (originalFindTextInFiles === undefined) {
			delete (vscode.workspace as any).findTextInFiles
		} else {
			;(vscode.workspace as any).findTextInFiles = originalFindTextInFiles
		}

		if (originalFindFiles === undefined) {
			delete (vscode.workspace as any).findFiles
		} else {
			;(vscode.workspace as any).findFiles = originalFindFiles
		}

		if (originalFs === undefined) {
			delete (vscode.workspace as any).fs
		} else {
			;(vscode.workspace as any).fs = originalFs
		}
		sinon.restore()
	})

	it("uses VS Code native findTextInFiles without enumerating and reading candidate files", async () => {
		const workspacePath = path.join(path.sep, "tmp", "codevibe-search-workspace")
		const sourcePath = path.join(workspacePath, "src", "main.ts")
		const uri = vscode.Uri.file(sourcePath)
		const findFiles = sinon.stub().throws(new Error("findFiles fallback should not run"))
		const readFile = sinon.stub().throws(new Error("readFile fallback should not run"))
		const findTextInFiles = sinon.stub().callsFake(async (_query, options, callback) => {
			callback({
				uri,
				text: "const before = false",
				lineNumber: 0,
			})
			callback({
				uri,
				ranges: {
					start: { line: 1, character: 6 },
					end: { line: 1, character: 12 },
				},
				preview: {
					text: "const needle = true",
					matches: {
						start: { line: 0, character: 6 },
						end: { line: 0, character: 12 },
					},
				},
			})
			callback({
				uri,
				text: "const after = true",
				lineNumber: 2,
			})
			return { limitHit: false }
		})

		;(vscode.workspace as any).findTextInFiles = findTextInFiles
		;(vscode.workspace as any).findFiles = findFiles
		;(vscode.workspace as any).fs = {
			stat: sinon.stub(),
			readFile,
		}

		const response = await searchWorkspaceText(
			SearchWorkspaceTextRequest.create({
				regex: "needle",
				filePattern: "*.ts",
				workspacePath,
				directoryPath: path.join(workspacePath, "src"),
				maxResults: 10,
			}),
		)

		assert.equal(findTextInFiles.callCount, 1)
		assert.equal(findTextInFiles.firstCall.args[0].pattern, "needle")
		assert.equal(findTextInFiles.firstCall.args[0].isRegExp, true)
			assert.equal(findTextInFiles.firstCall.args[1].maxResults, 10)
			assert.equal(findTextInFiles.firstCall.args[1].beforeContext, 1)
			assert.equal(findTextInFiles.firstCall.args[1].afterContext, 1)
			assert.equal(findTextInFiles.firstCall.args[1].previewOptions.charsPerLine, 800)
			assert.equal(findTextInFiles.firstCall.args[1].include.pattern, "**/*.ts")
		assert.equal(findFiles.callCount, 0)
		assert.equal(readFile.callCount, 0)
		assert.deepEqual(response.matches, [
			{
				path: "src/main.ts",
				line: 2,
				column: 6,
				match: "const needle = true",
				beforeContext: ["const before = false"],
				afterContext: ["const after = true"],
			},
		])
		assert.equal(response.limitHit, false)
	})

	it("falls back to ripgrep compact matches without reading candidate files", async () => {
		const workspacePath = path.join(path.sep, "tmp", "codevibe-search-workspace")
		const sourcePath = path.join(workspacePath, "src", "fallback.ts")
		const findFiles = sinon.stub().throws(new Error("findFiles fallback should not run"))
		const readFile = sinon.stub().throws(new Error("readFile fallback should not run"))
		const regexSearchFileMatches = sinon.stub(ripgrepModule, "regexSearchFileMatches").resolves([
			{
				filePath: sourcePath,
				line: 3,
				column: 13,
				match: "export const fallbackNeedle = true\n",
				beforeContext: ["const before = false\n"],
				afterContext: ["const after = true\n"],
			},
		])

		delete (vscode.workspace as any).findTextInFiles
		;(vscode.workspace as any).findFiles = findFiles
		;(vscode.workspace as any).fs = {
			stat: sinon.stub(),
			readFile,
		}

		const response = await searchWorkspaceText(
			SearchWorkspaceTextRequest.create({
				regex: "fallbackNeedle",
				filePattern: "*.ts",
				workspacePath,
				directoryPath: path.join(workspacePath, "src"),
				maxResults: 10,
				includeIgnored: true,
			}),
		)

		assert.equal(regexSearchFileMatches.callCount, 1)
		assert.equal(regexSearchFileMatches.firstCall.args[0], workspacePath)
		assert.equal(regexSearchFileMatches.firstCall.args[1], path.join(workspacePath, "src"))
		assert.equal(regexSearchFileMatches.firstCall.args[2], "fallbackNeedle")
		assert.equal(regexSearchFileMatches.firstCall.args[3], "*.ts")
		assert.deepEqual(regexSearchFileMatches.firstCall.args[5], { includeIgnored: true })
		assert.equal(findFiles.callCount, 0)
		assert.equal(readFile.callCount, 0)
		assert.deepEqual(response.matches, [
			{
				path: "src/fallback.ts",
				line: 3,
				column: 13,
				match: "export const fallbackNeedle = true",
				beforeContext: ["const before = false"],
				afterContext: ["const after = true"],
			},
		])
		assert.equal(response.limitHit, false)
	})
})
