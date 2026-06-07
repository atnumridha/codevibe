import { expect } from "chai"
import { describe, it } from "mocha"
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { toolSpecFunctionDeclarations, toolSpecFunctionDefinition, toolSpecInputSchema } from "../spec"
import { browser_action_variants } from "../tools/browser_action"
import { browser_screenshot_variants } from "../tools/browser_screenshot"
import { browser_snapshot_variants } from "../tools/browser_snapshot"
import { plan_mode_respond_variants } from "../tools/plan_mode_respond"
import type { SystemPromptContext } from "../types"

const mockContext: SystemPromptContext = {
	cwd: "/test/project",
	ide: "TestIde",
	supportsBrowserUse: true,
	clineWebToolsEnabled: true,
	subagentsEnabled: true,
	providerInfo: { providerId: "test", model: { id: "test-model", info: { supportsPromptCache: false } }, mode: "act" },
	enableNativeToolCalls: false,
	isTesting: true,
}

const makeTool = (overrides?: Partial<ClineToolSpec>): ClineToolSpec => ({
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.FILE_READ,
	name: "read_file",
	description: "Read a file",
	parameters: [
		{
			name: "path",
			required: true,
			instruction: "The path of the file to read relative to {{CWD}}",
		},
		{
			name: "optional_param",
			required: false,
			instruction: "An optional parameter",
		},
	],
	...overrides,
})

describe("toolSpecFunctionDeclarations (Gemini)", () => {
	it("includes parameter descriptions from instruction field", () => {
		const result = toolSpecFunctionDeclarations(makeTool(), mockContext)

		const pathParam = result.parameters?.properties?.["path"] as any
		expect(pathParam).to.exist
		expect(pathParam.description).to.be.a("string")
		expect(pathParam.description).to.include("path of the file to read")
	})

	it("includes descriptions for all parameters", () => {
		const result = toolSpecFunctionDeclarations(makeTool(), mockContext)

		const props = result.parameters?.properties as any
		expect(props["path"].description).to.be.a("string").and.not.be.empty
		expect(props["optional_param"].description).to.be.a("string").and.not.be.empty
	})

	it("handles function-type instructions", () => {
		const tool = makeTool({
			parameters: [
				{
					name: "dynamic",
					required: true,
					instruction: (ctx: SystemPromptContext) => `Dynamic value: ${ctx.cwd}`,
				},
			],
		})
		const result = toolSpecFunctionDeclarations(tool, mockContext)

		const param = result.parameters?.properties?.["dynamic"] as any
		expect(param.description).to.equal("Dynamic value: /test/project")
	})

	it("omits description when instruction is empty", () => {
		const tool = makeTool({
			parameters: [{ name: "empty", required: false, instruction: "" }],
		})
		const result = toolSpecFunctionDeclarations(tool, mockContext)

		const param = result.parameters?.properties?.["empty"] as any
		expect(param.description).to.be.undefined
	})
})

describe("Gemini and Anthropic parameter descriptions match", () => {
	it("both converters produce the same description text", () => {
		const tool = makeTool()
		const gemini = toolSpecFunctionDeclarations(tool, mockContext)
		const anthropic = toolSpecInputSchema(tool, mockContext)

		const geminiDesc = (gemini.parameters?.properties?.["path"] as any)?.description
		const anthropicDesc = (anthropic.input_schema as any).properties["path"]?.description

		expect(geminiDesc).to.equal(anthropicDesc)
	})
})

describe("native tool placeholder replacement", () => {
	it("replaces CWD and MULTI_ROOT_HINT placeholders in descriptions", () => {
		const context: SystemPromptContext = {
			...mockContext,
			isMultiRootEnabled: true,
		}
		const tool = makeTool({
			parameters: [
				{
					name: "path",
					required: true,
					instruction: "Path (relative to {{CWD}}){{MULTI_ROOT_HINT}}",
				},
			],
		})

		const openAI = toolSpecFunctionDefinition(tool, context)
		const anthropic = toolSpecInputSchema(tool, context)
		const gemini = toolSpecFunctionDeclarations(tool, context)

		const openAIDesc = ((openAI as any).function.parameters.properties.path as any).description as string
		const anthropicDesc = ((anthropic as any).input_schema.properties.path as any).description as string
		const geminiDesc = (gemini.parameters?.properties?.["path"] as any)?.description as string

		for (const desc of [openAIDesc, anthropicDesc, geminiDesc]) {
			expect(desc).to.include("/test/project")
			expect(desc).to.include("Use @workspace:path syntax")
			expect(desc).to.not.include("{{CWD}}")
			expect(desc).to.not.include("{{MULTI_ROOT_HINT}}")
		}
	})
})

describe("plan_mode_respond native schema", () => {
	it("exposes needs_more_exploration for native GPT-5 plan responses", () => {
		for (const family of [ModelFamily.NATIVE_GPT_5, ModelFamily.NATIVE_NEXT_GEN]) {
			const spec = plan_mode_respond_variants.find((variant) => variant.variant === family)

			expect(spec, `plan_mode_respond spec for ${family}`).to.exist
			expect(spec!.description).to.include("needs_more_exploration")

			const openAI = toolSpecFunctionDefinition(spec!, mockContext)
			const properties = (openAI as any).function.parameters.properties
			expect(properties.needs_more_exploration).to.deep.include({
				type: "boolean",
			})
		}
	})
})

describe("browser_action tool docs", () => {
	it("documents evaluate as discoverable and gated for every browser action variant", () => {
		for (const spec of browser_action_variants) {
			const action = spec.parameters.find((parameter) => parameter.name === "action")
			const text = spec.parameters.find((parameter) => parameter.name === "text")
			const docs = `${spec.description}\n${action?.instruction ?? ""}\n${action?.usage ?? ""}\n${text?.instruction ?? ""}\n${text?.usage ?? ""}`

			expect(docs).to.include("evaluate")
			expect(docs).to.include("browser JavaScript evaluation")
			expect(docs).to.include("cline.cursorCompatibility.safeBrowserEvaluate.enabled")
		}
	})

	it("documents browser_snapshot as read-only active-page inspection", () => {
		for (const spec of browser_snapshot_variants) {
			const docs = `${spec.description}\n${spec.parameters?.map((parameter) => parameter.instruction).join("\n") ?? ""}`

			expect(docs).to.include("read-only")
			expect(docs).to.include("browser_action")
			expect(docs).to.include("browser_snapshot")
			expect(docs).to.include("without clicking")
			expect(docs).to.include("running user-provided JavaScript")
			expect(docs).to.include("tab_id")
			expect(docs).to.include("include_screenshot")
			expect(docs).to.include("include_logs")
		}
	})

	it("documents browser_screenshot as read-only active-page capture", () => {
		for (const spec of browser_screenshot_variants) {
			const docs = `${spec.description}\n${spec.parameters?.map((parameter) => parameter.instruction).join("\n") ?? ""}`

			expect(docs).to.include("read-only")
			expect(docs).to.include("browser_action")
			expect(docs).to.include("browser_snapshot")
			expect(docs).to.include("browser_screenshot")
			expect(docs).to.include("Do not use this to click")
			expect(docs).to.include("running user-provided JavaScript")
			expect(docs).to.include("tab_id")
			expect(docs).to.include("full_page")
		}
	})
})
