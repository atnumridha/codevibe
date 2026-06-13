import { expect } from "chai"
import { describe, it } from "mocha"
import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"
import { toolSpecFunctionDeclarations, toolSpecFunctionDefinition, toolSpecInputSchema } from "../spec"
import { browser_action_variants } from "../tools/browser_action"
import { browser_screenshot_variants } from "../tools/browser_screenshot"
import { browser_snapshot_variants } from "../tools/browser_snapshot"
import { execute_command_variants } from "../tools/execute_command"
import { plan_mode_respond_variants } from "../tools/plan_mode_respond"
import { web_fetch_variants } from "../tools/web_fetch"
import { web_search_variants } from "../tools/web_search"
import { getCapabilitiesSection } from "../components/capabilities"
import type { PromptVariant, SystemPromptContext } from "../types"

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

describe("execute_command terminal policy schema", () => {
	const sandboxPermissionEnum = ["use_default", "sandboxed", "unelevated", "require_escalated"]
	const optionalTerminalPolicyParams = ["sandbox_permissions", "require_escalated", "prefix_rule"]

	it("exposes optional sandbox escalation parameters for every execute_command variant", () => {
		for (const spec of execute_command_variants) {
			const parameters = spec.parameters ?? []
			const parameterByName = new Map(parameters.map((parameter) => [parameter.name, parameter]))

			for (const paramName of optionalTerminalPolicyParams) {
				expect(parameterByName.get(paramName), `${spec.variant} ${paramName}`).to.include({
					required: false,
				})
			}

			expect(parameterByName.get("sandbox_permissions")?.enum).to.include.members(sandboxPermissionEnum)

			const openAI = toolSpecFunctionDefinition(spec, mockContext)
			const openAIParameters = (openAI as any).function.parameters
			const openAIProperties = openAIParameters.properties
			const anthropic = toolSpecInputSchema(spec, mockContext)
			const anthropicSchema = (anthropic as any).input_schema
			const anthropicProperties = anthropicSchema.properties
			const gemini = toolSpecFunctionDeclarations(spec, mockContext)
			const geminiParameters = gemini.parameters as any
			const geminiProperties = geminiParameters.properties

			for (const paramName of optionalTerminalPolicyParams) {
				expect(openAIProperties[paramName], `${spec.variant} OpenAI ${paramName}`).to.exist
				expect(openAIParameters.required).to.not.include(paramName)
				expect(anthropicProperties[paramName], `${spec.variant} Anthropic ${paramName}`).to.exist
				expect(anthropicSchema.required).to.not.include(paramName)
				expect(geminiProperties[paramName], `${spec.variant} Gemini ${paramName}`).to.exist
				expect(geminiParameters.required).to.not.include(paramName)
			}

			expect(openAIProperties.sandbox_permissions.enum).to.include.members(sandboxPermissionEnum)
			expect(anthropicProperties.sandbox_permissions.enum).to.include.members(sandboxPermissionEnum)
			expect(geminiProperties.sandbox_permissions.enum).to.include.members(sandboxPermissionEnum)
		}
	})
})

describe("Codie web tools provider gates", () => {
	const contextForProvider = (
		providerId: string,
		clineWebToolsEnabled = true,
	): SystemPromptContext => ({
		...mockContext,
		clineWebToolsEnabled,
		providerInfo: {
			...mockContext.providerInfo,
			providerId,
		},
	})

	it("enables web_search and web_fetch specs for OpenAI Codex sessions", () => {
		const codexContext = contextForProvider("openai-codex")
		for (const spec of [...web_search_variants, ...web_fetch_variants]) {
			expect(spec.contextRequirements?.(codexContext), spec.name).to.equal(true)
		}
	})

	it("keeps web tools gated by user setting and supported provider", () => {
		const disabledContext = contextForProvider("openai-codex", false)
		const unsupportedContext = contextForProvider("openai-native")
		for (const spec of [...web_search_variants, ...web_fetch_variants]) {
			expect(spec.contextRequirements?.(disabledContext), `${spec.name} disabled`).to.equal(false)
			expect(spec.contextRequirements?.(unsupportedContext), `${spec.name} provider`).to.equal(false)
		}
	})

	it("adds web tool capability guidance for OpenAI Codex sessions", async () => {
		const capabilities = await getCapabilitiesSection(
			{
				family: ModelFamily.GENERIC,
				labels: {},
			} as PromptVariant,
			contextForProvider("openai-codex"),
		)

		expect(capabilities).to.include("web_search")
		expect(capabilities).to.include("web_fetch")
	})
})

describe("browser_action tool docs", () => {
	it("documents Cursor-style browser actions and gated evaluate for every browser action variant", () => {
			for (const spec of browser_action_variants) {
				const parameters = spec.parameters ?? []
				const action = parameters.find((parameter) => parameter.name === "action")
				const url = parameters.find((parameter) => parameter.name === "url")
				const coordinate = parameters.find((parameter) => parameter.name === "coordinate")
				const text = parameters.find((parameter) => parameter.name === "text")
				const docs = `${spec.description}\n${action?.instruction ?? ""}\n${action?.usage ?? ""}\n${url?.instruction ?? ""}\n${coordinate?.instruction ?? ""}\n${text?.instruction ?? ""}\n${text?.usage ?? ""}`

			for (const documentedAction of [
				"launch",
				"navigate",
				"click",
				"hover",
				"fill",
				"select",
				"type",
				"key_press",
				"scroll_down",
				"scroll_up",
				"evaluate",
				"close",
			]) {
				expect(docs).to.include(documentedAction)
			}
			expect(docs).to.include("After launch")
			expect(docs).to.include("browser_snapshot")
			expect(docs).to.include("browser_screenshot")
			expect(docs).to.include("browser JavaScript evaluation")
			expect(docs).to.include("codevibe.compatibility.safeBrowserEvaluate.enabled")
		}
	})

	it("documents browser_snapshot as read-only active-page inspection", () => {
		for (const spec of browser_snapshot_variants) {
			const docs = `${spec.description}\n${spec.parameters?.map((parameter) => `${parameter.name}\n${parameter.instruction}`).join("\n") ?? ""}`

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
			const docs = `${spec.description}\n${spec.parameters?.map((parameter) => `${parameter.name}\n${parameter.instruction}`).join("\n") ?? ""}`

			expect(docs).to.include("read-only")
			expect(docs).to.include("browser_action")
			expect(docs).to.include("browser_snapshot")
			expect(docs).to.include("browser_screenshot")
			expect(docs).to.include("Do not use this to click")
			expect(docs).to.include("run user-provided JavaScript")
			expect(docs).to.include("tab_id")
			expect(docs).to.include("full_page")
		}
	})
})
