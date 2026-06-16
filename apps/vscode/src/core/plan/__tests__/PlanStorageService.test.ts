import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "mocha";
import {
	disposePlanStorageServiceForTests,
	PlanStorageService,
	registerPlanChangeHandler,
	registerPlanOpenHandler,
	type PlanChangeEvent,
} from "../PlanStorageService";

describe("PlanStorageService", () => {
	let tempDir: string | undefined;
	let service: PlanStorageService | undefined;
	const originalHome = process.env.HOME;

	afterEach(async () => {
		delete process.env.CODEVIBE_PLAN_HOME;
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
		await service?.dispose();
		service = undefined;
		await disposePlanStorageServiceForTests();
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true });
			tempDir = undefined;
		}
	});

	async function createService() {
		tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "codevibe-plan-storage-"),
		);
		process.env.CODEVIBE_PLAN_HOME = tempDir;
		service = new PlanStorageService();
		await service.getPlanDir(tempDir);
		return service;
	}

	it("stores local plans in Cursor-style plan home with registry metadata", async () => {
		const service = await createService();

		const plan = await service.createOrUpdatePlanForComposer({
			composerId: "task-123",
			response: "## Implementation Plan\n\nDo the work.",
			taskProgress: "- [ ] Inspect\n- [ ] Implement",
			workspacePath: tempDir,
		});

		assert.match(plan.planId, /^Implementation-Plan_[a-z0-9]{8}$/);
		assert.equal(path.dirname(plan.planPath), tempDir);
		assert.match(
			path.basename(plan.planPath),
			/^Implementation-Plan_[a-z0-9]{8}\.plan\.md$/,
		);
		assert.equal(plan.todoCount, 2);
		assert.equal(plan.metadata.todos[0].id.startsWith("todo-"), true);
		assert.equal(plan.metadata.todos[0].status, "pending");

		const serialized = await fs.readFile(plan.planPath, "utf8");
		assert.match(serialized, /^---\nname: Implementation Plan/m);
		assert.match(serialized, /todos:/);
		assert.match(serialized, /isProject: false/);

		const registry = await service.listPlans(tempDir);
		assert.equal(registry.length, 1);
		assert.equal(registry[0].id, plan.planId);
		assert.equal(registry[0].uri, plan.planPath);
		assert.deepEqual(registry[0].editedBy, ["task-123"]);
		assert.deepEqual(registry[0].referencedBy, ["task-123"]);
	});

	it("re-resolves the local plan home when CODEVIBE_PLAN_HOME changes", async () => {
		tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "codevibe-plan-home-switch-"),
		);
		const firstPlanHome = path.join(tempDir, "plans-a");
		const secondPlanHome = path.join(tempDir, "plans-b");
		process.env.CODEVIBE_PLAN_HOME = firstPlanHome;
		service = new PlanStorageService();

		const first = await service.createOrUpdatePlanForComposer({
			composerId: "task-first-home",
			response: "## First Home\n\nInitial.",
			taskProgress: "- [ ] Inspect first",
			workspacePath: tempDir,
		});

		process.env.CODEVIBE_PLAN_HOME = secondPlanHome;
		const second = await service.createOrUpdatePlanForComposer({
			composerId: "task-second-home",
			response: "## Second Home\n\nSwitched.",
			taskProgress: "- [ ] Inspect second",
			workspacePath: tempDir,
		});

		assert.equal(path.dirname(first.planPath), firstPlanHome);
		assert.equal(path.dirname(second.planPath), secondPlanHome);
		assert.equal((await service.listPlans(tempDir))[0].id, second.planId);
		process.env.CODEVIBE_PLAN_HOME = firstPlanHome;
		assert.equal((await service.listPlans(tempDir))[0].id, first.planId);
	});

	it("opens plans through the registered native plan opener", async () => {
		const service = await createService();
		const plan = await service.createOrUpdatePlanForComposer({
			composerId: "task-open",
			response: "## Native Plan\n\nUse rich editor.",
			taskProgress: "- [ ] Inspect",
			workspacePath: tempDir,
		});
		const opened: string[] = [];
		registerPlanOpenHandler(async ({ planPath }) => {
			opened.push(planPath);
		});

		await service.openPlan({ planId: plan.planId, workspacePath: tempDir });

		assert.deepEqual(opened, [plan.planPath]);
	});

	it("writes .cursor/.gitignore when falling back to workspace plan storage", async () => {
		tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "codevibe-plan-fallback-"),
		);
		const fakeHomeFile = path.join(tempDir, "home-is-not-a-directory");
		await fs.writeFile(fakeHomeFile, "", "utf8");
		process.env.HOME = fakeHomeFile;
		service = new PlanStorageService();

		const planDir = await service.getPlanDir(tempDir);

		assert.equal(planDir, path.join(tempDir, ".cursor", "plans"));
		assert.equal(
			await fs.readFile(path.join(tempDir, ".cursor", ".gitignore"), "utf8"),
			"plans/\n",
		);
	});

	it("updates the same named plan file for subsequent composer responses", async () => {
		const service = await createService();
		const first = await service.createOrUpdatePlanForComposer({
			composerId: "task-stream",
			response: "## Launch Review\n\nInitial.",
			taskProgress: "- [ ] Inspect",
			workspacePath: tempDir,
		});

		const second = await service.createOrUpdatePlanForComposer({
			composerId: "task-stream",
			response: "## Launch Review\n\nUpdated.",
			taskProgress: "- [x] Inspect\n- [ ] Verify",
			workspacePath: tempDir,
		});

		assert.equal(second.planId, first.planId);
		assert.equal(second.planPath, first.planPath);
		assert.match(
			path.basename(second.planPath),
			/^Launch-Review_[a-z0-9]{8}\.plan\.md$/,
		);
		assert.equal(second.todoCount, 2);
		assert.equal(second.metadata.todos[0].id, first.metadata.todos[0].id);
		assert.equal(second.metadata.todos[0].status, "completed");
		assert.equal(second.status, "pending");
		assert.match(await fs.readFile(second.planPath, "utf8"), /Updated\./);
	});

	it("refreshes stale registry statuses from plan files when listing plans", async () => {
		const service = await createService();
		const created = await service.createOrUpdatePlanForComposer({
			composerId: "task-status-refresh",
			response: "## Status Refresh\n\nEnsure registry status is current.",
			taskProgress: "- [x] Inspect\n- [ ] Verify",
			workspacePath: tempDir,
		});
		assert.equal(created.status, "pending");

		const registryPath = path.join(tempDir!, "composer.planRegistry.json");
		const registryRaw = await fs.readFile(registryPath, "utf8");
		const registry = JSON.parse(registryRaw) as {
			version: number;
			plans: Array<{ id: string; status: string }>;
		};
		assert.equal(registry.plans.length, 1);
		registry.plans[0].status = "in_progress";
		await fs.writeFile(`${registryPath}`, `${JSON.stringify(registry, null, 2)}\n`);

		const [listed] = await service.listPlans(tempDir);
		assert.equal(listed.status, "pending");

		const refreshedRaw = await fs.readFile(registryPath, "utf8");
		const refreshed = JSON.parse(refreshedRaw) as {
			version: number;
			plans: Array<{ id: string; status: string }>;
		};
		assert.equal(refreshed.plans[0].status, "pending");
	});

	it("refreshes stale generic registry names from plan metadata when listing plans", async () => {
		const service = await createService();
		const created = await service.createOrUpdatePlanForComposer({
			composerId: "task-name-refresh",
			response: "## Goal\n\nCreate a better plan title from metadata overview.",
			taskProgress: "- [ ] Inspect\n- [ ] Verify",
			workspacePath: tempDir,
		});
		await service.updatePlan({
			planId: created.planId,
			planPath: created.planPath,
			metadata: {
				...created.metadata,
				name: "Goal",
				overview:
					"Improve browse and playback performance for the Android TV app.",
			},
			body: created.body,
			workspacePath: tempDir,
		});

		const registryPath = path.join(tempDir!, "composer.planRegistry.json");
		const registryRaw = await fs.readFile(registryPath, "utf8");
		const registry = JSON.parse(registryRaw) as {
			version: number;
			plans: Array<{ id: string; name: string }>;
		};
		assert.equal(registry.plans.length, 1);
		registry.plans[0].name = "Goal";
		await fs.writeFile(`${registryPath}`, `${JSON.stringify(registry, null, 2)}\n`);

		const [listed] = await service.listPlans(tempDir);
		assert.equal(
			listed.name,
			"Improve browse and playback performance for the Android TV app",
		);
	});

	it("syncs active local build task_progress back into the shared plan file", async () => {
		const service = await createService();
		const plan = await service.createOrUpdatePlanForComposer({
			composerId: "task-build-source",
			response: "## Build Sync\n\nTrack build progress.",
			taskProgress: "- [ ] Inspect\n- [ ] Implement",
			workspacePath: tempDir,
		});

		const registration = await service.registerBuild({
			planId: plan.planId,
			builderId: "task-build-runner",
			mode: "agent",
			workspacePath: tempDir,
		});
		assert.equal(registration.plan.metadata.todos[0].status, "in_progress");
		assert.equal(registration.plan.status, "in_progress");

		const [synced] = await service.syncBuildTaskProgress({
			builderId: "task-build-runner",
			taskProgress: "- [x] Inspect\n- [x] Implement",
			workspacePath: tempDir,
		});

		assert.equal(synced.planId, plan.planId);
		assert.deepEqual(
			synced.metadata.todos.map((todo) => todo.status),
			["completed", "completed"],
		);
		assert.equal(synced.status, "complete");
		assert.equal(synced.completedTodoCount, 2);
		assert.match(await fs.readFile(plan.planPath, "utf8"), /status: completed/);

		const [registryEntry] = await service.listPlans(tempDir);
		assert.equal(registryEntry.status, "complete");
		assert.equal(registryEntry.builtBy[0].status, "complete");
	});

	it("emits plan change events so native plan views refresh immediately", async () => {
		const service = await createService();
		const events: PlanChangeEvent[] = [];
		const subscription = registerPlanChangeHandler((event) =>
			events.push(event),
		);

		const first = await service.createOrUpdatePlanForComposer({
			composerId: "task-refresh",
			response: "## Refresh Plan\n\nInitial.",
			taskProgress: "- [ ] Inspect",
			workspacePath: tempDir,
		});
		await service.createOrUpdatePlanForComposer({
			composerId: "task-refresh",
			response: "## Refresh Plan\n\nUpdated.",
			taskProgress: "- [ ] Inspect\n- [ ] Verify",
			workspacePath: tempDir,
		});
		subscription.dispose();

		assert.deepEqual(
			events.map((event) => event.kind),
			["created", "updated"],
		);
		assert.deepEqual(
			events.map((event) => event.planPath),
			[first.planPath, first.planPath],
		);
	});

	it("updates todo statuses through the shared plan file", async () => {
		const service = await createService();
		const plan = await service.createOrUpdatePlanForComposer({
			composerId: "task-456",
			response: "## Plan",
			taskProgress: "- [ ] Inspect\n- [ ] Implement",
			workspacePath: tempDir,
		});

		const updated = await service.updateTodoStatus({
			planId: plan.planId,
			todoIds: [plan.metadata.todos[0].id],
			status: "in_progress",
			workspacePath: tempDir,
		});

		assert.equal(updated.metadata.todos[0].status, "in_progress");
		assert.equal(updated.status, "in_progress");
		assert.equal(
			service.planToTaskProgress(updated),
			"- [ ] Inspect\n- [ ] Implement",
		);
	});

	it("edits frontmatter todos from native plan editor actions", async () => {
		const service = await createService();
		const plan = await service.createOrUpdatePlanForComposer({
			composerId: "task-editor",
			response: "## Plan",
			taskProgress: "- [ ] Inspect files\n- [ ] Implement patch",
			workspacePath: tempDir,
		});

		const renamed = await service.updateTodoContent({
			planId: plan.planId,
			todoId: plan.metadata.todos[0].id,
			content: "Search and rank likely files",
			workspacePath: tempDir,
		});
		assert.equal(
			renamed.metadata.todos[0].content,
			"Search and rank likely files",
		);

		const split = await service.splitTodo({
			planId: plan.planId,
			todoId: renamed.metadata.todos[1].id,
			beforeContent: "Implement",
			afterContent: "Verify",
			workspacePath: tempDir,
		});
		assert.equal(split.metadata.todos.length, 3);
		assert.equal(split.metadata.todos[1].content, "Implement");
		assert.equal(split.metadata.todos[2].content, "Verify");

		const merged = await service.mergeTodoBackward({
			planId: plan.planId,
			todoId: split.metadata.todos[2].id,
			workspacePath: tempDir,
		});
		assert.equal(merged.metadata.todos.length, 2);
		assert.equal(merged.metadata.todos[1].content, "Implement Verify");

		const removed = await service.removeTodoIds({
			planId: plan.planId,
			todoIds: [merged.metadata.todos[0].id],
			workspacePath: tempDir,
		});
		assert.equal(removed.metadata.todos.length, 1);
		assert.equal(removed.metadata.todos[0].content, "Implement Verify");
	});

	it("recovers legacy to-do sections when frontmatter is absent", async () => {
		const service = await createService();
		const legacyPath = path.join(tempDir!, "legacy.plan.md");
		await fs.writeFile(
			legacyPath,
			"# Legacy Plan\n\n### To-dos\n\n- [x] Existing\n- [ ] Remaining\n\n## Notes\nDone.",
			"utf8",
		);

		const plan = await service.readPlan({
			planPath: legacyPath,
			workspacePath: tempDir,
		});

		assert.equal(plan.metadata.todos.length, 2);
		assert.equal(plan.metadata.todos[0].content, "Existing");
		assert.equal(plan.metadata.todos[0].status, "completed");
		assert.equal(plan.metadata.todos[1].status, "pending");
	});

	it("sanitizes common unquoted colon values in frontmatter", async () => {
		const service = await createService();
		const malformedPath = path.join(tempDir!, "malformed.plan.md");
		await fs.writeFile(
			malformedPath,
			"---\nname: Fix: Plan\noverview: API: local only\ntodos:\n  - id: todo-a\n    content: Read: file\n    status: pending\n    dependencies: []\nisProject: false\n---\n\nBody",
			"utf8",
		);

		const plan = await service.readPlan({
			planPath: malformedPath,
			workspacePath: tempDir,
		});

		assert.equal(plan.metadata.name, "Fix: Plan");
		assert.equal(plan.metadata.overview, "API: local only");
		assert.equal(plan.metadata.todos[0].content, "Read: file");
	});
});
