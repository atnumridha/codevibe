# CodeVibe

CodeVibe is a Cursor-parity coding agent for VS Code with Codex auth by default, planning-first task execution, MCP, browser automation, retrieval controls, worktrees, background workstreams, and deep-link compatibility.

## What CodeVibe Does

- Uses `~/.codex/auth.json`, `~/.codex/installation_id`, and Codex model metadata by default when available.
- Plans before acting, explores the workspace, and shows progress while it works.
- Reads, edits, and reviews files through VS Code-native diffs and approval flows.
- Runs terminal commands with human-in-the-loop controls and auto-approval policies.
- Connects MCP servers, browser tools, retrieval/indexing controls, rules, skills, hooks, and worktrees.
- Accepts Cursor-compatible inputs such as `.cursorrules`, `.cursor/rules`, `.cursorignore`, `.cursorindexingignore`, `.cursor/mcp.json`, `.cursor/sandbox.json`, NDJSON ingest, and compatible deep links.

## Getting Started

1. Install CodeVibe from the packaged VSIX or GitHub release.
2. Keep your Codex auth in `~/.codex/auth.json`.
3. Run **CodeVibe: Open CodeVibe** from the command palette.
4. Start with a task such as “review this repo and suggest the first safe improvement.”

CodeVibe opens the Codex-native sidebar by default and keeps the legacy compatibility webview available only for flows that still need it while the UI is being rebuilt.

## Safety

CodeVibe keeps you in control with Plan/Act behavior, explicit file diffs, terminal approvals, sandbox policy settings, retrieval privacy gates, and safe browser-evaluate controls.

## Compatibility

CodeVibe keeps selected upstream-derived internal names and compatibility paths so new upstream changes can still be patched into this fork cleanly. Public package identity, user-facing commands, installed VSIX metadata, and release artifacts are CodeVibe-first.

## Links

- Repository: [github.com/atnumridha/codevibe](https://github.com/atnumridha/codevibe)
- Issues: [github.com/atnumridha/codevibe/issues](https://github.com/atnumridha/codevibe/issues)
- Releases: [github.com/atnumridha/codevibe/releases](https://github.com/atnumridha/codevibe/releases)

## License

[Apache 2.0 © 2026 Cline Bot Inc.](./LICENSE)
