import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Frame, type Page, type TestInfo } from "@playwright/test";
import { E2ETestHelper, e2e } from "./utils/helpers";

const installedE2e = e2e.extend({
	extensionInstallMode: "installed" as const,
});

interface InstalledExtensionManifest {
	name?: string;
	publisher?: string;
	version?: string;
	activationEvents?: string[];
	enabledApiProposals?: string[];
	contributes?: {
		commands?: Array<{ command?: string; title?: string }>;
		chatAgents?: Array<{ id?: string; name?: string; path?: string }>;
		chatParticipants?: Array<{ id?: string; name?: string }>;
		chatPromptFiles?: Array<{ path?: string; sessionTypes?: string[] }>;
		chatSessions?: Array<{ id?: string; type?: string; displayName?: string }>;
		chatSkills?: Array<{ path?: string; sessionTypes?: string[] }>;
		menus?: Record<
			string,
			Array<{ command?: string; group?: string; when?: string }>
		>;
	};
}

const NATIVE_CHAT_API_PROPOSALS = [
	"chatParticipantAdditions",
	"chatSessionCustomizationProvider",
	"chatSessionsProvider",
];
const CODEVIBE_NATIVE_CHAT_SESSION_TYPE = "codevibe-agent";
const CODEVIBE_OPEN_NATIVE_CHAT_SIDEBAR_COMMAND = `workbench.action.chat.openNewSessionSidebar.${CODEVIBE_NATIVE_CHAT_SESSION_TYPE}`;
const EXPECTED_PROMPT_FILES = [
	"./assets/prompts/codevibe-plan.prompt.md",
	"./assets/prompts/codevibe-review.prompt.md",
	"./assets/prompts/codevibe-standalone-readiness.prompt.md",
];
const EXPECTED_SKILL_FILES = [
	"./assets/prompts/skills/codevibe-customizations/SKILL.md",
	"./assets/prompts/skills/codevibe-cursor-compatibility/SKILL.md",
	"./assets/prompts/skills/codevibe-local-plan-build/SKILL.md",
	"./assets/prompts/skills/codevibe-mcp/SKILL.md",
	"./assets/prompts/skills/codevibe-background-sessions/SKILL.md",
	"./assets/prompts/skills/codevibe-release-validation/SKILL.md",
	"./assets/prompts/skills/codevibe-performance-troubleshooting/SKILL.md",
];

function readJsonFile(filePath: string): InstalledExtensionManifest {
	return JSON.parse(
		readFileSync(filePath, "utf8"),
	) as InstalledExtensionManifest;
}

function findInstalledCodeVibeExtension(extensionsDir: string) {
	const extensionFolder = readdirSync(extensionsDir).find((entry) =>
		entry.startsWith("atnumridha.codevibe-"),
	);
	if (!extensionFolder) {
		return undefined;
	}

	const extensionPath = path.join(extensionsDir, extensionFolder);
	return {
		extensionPath,
		manifest: readJsonFile(path.join(extensionPath, "package.json")),
	};
}

async function slowVisiblePause(page: Page, ms = 1_500): Promise<void> {
	if (process.env.CODEVIBE_E2E_SLOW_UI === "true") {
		await page.waitForTimeout(ms);
	}
}

async function captureSlowUiScreenshot(
	page: Page,
	testInfo: TestInfo,
	name: string,
): Promise<void> {
	if (process.env.CODEVIBE_E2E_SLOW_UI !== "true") {
		return;
	}

	const screenshotsDir = E2ETestHelper.getResultsDir(
		testInfo.title,
		"screenshots",
	);
	mkdirSync(screenshotsDir, { recursive: true });
	const screenshotPath = path.join(screenshotsDir, `${name}.png`);
	await page.screenshot({ path: screenshotPath });
	await testInfo.attach(name, {
		path: screenshotPath,
		contentType: "image/png",
	});
}

installedE2e(
	"Installed VSIX native chat exposes Codie agent runtime",
	async ({ app: _app, extensionsDir }) => {
		const sourceManifest = readJsonFile(
			path.join(E2ETestHelper.CODEBASE_ROOT_DIR, "package.json"),
		);

		await expect
			.poll(
				() => findInstalledCodeVibeExtension(extensionsDir)?.manifest.version,
				{
					message: "Codie VSIX should install into the isolated extensions dir",
					timeout: 60_000,
				},
			)
			.toBe(sourceManifest.version);

		const installed = findInstalledCodeVibeExtension(extensionsDir);
		expect(installed).toBeDefined();
		const installedRelativePath = path.relative(
			extensionsDir,
			installed?.extensionPath ?? "",
		);
		expect(installedRelativePath.startsWith("..")).toBe(false);
		expect(path.isAbsolute(installedRelativePath)).toBe(false);

		const manifest = installed?.manifest;
		expect(manifest?.name).toBe("codevibe");
		expect(manifest?.publisher).toBe("atnumridha");
		expect(
			manifest?.contributes?.chatParticipants?.map(
				(participant) => participant.id,
			),
		).toEqual(["codevibe", "codevibe-agent"]);
		expect(
			manifest?.contributes?.chatSessions?.map((session) => session.type),
		).toEqual(["codevibe-agent"]);
		expect(manifest?.contributes?.chatSessions?.[0]).toMatchObject({
			id: CODEVIBE_NATIVE_CHAT_SESSION_TYPE,
			type: CODEVIBE_NATIVE_CHAT_SESSION_TYPE,
			displayName: "Codie Agent",
		});
		expect(manifest?.contributes?.chatAgents?.[0]).toMatchObject({
			id: CODEVIBE_NATIVE_CHAT_SESSION_TYPE,
			name: "codie",
			path: "agents/00-codevibe-agent.agent.md",
		});
		expect(
			manifest?.contributes?.chatPromptFiles?.map((entry) => entry.path),
		).toEqual(EXPECTED_PROMPT_FILES);
		expect(
			manifest?.contributes?.chatSkills?.map((entry) => entry.path),
		).toEqual(EXPECTED_SKILL_FILES);
		for (const entry of [
			...(manifest?.contributes?.chatPromptFiles ?? []),
			...(manifest?.contributes?.chatSkills ?? []),
		]) {
			expect(entry.sessionTypes).toEqual([CODEVIBE_NATIVE_CHAT_SESSION_TYPE]);
			expect(entry.path).toMatch(/^\.\/assets\/prompts\//);
			const fileText = readFileSync(
				path.join(
					installed?.extensionPath ?? "",
					entry.path?.replace(/^\.\//, "") ?? "",
				),
				"utf8",
			);
			expect(fileText).toMatch(/^---\nname: [a-z0-9-]+\n/m);
			expect(fileText).toMatch(/\ndescription: .+\n/m);
			expect(fileText).not.toMatch(/\bCline\b/);
		}
		expect(
			manifest?.contributes?.menus?.["chatSessions/newSession"]?.[0]?.command,
		).toBe("codevibe.newNativeAgentSession");
		expect(
			manifest?.contributes?.menus?.["chatSessions/newSession"]?.[0]?.group,
		).toBe("navigation@-1000");
		expect(
			manifest?.contributes?.menus?.["chatSessions/newSession"]?.[0]?.when,
		).toBeUndefined();
		expect(
			manifest?.contributes?.commands?.some(
				(command) => command.command === "codevibe.newNativeAgentSession",
			),
		).toBe(true);
		expect(
			manifest?.contributes?.commands?.some(
				(command) => command.command === "codevibe.nativeAgentDiagnostics",
			),
		).toBe(true);
		expect(manifest?.activationEvents).toEqual(
			expect.arrayContaining([
				"onChatParticipant:codevibe-agent",
				"onChatSession:codevibe-agent",
			]),
		);
		expect(manifest?.enabledApiProposals).toEqual(
			expect.arrayContaining(NATIVE_CHAT_API_PROPOSALS),
		);
		expect(manifest?.enabledApiProposals).toEqual(
			expect.arrayContaining(sourceManifest.enabledApiProposals ?? []),
		);

		const serializedContributions = JSON.stringify(manifest?.contributes ?? {});
		expect(serializedContributions).not.toContain("agent-host-codevibe");
		expect(serializedContributions).not.toContain("codevibe.agentPanel");
		expect(serializedContributions).not.toContain("codevibe.SidebarProvider");
		expect(serializedContributions).not.toContain("claude-dev.SidebarProvider");

		await expect
			.poll(
				async () => {
					const diagnosticsResponse =
						await E2ETestHelper.getNativeAgentDiagnostics().catch((error) => ({
							success: false,
							error: error instanceof Error ? error.message : String(error),
						}));
					return {
						success: diagnosticsResponse?.success === true,
						ready: diagnosticsResponse?.ready === true,
						diagnostics: diagnosticsResponse?.diagnostics,
						error: diagnosticsResponse?.error,
					};
				},
				{
					message:
						"Installed Codie VSIX should register native Chat runtime providers",
					timeout: 60_000,
				},
			)
			.toMatchObject({ success: true, ready: true });

		const diagnosticsResponse = await E2ETestHelper.getNativeAgentDiagnostics();
		const diagnostics = diagnosticsResponse.diagnostics;
		const apiAvailability = diagnostics?.apiAvailability ?? {};
		const registration = diagnostics?.registration ?? {};

		expect(diagnosticsResponse.success).toBe(true);
		expect(diagnosticsResponse.ready).toBe(true);
		expect(diagnostics?.extensionId).toBe("atnumridha.codevibe");
		expect(diagnostics?.enabledApiProposals).toEqual(
			expect.arrayContaining(NATIVE_CHAT_API_PROPOSALS),
		);
		expect(diagnostics?.chatSessionContribution).toMatchObject({
			type: CODEVIBE_NATIVE_CHAT_SESSION_TYPE,
			displayName: "Codie Agent",
			order: -1000,
		});
		expect(apiAvailability.chatApi).toBe(true);
		expect(apiAvailability.createChatParticipant).toBe(true);
		expect(apiAvailability.registerChatSessionContentProvider).toBe(true);
		expect(registration.chatParticipant).toBe(true);
		expect(registration.chatParticipantIds).toEqual(
			expect.arrayContaining(["codevibe", "codevibe-agent"]),
		);
		expect(registration.chatSessionProvider).toBe(true);
		expect(registration.chatSessionProviderTypes).toEqual([
			CODEVIBE_NATIVE_CHAT_SESSION_TYPE,
		]);
		const hasOptionalSessionListApi = Boolean(
			apiAvailability.registerCustomAgentProvider ||
				apiAvailability.registerChatSessionItemProvider ||
				apiAvailability.createChatSessionItemController,
		);
		const hasOptionalSessionListRegistration = Boolean(
			registration.customAgentProvider ||
				registration.chatSessionItemProvider ||
				registration.chatSessionItemController,
		);
		if (hasOptionalSessionListApi) {
			expect(hasOptionalSessionListRegistration).toBe(true);
		}
		expect(diagnostics?.failures).toEqual([]);

		const openResponse =
			await E2ETestHelper.openNativeAgentSessionRuntime("sidebar");
		expect(openResponse.success).toBe(true);
		expect(openResponse.result).toMatchObject({
			position: "sidebar",
			command: CODEVIBE_OPEN_NATIVE_CHAT_SIDEBAR_COMMAND,
			commandAvailable: true,
			opened: true,
		});
		expect(openResponse.result?.error).toBeUndefined();
	},
);

installedE2e(
	"Installed VSIX routes native Chat plan requests into Codie task engine",
	async ({ app: _app }) => {
		await expect
			.poll(
				async () => {
					const diagnosticsResponse =
						await E2ETestHelper.getNativeAgentDiagnostics().catch(() => ({
							success: false,
						}));
					return (
						diagnosticsResponse.success === true &&
						diagnosticsResponse.ready === true
					);
				},
				{
					message:
						"Installed Codie VSIX should activate native Chat request handler before invocation",
					timeout: 60_000,
				},
			)
			.toBe(true);

		const response = await E2ETestHelper.invokeNativeAgentRequest({
			command: "plan",
			prompt: "installed native request handler smoke",
		});

		expect(response.success).toBe(true);
		expect(response.taskText).toBe(
			"Plan this task first before editing.\n\ninstalled native request handler smoke",
		);
		expect(response.progress).toEqual(
			expect.arrayContaining([
				"Starting Codie Agent task...",
				"Codie task started.",
			]),
		);
		const streamedMarkdown = response.markdown?.join("\n") ?? "";
		expect(streamedMarkdown).toContain("Started Codie task");
		expect(streamedMarkdown).toContain("native VS Code Chat");
		expect(response.result?.metadata).toMatchObject({
			routedTo: "codevibe-agent",
			startedInCodeVibe: true,
		});
		expect(response.result?.metadata?.taskId).toBeTruthy();
		expect(response.currentTaskItem?.id).toBe(
			response.result?.metadata?.taskId,
		);
		expect(response.currentTaskItem?.task).toBe(
			"Plan this task first before editing.\n\ninstalled native request handler smoke",
		);
		expect(response.currentTaskItem?.task).not.toMatch(/\bCline\b/);
	},
);

installedE2e(
	"Installed VSIX exposes ChatGPT for Codie local auth and model state",
	async ({ app: _app }) => {
		await expect
			.poll(
				async () => {
					const diagnosticsResponse =
						await E2ETestHelper.getNativeAgentDiagnostics().catch(() => ({
							success: false,
						}));
					return (
						diagnosticsResponse.success === true &&
						diagnosticsResponse.ready === true
					);
				},
				{
					message:
						"Installed Codie VSIX should activate before Codex state is evaluated",
					timeout: 60_000,
				},
			)
			.toBe(true);

		const response = await E2ETestHelper.evaluateNativeOpenAiCodexState();

		expect(response.success).toBe(true);
		expect(response.defaultApiProvider).toBe("openai-codex");
		expect(response.apiConfiguration).toMatchObject({
			planModeApiProvider: "openai-codex",
			actModeApiProvider: "openai-codex",
			planModeApiModelId: "gpt-5.5-pro",
			actModeApiModelId: "gpt-5.5-pro",
		});
		expect(response.openAiCodexIsAuthenticated).toBe(true);
		expect(response.compatibilityStatus).toMatchObject({
			openAiCodexAuthSource: "auto",
			openAiCodexAuthenticated: true,
		});
		expect(response.credentials).toMatchObject({
			tokenSource: "codex-home",
			authMode: "chatgpt",
			email: "codex-e2e@example.invalid",
			accountId: "acct_codevibe_e2e_codex",
			installationId: "install_codevibe_e2e",
			clientVersion: "0.136.0-e2e",
			hasAccessToken: true,
			hasRefreshToken: true,
		});
		expect(response.models).toMatchObject({
			defaultModelId: "gpt-5.5-pro",
			includesDefaultModel: true,
		});
		expect(response.models?.bundledModelCount ?? 0).toBeGreaterThan(0);
		expect(response.authJsonRelativePath).toBe(".codex/auth.json");
		expect(response.secretLeakInPayload).toBe(false);
	},
);

installedE2e(
	"Installed VSIX opens native plan editor for local plan files",
	async ({ app: _app, page }, testInfo) => {
		await expect
			.poll(
				async () => {
					const diagnosticsResponse =
						await E2ETestHelper.getNativeAgentDiagnostics().catch(() => ({
							success: false,
						}));
					return diagnosticsResponse.success === true;
				},
				{
					message:
						"Installed Codie VSIX should activate its E2E command server before plan commands run",
					timeout: 60_000,
				},
			)
			.toBe(true);

		const created = await E2ETestHelper.createNativePlan({
			composerId: "installed-native-plan-e2e",
			response:
				'## Native Plan E2E\n\nCreate and open a plan from the installed VSIX.\n\n```mermaid\nflowchart TD\n  A["Create .plan.md"] --> B["Open custom editor"]\n```\n\n## Acceptance Criteria\n\n- Plan is persisted locally.\n- The native plan editor opens.',
			taskProgress:
				"- [x] Create installed plan file\n- [ ] Open native plan editor",
		});

		expect(created.success).toBe(true);
		expect(created.plan?.planId).toMatch(/^Native-Plan-E2E_[a-z0-9]{8}$/);
		expect(created.plan?.planPath).toMatch(/\.plan\.md$/);
		expect(created.plan?.todoCount).toBe(2);
		expect(created.plan?.metadata?.name).toBe("Native Plan E2E");
		expect(created.plan?.status).toBe("in_progress");
		expect(created.plan?.completedTodoCount).toBe(1);
		expect(created.plan?.metadata?.todos?.map((todo) => todo.status)).toEqual([
			"completed",
			"pending",
		]);

		const planPath = created.plan?.planPath;
		expect(planPath).toBeTruthy();
		const planText = readFileSync(planPath ?? "", "utf8");
		expect(planText).toMatch(/^---\nname: Native Plan E2E/m);
		expect(planText).toContain("todos:");
		expect(planText).toContain("```mermaid");
		expect(planText).not.toMatch(/\bCline\b/);

		const opened = await E2ETestHelper.openLatestNativePlan();
		expect(opened.success).toBe(true);
		expect(opened.latestPlan?.uri).toBe(planPath);
		expect(opened.latestPlan?.name).toBe("Native Plan E2E");
		expect(opened.activeTab?.inputUri).toBe(planPath);
		expect(opened.activeTab?.inputViewType).toBe("codevibe.planEditor");
		expect(opened.activeTab?.label).toContain("Native-Plan-E2E");
		expect(opened.planEditor).toMatchObject({
			editorAssociation: "codevibe.planEditor",
			usesCustomEditor: true,
			renderedCanvasExpected: true,
			hasLocalBuildActions: true,
			hasBuildSelectedAction: true,
			hasParallelBuildAction: true,
			hasCloudBuildAction: false,
			hasMermaid: true,
			hasFrontmatterTodos: true,
		});

		let planCanvasText = "";
		let planCanvasFrame: Frame | undefined;
		await E2ETestHelper.waitUntil(async () => {
			for (const frame of page.frames()) {
				if (frame.isDetached()) {
					continue;
				}
				try {
					const bodyText = await frame
						.locator("body")
						.innerText({ timeout: 500 });
					const hasActionMenus = await frame
						.locator("[data-build-action-trigger]")
						.first()
						.isVisible({ timeout: 500 })
						.catch(() => false);
					if (bodyText.includes("Rendered local plan canvas") && hasActionMenus) {
						planCanvasText = bodyText;
						planCanvasFrame = frame;
						return true;
					}
				} catch {
					continue;
				}
			}
			return false;
		}, 60_000);
		expect(planCanvasText).toContain("Build");
		expect(planCanvasText).toContain("Plan actions");
		expect(planCanvasText).toContain("Set selected status");
		expect(planCanvasText).toContain("Selected task actions");
		expect(planCanvasText).toContain("Native Plan E2E");
		expect(planCanvasText).toContain("50%");
		expect(planCanvasText).toMatch(/\bcomplete\b/i);
		expect(planCanvasText).toMatch(/\bpending\b/i);
		expect(planCanvasText).toContain("Todos: 1/2");
		expect(planCanvasText).not.toMatch(/\bBuild in Cloud\b/i);
		expect(planCanvasFrame).toBeTruthy();
		await expect(
			planCanvasFrame!.locator("[data-build-action-trigger]"),
		).toBeVisible();
		await expect(
			planCanvasFrame!.locator("[data-bulk-status-select]"),
		).toBeVisible();
		await expect(
			planCanvasFrame!.locator("[data-selection-action-trigger]"),
		).toBeVisible();
		await planCanvasFrame!.locator("[data-build-action-trigger]").click();
		await expect(
			planCanvasFrame!.locator("[data-build-action-menu]"),
		).toBeVisible();
		const buildOptions = (
			await planCanvasFrame!
				.locator("[data-build-action-menu] [data-build-action-button]")
				.allInnerTexts()
		).join("\n");
		expect(buildOptions).toContain("Build Locally");
		expect(buildOptions).toContain("Build in Parallel");
		expect(buildOptions).toContain("Build Selected");
		expect(buildOptions).toContain("Build Selected Parallel");
		expect(buildOptions).toContain("Build Selected in New Agent");
		expect(buildOptions).not.toMatch(/\bBuild in Cloud\b/i);
		const planOptions = (
			await planCanvasFrame!.locator('[aria-label="Plan action"] option').allInnerTexts()
		).join("\n");
		expect(planOptions).toContain("Raw Markdown");
		expect(planOptions).toContain("Copy Plan");
		expect(planOptions).toContain("Open Raw Markdown");
		await planCanvasFrame!.locator("[data-todo-row]").first().click();
		await expect(
			planCanvasFrame!.locator("[data-selection-action-trigger]"),
		).toBeEnabled();
		await planCanvasFrame!.locator("[data-selection-action-trigger]").click();
		await expect(
			planCanvasFrame!.locator("[data-selection-action-menu]"),
		).toBeVisible();
		const selectedTaskOptions = (
			await planCanvasFrame!
				.locator("[data-selection-action-menu] [data-selection-action-button]")
				.allInnerTexts()
		).join("\n");
		expect(selectedTaskOptions).toContain("Build Selected");
		expect(selectedTaskOptions).toContain("Build Selected Parallel");
		expect(selectedTaskOptions).toContain("Build Selected in New Agent");
		expect(selectedTaskOptions).toContain("Delete Selected");
		await expect(
			planCanvasFrame!.locator("[data-mermaid-action-select]"),
		).toBeVisible();
		const diagramOptions = (
			await planCanvasFrame!
				.locator("[data-mermaid-action-select] option")
				.allInnerTexts()
		).join("\n");
		expect(diagramOptions).toContain("Copy Source");
		expect(diagramOptions).toContain("Show Source");
		await expect(
			planCanvasFrame!.locator("[data-mermaid-target] svg").first(),
		).toBeVisible({ timeout: 15_000 });
		await captureSlowUiScreenshot(page, testInfo, "native-plan-canvas");
		await slowVisiblePause(page);
	},
);

installedE2e(
	"Installed VSIX Build Locally materializes missing plan file from UI plan card",
	async ({ page, sidebar, helper }, testInfo) => {
		await expect
			.poll(
				async () => {
					const diagnosticsResponse =
						await E2ETestHelper.getNativeAgentDiagnostics().catch(() => ({
							success: false,
						}));
					return diagnosticsResponse.success === true;
				},
				{
					message:
						"Installed Codie VSIX should activate its E2E command server before plan build diagnostics run",
					timeout: 60_000,
				},
			)
			.toBe(true);

		sidebar = await helper.openSidebar(page);
		const signInButton = sidebar.getByRole("button", {
			name: "Sign in to Codie",
		});
		if (await signInButton.isVisible().catch(() => false)) {
			sidebar = await helper.signin(sidebar, page);
		} else {
			sidebar = await helper.getReadySidebar(page);
		}
		sidebar = await helper.ensurePlanMode(page, sidebar);

		const seeded = await E2ETestHelper.seedPlanBuildWithoutFile();
		expect(seeded.success).toBe(true);
		expect(seeded.messageCount).toBe(2);

		const revealReadyPlanSidebar = async () => {
			let activeSidebar = await helper.openSidebar(page);
			activeSidebar = await helper.getReadySidebar(page);
			return helper.ensurePlanMode(page, activeSidebar);
		};

		await E2ETestHelper.waitUntil(async () => {
			for (const frame of page.frames()) {
				if (frame.isDetached()) {
					continue;
				}
				const hasPlanText = (
					await frame
						.locator("body")
						.innerText({ timeout: 500 })
						.catch(() => "")
				).includes("Build Button Materializes");
				if (hasPlanText) {
					sidebar = frame;
					return true;
				}
			}
			return false;
		}, 60_000);
		sidebar = await revealReadyPlanSidebar();

		await E2ETestHelper.waitUntil(async () => {
			try {
				sidebar = await revealReadyPlanSidebar();
				const planCard = sidebar
					.locator("[data-plan-card]", { hasText: "Build Button Materializes" })
					.last();
				await planCard.scrollIntoViewIfNeeded().catch(() => undefined);
				if (
					(await planCard.isVisible().catch(() => false)) &&
					(await planCard
						.locator("[data-plan-visible-summary]")
						.last()
						.isVisible()
						.catch(() => false)) &&
					(await planCard
						.getByRole("button", { name: /^Build plan action$/ })
						.count()
						.catch(() => 0)) > 0
				) {
					return true;
				}
			} catch {
				return false;
			}
			return false;
		}, 60_000);
		sidebar = await revealReadyPlanSidebar();
		const visiblePlanCard = sidebar
			.locator("[data-plan-card]", { hasText: "Build Button Materializes" })
			.last();
		await visiblePlanCard.scrollIntoViewIfNeeded().catch(() => undefined);
		const visiblePlanSummary = visiblePlanCard
			.locator("[data-plan-visible-summary]")
			.last();
		await expect(visiblePlanSummary).toBeVisible();
		await expect(visiblePlanSummary).toContainText("Build Button Materializes");
		await captureSlowUiScreenshot(page, testInfo, "build-locally-plan-card");
		await slowVisiblePause(page);

		await E2ETestHelper.waitUntil(async () => {
			try {
				sidebar = await revealReadyPlanSidebar();
				const planCard = sidebar
					.locator("[data-plan-card]", { hasText: "Build Button Materializes" })
					.last();
				await planCard.scrollIntoViewIfNeeded().catch(() => undefined);
				if (!(await planCard.isVisible().catch(() => false))) {
					return false;
				}
				const buildActionSelects = planCard.getByRole("button", {
					name: /^Build plan action$/,
				});
				const selectCount = await buildActionSelects.count().catch(() => 0);
				for (let index = 0; index < selectCount; index += 1) {
					const buildActionSelect = buildActionSelects.nth(index);
					if (
						(await buildActionSelect.isVisible().catch(() => false)) &&
						(await buildActionSelect.isEnabled().catch(() => false))
					) {
						await buildActionSelect
							.scrollIntoViewIfNeeded()
							.catch(() => undefined);
						await buildActionSelect.click();
						await planCard
							.locator("[data-build-action-menu] [data-build-action-button]", {
								hasText: "Build Locally",
							})
							.click();
						return true;
					}
				}
			} catch {
				return false;
			}
			return false;
		}, 60_000);
		await slowVisiblePause(page);
		let opened = await E2ETestHelper.openLatestNativePlan();
		await expect
			.poll(
				async () => {
					opened = await E2ETestHelper.openLatestNativePlan();
					return opened.latestPlan?.name ?? "";
				},
				{ timeout: 60_000 },
			)
			.toBe("Build Button Materializes");
		expect(opened.success).toBe(true);
		expect(opened.latestPlan?.name).toBe("Build Button Materializes");
		expect(opened.latestPlan?.uri).toMatch(/\.plan\.md$/);
		expect(opened.activeTab?.inputViewType).toBe("codevibe.planEditor");
		expect(opened.planEditor?.usesCustomEditor).toBe(true);

		const planPath = opened.latestPlan?.uri ?? "";
		const planText = readFileSync(planPath, "utf8");
		expect(planText).toMatch(/^---\nname: Build Button Materializes/m);
		expect(planText).toContain("content: Create the plan file");
		expect(planText).toContain("content: Start local Act mode");
	},
);

installedE2e(
	"Installed VSIX Build Selected in New Agent starts a local Act task from native plan canvas",
	async ({ page, helper }, testInfo) => {
		await expect
			.poll(
				async () => {
					const diagnosticsResponse =
						await E2ETestHelper.getNativeAgentDiagnostics().catch(() => ({
							success: false,
						}));
					return diagnosticsResponse.success === true;
				},
				{
					message:
						"Installed Codie VSIX should activate its E2E command server before selected plan builds run",
					timeout: 60_000,
				},
			)
			.toBe(true);

		const created = await E2ETestHelper.createNativePlan({
			composerId: "installed-native-selected-new-agent-e2e",
			response:
				"## Selected New Agent Build\n\nUse selected plan todos to start a new local agent.\n\n- [ ] Inspect selected todo wiring\n- [ ] Confirm Act mode handoff",
			taskProgress:
				"- [ ] Inspect selected todo wiring\n- [ ] Confirm Act mode handoff",
		});

		expect(created.success).toBe(true);
		expect(created.plan?.planPath).toMatch(/\.plan\.md$/);

		const opened = await E2ETestHelper.openLatestNativePlan();
		expect(opened.success).toBe(true);
		expect(opened.latestPlan?.name).toBe("Selected New Agent Build");
		expect(opened.activeTab?.inputViewType).toBe("codevibe.planEditor");

		let planCanvasFrame: Frame | undefined;
		await E2ETestHelper.waitUntil(async () => {
			for (const frame of page.frames()) {
				if (frame.isDetached()) {
					continue;
				}
				const bodyText = await frame
					.locator("body")
					.innerText({ timeout: 500 })
					.catch(() => "");
				if (
					bodyText.includes("Selected New Agent Build") &&
					(await frame
						.locator("[data-selection-action-trigger]")
						.first()
						.isVisible({ timeout: 500 })
						.catch(() => false))
				) {
					planCanvasFrame = frame;
					return true;
				}
			}
			return false;
		}, 60_000);
		expect(planCanvasFrame).toBeTruthy();

		const firstTodoRow = planCanvasFrame!.locator("[data-todo-row]").first();
		await expect(firstTodoRow).toBeVisible();
		await firstTodoRow.click();
		const selectedAction = planCanvasFrame!.locator(
			"[data-selection-action-trigger]",
		);
		await expect(selectedAction).toBeEnabled();
		await selectedAction.click();
		await expect(
			planCanvasFrame!.locator("[data-selection-action-menu]"),
		).toBeVisible();
		await captureSlowUiScreenshot(
			page,
			testInfo,
			"build-selected-new-agent-before-action",
		);
		await E2ETestHelper.waitUntil(async () => {
			for (const frame of page.frames()) {
				if (frame.isDetached()) {
					continue;
				}
				const bodyText = await frame
					.locator("body")
					.innerText({ timeout: 500 })
					.catch(() => "");
				if (!bodyText.includes("Selected New Agent Build")) {
					continue;
				}
				const trigger = frame.locator("[data-selection-action-trigger]").first();
				if (!(await trigger.isVisible({ timeout: 500 }).catch(() => false))) {
					continue;
				}
				if (!(await trigger.isEnabled().catch(() => false))) {
					await frame.locator("[data-todo-row]").first().click();
				}
				await trigger.click();
				const newAgentButton = frame
					.locator("[data-selection-action-menu] [data-menu-action='buildNewAgent']")
					.first();
				if (await newAgentButton.isVisible({ timeout: 500 }).catch(() => false)) {
					await newAgentButton.click({ force: true, timeout: 1_000 }).catch((error) => {
						const message =
							error instanceof Error ? error.message : String(error);
						if (!message.includes("Frame was detached")) {
							throw error;
						}
					});
					return true;
				}
			}
			return false;
		}, 60_000);
		await slowVisiblePause(page);

		let sidebar = await helper.openSidebar(page);
		sidebar = await helper.getReadySidebar(page);
		const modeSwitch = await helper.getModeSwitch(sidebar);
		await expect(modeSwitch.locator("[aria-current='true']")).toHaveText("Act", {
			timeout: 60_000,
		});
		await expect(sidebar.locator("body")).toContainText(
			"Selected New Agent Build",
			{ timeout: 60_000 },
		);
		await captureSlowUiScreenshot(
			page,
			testInfo,
			"build-selected-new-agent-act-mode",
		);
		await slowVisiblePause(page);
	},
);

installedE2e(
	"Installed VSIX uses VS Code native text search before file reads",
	async ({ app: _app }) => {
		await expect
			.poll(
				async () => {
					const diagnosticsResponse =
						await E2ETestHelper.getNativeAgentDiagnostics().catch(() => ({
							success: false,
						}));
					return diagnosticsResponse.success === true;
				},
				{
					message:
						"Installed Codie VSIX should activate its E2E command server before search commands run",
					timeout: 60_000,
				},
			)
			.toBe(true);

		const response = await E2ETestHelper.searchNativeWorkspaceText({
			regex: "installedSearchNeedle",
			filePattern: "*.ts",
			maxResults: 10,
			files: [
				{
					relativePath: "src/search-target.ts",
					content:
						"const before = false\nexport const installedSearchNeedle = true\nconst after = true\n",
				},
				{
					relativePath: "docs/search-target.md",
					content:
						"installedSearchNeedle should not appear when the *.ts include pattern is respected\n",
				},
			],
		});

		expect(response.success).toBe(true);
		expect(response.nativeTextSearchAvailable).toBe(true);
		expect(response.nativeFindTextInFilesCalls).toBe(1);
		expect(response.fallbackFindFilesCalls).toBe(0);
		expect(response.fallbackReadFileCalls).toBe(0);
		expect(response.limitHit).toBe(false);
		expect(response.matches).toEqual([
			expect.objectContaining({
				path: "src/search-target.ts",
				line: 2,
				column: 13,
				match: "export const installedSearchNeedle = true",
			}),
		]);
		expect(response.matches?.[0]?.beforeContext).toEqual(expect.any(Array));
		expect(response.matches?.[0]?.afterContext).toEqual(expect.any(Array));
	},
);

installedE2e(
	"Installed VSIX evaluates Cursor sandbox policy and inline terminal run modes",
	async ({ app: _app }) => {
		await expect
			.poll(
				async () => {
					const diagnosticsResponse =
						await E2ETestHelper.getNativeAgentDiagnostics().catch(() => ({
							success: false,
						}));
					return diagnosticsResponse.success === true;
				},
				{
					message:
						"Installed Codie VSIX should activate its E2E command server before sandbox diagnostics run",
					timeout: 60_000,
				},
			)
			.toBe(true);

		const response = await E2ETestHelper.evaluateNativeSandboxPolicy();

		expect(response.success).toBe(true);
		expect(response.policy?.status).toBe("loaded");
		expect(response.policy?.configSource).toBe("cursorCompatibility");
		expect(response.policy?.configPathRelative).toBe(".cursor/sandbox.json");
		expect(response.policy?.effectiveAccess).toBe("readOnly");
		expect(response.policy?.allowReadAutoApprove).toBe(true);
		expect(response.policy?.allowWriteAutoApprove).toBe(false);
		expect(response.policy?.allowTerminalAutoApprove).toBe(false);
		expect(response.policy?.allowNetworkAutoApprove).toBe(false);
		expect(response.policy?.commandPermissions?.allow).toContain("git diff");
		expect(response.policy?.commandPermissions?.deny).toContain("git commit *");
		expect(response.policy?.commandPermissions?.allowRedirects).toBe(false);

		expect(response.defaultRunModes).toEqual({
			withSandboxPolicy: "sandboxed",
			withoutSandboxPolicy: "default",
		});

		expect(response.commands?.readOnly?.sandboxed).toEqual(
			expect.objectContaining({ allowed: true, reason: "allowed" }),
		);
		expect(response.commands?.mutating?.sandboxed).toEqual(
			expect.objectContaining({
				allowed: false,
				reason: "no_match_deny_default",
			}),
		);
		expect(response.commands?.mutating?.elevated).toEqual(
			expect.objectContaining({ allowed: true, reason: "no_config" }),
		);
		expect(response.commands?.gitWrite?.sandboxed).toEqual(
			expect.objectContaining({
				allowed: false,
				reason: "denied",
				matchedPattern: "git commit *",
			}),
		);
		expect(response.commands?.redirect?.sandboxed).toEqual(
			expect.objectContaining({ allowed: false, reason: "redirect_detected" }),
		);

		expect(response.inlineRequests?.sandboxed).toEqual(
			expect.objectContaining({
				ok: true,
				request: expect.objectContaining({
					requestedTerminalRunMode: "sandboxed",
					requiresManualApproval: false,
				}),
			}),
		);
		expect(response.inlineRequests?.unelevated).toEqual(
			expect.objectContaining({
				ok: true,
				request: expect.objectContaining({
					requestedTerminalRunMode: "default",
					requiresManualApproval: false,
				}),
			}),
		);
		expect(response.inlineRequests?.requireEscalated).toEqual(
			expect.objectContaining({
				ok: true,
				request: expect.objectContaining({
					requestedTerminalRunMode: "elevated",
					requiresManualApproval: true,
				}),
			}),
		);
		expect(response.inlineRequests?.booleanEscalated).toEqual(
			expect.objectContaining({
				ok: true,
				request: expect.objectContaining({
					requestedTerminalRunMode: "elevated",
					requiresManualApproval: true,
				}),
			}),
		);
	},
);

installedE2e(
	"Installed VSIX renders visible sandbox command approval controls",
	async ({ page, sidebar, helper }) => {
		await expect
			.poll(
				async () => {
					const diagnosticsResponse =
						await E2ETestHelper.getNativeAgentDiagnostics().catch(() => ({
							success: false,
						}));
					return diagnosticsResponse.success === true;
				},
				{
					message:
						"Installed Codie VSIX should activate its E2E command server before approval UI diagnostics run",
					timeout: 60_000,
				},
			)
			.toBe(true);

		sidebar = await helper.openSidebar(page);
		const response = await E2ETestHelper.seedVisibleCommandApproval({
			command: "git status --short",
		});

		expect(response.success).toBe(true);
		expect(response.command).toBe("git status --short");
		expect(response.messageCount).toBe(2);
		expect(response.sandboxRuntime).toEqual(
			expect.objectContaining({
				status: "loaded",
				effectiveAccess: "readOnly",
				configSource: "cursorCompatibility",
				networkDefault: "deny",
			}),
		);

		let visibleWebviewText = "";
		await E2ETestHelper.waitUntil(async () => {
			visibleWebviewText = await sidebar
				.locator("body")
				.innerText()
				.catch(() => "");
			return (
				visibleWebviewText.includes("Codie wants to execute this command:") &&
				visibleWebviewText.includes("git status --short")
			);
		}, 30_000);
		await expect(
			sidebar.getByText(
				"Codie needs your approval before running this command.",
			),
		).toBeVisible();
		await expect(
			sidebar.getByRole("button", { name: "Run command in sandbox" }),
		).toBeVisible();
		await expect(
			sidebar.getByRole("button", { name: "Run command unelevated" }),
		).toBeVisible();
		await expect(
			sidebar.getByRole("button", { name: "Run command elevated" }),
		).toBeVisible();
		await expect(
			sidebar.getByRole("button", { name: "Reject command" }),
		).toBeVisible();
		await expect(
			sidebar.getByText(/Legacy import-compatible sandbox active/),
		).toBeVisible();
		await expect(
			sidebar.getByText(/Unelevated uses normal terminal mode/),
		).toBeVisible();

		expect(visibleWebviewText).not.toMatch(/\bCline\b/);
	},
);

installedE2e(
	"Installed VSIX renders browser automation transcript",
	async ({ page, sidebar, helper }) => {
		await expect
			.poll(
				async () => {
					const diagnosticsResponse =
						await E2ETestHelper.getNativeAgentDiagnostics().catch(() => ({
							success: false,
						}));
					return diagnosticsResponse.success === true;
				},
				{
					message:
						"Installed Codie VSIX should activate its E2E command server before browser diagnostics run",
					timeout: 60_000,
				},
			)
			.toBe(true);

		sidebar = await helper.openSidebar(page);
		const response = await E2ETestHelper.seedBrowserAutomation();
		sidebar = await helper.getReadySidebar(page);

		expect(response.success).toBe(true);
		expect(response.url).toBe("http://127.0.0.1:4317/codie-browser-e2e");
		expect(response.hasScreenshot).toBe(true);
		expect(response.actions).toEqual([
			"launch",
			"snapshot",
			"screenshot",
			"click",
			"type",
			"close",
		]);
		expect(response.messageCount).toBe(10);

		let visibleWebviewText = "";
		await E2ETestHelper.waitUntil(async () => {
			for (const frame of page.frames()) {
				if (frame.isDetached()) {
					continue;
				}
				const bodyText = await frame
					.locator("body")
					.innerText({ timeout: 500 })
					.catch(() => "");
				if (
					bodyText.includes("Codie wants to use the browser:") &&
					bodyText.includes("http://127.0.0.1:4317/codie-browser-e2e") &&
					bodyText.includes("Browse Action: Close browser") &&
					bodyText.includes("Browser automation evidence captured locally.")
				) {
					visibleWebviewText = bodyText;
					sidebar = frame;
					return true;
				}
			}
			return false;
		}, 30_000);

		await expect(
			sidebar.locator('img[alt="Browser screenshot"]').first(),
		).toBeVisible();
		await expect(sidebar.getByText("Console Logs").first()).toBeVisible();
		await expect(sidebar.getByText("Step 4 of 4")).toBeVisible();
		await expect(
			sidebar.getByText("Browse Action: Close browser"),
		).toBeVisible();
		await expect(
			sidebar.getByText("Browser automation evidence captured locally."),
		).toBeVisible();
		await slowVisiblePause(page);

		expect(visibleWebviewText).not.toMatch(/\bCline\b/);
	},
);

installedE2e(
	"Installed VSIX routes Cursor-compatible deeplinks through local VS Code handlers",
	async ({ app: _app }) => {
		await expect
			.poll(
				async () => {
					const diagnosticsResponse =
						await E2ETestHelper.getNativeAgentDiagnostics().catch(() => ({
							success: false,
						}));
					return diagnosticsResponse.success === true;
				},
				{
					message:
						"Installed Codie VSIX should activate its E2E command server before deeplink diagnostics run",
					timeout: 60_000,
				},
			)
			.toBe(true);

		const response = await E2ETestHelper.evaluateNativeCompatibilityDeeplinks();

		expect(response.success).toBe(true);
		expect(response.secretLeakInMessages).toBe(false);
		expect(response.routeResults).toEqual(
			expect.objectContaining({
				createchat: true,
				prompt: true,
				glass: true,
				command: true,
				mcpInstall: true,
				backgroundAgent: true,
				automationIngest: true,
				settings: true,
				pluginAdd: true,
				pluginReplace: true,
				prReview: true,
				rulePreview: true,
				gitCheckoutPreview: true,
				gitBranchPreview: true,
				gitCommitPreview: true,
				mcpOAuthCallback: true,
				disabledCreatechat: false,
			}),
		);

		const messages = response.messages?.map((message) => message.message) ?? [];
		const messageText = JSON.stringify(response.messages);
		expect(messages).toContain("Create Codie chat task?");
		expect(messages).toContain("Create Codie prompt task?");
		expect(messages).toContain("Create Codie glass prompt task?");
		expect(messages).toContain("Create Codie command task?");
		expect(messages).toContain('Install MCP server "docs"?');
		expect(messages).toContain(
			'Installed MCP server "docs". Authentication required.',
		);
		expect(messages).toContain("Launch Codie background agent?");
		expect(messages).toContain("Ingest automation NDJSON?");
		expect(messages).toContain('Install Codie plugin "docs-helper"?');
		expect(messages).toContain("Start Codie PR review?");
		expect(messages).toContain('Create or open rule "team-style.mdc"?');
		expect(messageText).not.toContain("secret-value");
		expect(messageText).not.toContain("secret-fragment");

		expect(response.openSettingsCalls).toEqual([
			expect.objectContaining({
				query: "@id:codevibe.compatibility.safeBrowserEvaluate.enabled",
			}),
		]);
		expect(response.openFileCalls).toEqual([]);

		expect(response.calls?.mcpAdds).toEqual([
			expect.objectContaining({
				serverName: "docs",
				type: "streamableHttp",
				hasUrl: true,
				hasSecretConfig: true,
			}),
		]);
		expect(response.calls?.oauthInitiations).toEqual(["docs"]);
		expect(response.calls?.oauthCallbacks).toEqual([
			expect.objectContaining({
				serverHash: "hash123",
				code: "code123",
				state: "state123",
			}),
		]);
		expect(response.calls?.backgroundLaunches).toEqual([
			expect.objectContaining({
				prompt: "Fix the queue",
				repository: "owner/repo",
				requestedBranch: "main",
				hasRoutePrompt: true,
			}),
		]);
		expect(response.calls?.automationIngests).toEqual([
			expect.objectContaining({
				eventCount: 1,
				strict: false,
				hasRoutePrompt: true,
			}),
		]);
		expect(response.calls?.pluginAdds).toEqual([
			expect.objectContaining({
				sourceParam: "id",
				detailMentionsReplace: false,
			}),
			expect.objectContaining({
				sourceParam: "id",
				force: true,
				detailMentionsReplace: true,
			}),
		]);
		expect(response.calls?.pluginAdds?.[0]).not.toHaveProperty("force");
		expect(response.calls?.prReviewTasks).toBe(1);
		expect(response.calls?.postStateCalls).toBe(1);
		expect(response.calls?.tasks?.length).toBeGreaterThanOrEqual(5);
		expect(
			response.calls?.tasks?.some((task) => task.hasCompatibleContext),
		).toBe(true);
		expect(
			response.calls?.tasks?.some((task) => task.preview?.includes("Blocked")),
		).toBe(false);
	},
);

installedE2e(
	"Installed VSIX opens the Codie webview composer",
	async ({ page, sidebar, helper }) => {
		const signInButton = sidebar.getByRole("button", {
			name: "Sign in to Codie",
		});
		if (await signInButton.isVisible().catch(() => false)) {
			sidebar = await helper.signin(sidebar, page);
		} else {
			sidebar = await helper.getReadySidebar(page);
		}

		const chatInput = await helper.getChatInput(sidebar);
		await expect(chatInput).toBeVisible();
		await expect(chatInput).toHaveAttribute(
			"placeholder",
			/Start a Codie task|Message Codie/i,
			{ timeout: 15_000 },
		);

		const modeSwitch = await helper.getModeSwitch(sidebar);
		await expect(modeSwitch).toBeVisible();

		const smokePrompt = "Plan a Codie installed-webview smoke test";
		await chatInput.fill(smokePrompt);
		await expect(chatInput).toHaveValue(smokePrompt);

		const visibleWebviewText = await sidebar.locator("body").innerText();
		expect(visibleWebviewText).toContain("Codie");
		expect(visibleWebviewText).not.toMatch(/\bCline\b/);
		await slowVisiblePause(page);
	},
);
