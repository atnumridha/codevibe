import { describe, expect, it } from "vitest";
import { buildClineSystemPrompt } from "./cline";

describe("buildClineSystemPrompt", () => {
	it("adds Cursor-style planning and patch discipline to shared Cline prompts", () => {
		const prompt = buildClineSystemPrompt({
			workspaceRoot: "/tmp/codevibe",
			workspaceName: "codevibe",
			platform: "darwin",
			ide: "CLI",
			mode: "plan",
			providerId: "cline",
		});

		expect(prompt).toContain("5. Mode: plan");
		expect(prompt).toContain("Cursor-style agent workflow");
		expect(prompt).toContain("Explore before planning");
		expect(prompt).toContain("Apply/Diff Discipline");
		expect(prompt).toContain("# Workspace Configuration");
	});

	it("adds Cursor-style background workflow to yolo prompts", () => {
		const prompt = buildClineSystemPrompt({
			workspaceRoot: "/tmp/codevibe",
			platform: "linux",
			ide: "Hub",
			mode: "yolo",
			providerId: "cline",
		});

		expect(prompt).toContain("5. Mode: yolo");
		expect(prompt).toContain("Cursor-style background workflow");
		expect(prompt).toContain("Track progress internally");
		expect(prompt).toContain("Apply/Diff Discipline");
	});
});
