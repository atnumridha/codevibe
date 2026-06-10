---
name: codevibe-cursor-compatibility
description: Use when importing, validating, or debugging Cursor-compatible rules, deeplinks, ignore files, sandbox policy, MCP config, plugin add routes, or automation ingest.
---

# CodeVibe Cursor Compatibility

Use this skill for compatibility work that makes CodeVibe behave correctly with Cursor-style inputs.

## Inputs To Check

- `.cursorrules`
- `.cursor/rules`
- `.cursorignore`
- `.cursorindexingignore`
- `.cursor/mcp.json`
- `.cursor/sandbox.json`
- Cursor-compatible URI routes such as `/createchat`, `/mcp/install`, `/background-agent`, `/settings`, `/prompt`, `/command`, `/rule`, `/pr-review`, `/plugin/add`, `/glass`, `/automation/ingest`, and git helper routes
- NDJSON automation ingest payloads

## Workflow

1. Parse structured files with the existing CodeVibe parsers instead of ad hoc string edits.
2. Verify privacy gates before retrieval, indexing, browser automation, or remote execution.
3. Require explicit confirmation for sensitive deeplinks, replacement installs, commands, network exposure, or git writes.
4. Preserve redaction for tokens, auth headers, query strings, and config values.
5. Add focused tests for any newly accepted route, schema field, or ignore-rule behavior.

## Validation

Run focused unit tests for Cursor URI routes, MCP install/import, sandbox policy, retrieval/indexing privacy, or NDJSON ingest when those areas change. Use the cursor-parity evidence collector for broader release evidence.
