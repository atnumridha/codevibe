---
name: codevibe-background-sessions
description: Use when creating, resuming, reviewing, or debugging CodeVibe background-agent sessions, branches, worktrees, checkpoints, or git helper flows.
---

# CodeVibe Background Sessions

Use this skill when work should continue in a background session, branch, or worktree.

## Workflow

1. Identify the workspace, branch, target base, and whether a new worktree is needed.
2. Confirm before creating branches, checking out refs, committing, pushing, or running destructive git commands.
3. Keep session metadata, checkpoint state, and git status visible.
4. Preserve user changes. Never reset or overwrite unrelated work.
5. For review tasks, summarize the diff, tests, and remaining risks before suggesting a commit or push.

## Validation

Use focused background-agent, git route, checkout, branch, and commit helper tests when changing this behavior. For release evidence, include installed VS Code validation and standalone route validation.
