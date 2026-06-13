---
name: plan
description: Explore the repository and create a Codie implementation plan before editing.
agent: Codie Agent
argument-hint: Describe the feature, bug, migration, or research question.
---

Plan this Codie task before editing.

Explore the relevant files first, identify risks and existing patterns, then produce a concise implementation checklist. For non-trivial work, include a fenced `mermaid` diagram that shows the implementation flow, dependency flow, state transition, or agent handoff. If a diagram would add no value, say why in one sentence.

Call out terminal intent in the plan: which commands can run sandboxed, which require elevated trust, and which commands should wait for explicit approval. Use available skills, instructions, hooks, MCP tools, and subagents when they fit the request, then summarize how each one changes the plan. Keep destructive actions, installs, network calls, browser automation, MCP changes, and git writes behind explicit approval. If the task is safe and well scoped, say what should happen next in Act mode.
