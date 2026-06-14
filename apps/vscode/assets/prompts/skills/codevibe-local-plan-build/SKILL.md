---
name: codevibe-local-plan-build
description: Use when creating, reviewing, rendering, or executing local-only Codie plans with todo lists, Mermaid diagrams, workspace plan files, retrieval context, or Build buttons.
---

# Codie Local Plan Build

Use this skill for Cursor-style plan flows that must remain local. The model should gather compact workspace context, produce a structured plan, keep todos visible, and execute only through the local Codie agent.

## Local-Only Rules

- Do not offer or route to Build in Cloud.
- Do not migrate plan execution to a remote/background cloud environment.
- Do not add cloud environment pickers, cloud status labels, or cloud feature gates to the plan tray.
- If parallel execution is offered, it must mean local subagents on the current machine.

## Required Extension Capabilities

- `codevibe-plan-files`: create, update, read, and delete `.cursor/plans/*.plan.md`.
- `codevibe-plan-editor`: show rich/raw plan views with markdown, todos, references, and diagrams.
- `codevibe-local-retrieval`: rank files and extract compact snippets while honoring `.gitignore`, `.cursorignore`, and `.cursorindexingignore`.
- `codevibe-local-agent-exec`: start approved plans through local Act mode and the existing approval pipeline.
- `codevibe-plan-todos`: store structured todo state and synchronize it with `task_progress`.
- `codevibe-mermaid`: render fenced `mermaid` blocks in plan markdown.
- `codevibe-canvas`: optional local `.canvas.tsx` artifacts for richer dashboards or plan status views.
- `codevibe-subagents`: optional local parallel todo execution.

## Workflow

1. Gather context with local search, file mentions, recent files, and focused file reads. Avoid sending whole-repository context.
2. Create a plan as structured data, including title, markdown body, references, and todos.
3. Save the plan under `.cursor/plans/*.plan.md` and ensure `.cursor/.gitignore` ignores `plans/`.
4. Render the plan with the existing markdown and Mermaid components.
5. Keep todos editable and synchronized with `task_progress`.
6. When the user chooses Build, switch to or start Act mode with the approved plan content.
7. Run terminal commands, edits, and validation only through the existing local approval and checkpoint boundaries.

## Build Controls

Allowed labels:

- Build
- Build Locally
- Build Selected
- Build in Parallel, only for local subagents

Disallowed labels:

- Build in Cloud
- Cloud build
- Migrate to cloud
- Remote environment

## Plan Tool Shape

The planning model should call structured tools rather than faking the plan UI as plain text.

```ts
type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled"

interface CreatePlanInput {
	title: string
	bodyMarkdown: string
	todos?: Array<{
		content: string
		status?: TodoStatus
		dependencies?: string[]
	}>
	references?: Array<{
		path: string
		startLine?: number
		endLine?: number
		why: string
	}>
}

interface ExecutePlanInput {
	planId: string
	todoIds?: string[]
	mode: "local" | "local_parallel"
}
```

Never introduce `cloud` as an execution mode.

## Validation

When changing plan behavior, add focused tests or evidence for:

- Plan files are written under `.cursor/plans/*.plan.md`.
- Mermaid diagrams render in plan markdown.
- Todo status transitions work for pending, in progress, completed, and cancelled states.
- Build dispatch starts local Act mode.
- Build Selected limits execution to selected todo ids.
- No plan UI exposes cloud labels or cloud execution paths.
