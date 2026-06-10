---
name: codevibe-customizations
description: Use when creating, reviewing, or fixing CodeVibe instructions, prompt files, agent files, hooks, rules, or skills.
---

# CodeVibe Customizations

Use this skill when the task involves customization files for the coding agent.

## Supported Files

- GitHub custom instruction files
- `.github/instructions/*.instructions.md`
- `.github/prompts/*.prompt.md`
- `.github/agents/*.agent.md`
- `.github/hooks/*.json`
- `.agents/skills/*/SKILL.md`
- `.cursor/rules/*`
- `.cursorrules`
- CodeVibe compatibility rules and workflow files

## Workflow

1. Identify whether the user needs always-on instructions, a reusable prompt, a specialist agent, a lifecycle hook, a rule file, or a skill.
2. Keep workspace-level files in the repository when they should be shared with the team.
3. Keep user-level files out of the repository unless the user explicitly asks for a shared template.
4. Validate YAML frontmatter, required names, descriptions, and any glob patterns.
5. Prefer short, specific descriptions because they control discovery.
6. After editing, run the narrowest relevant validation or explain why none is available.

## Guardrails

Do not add secrets to customization files. Do not create broad always-on instructions when a targeted prompt, rule, or skill would be cheaper and safer.
