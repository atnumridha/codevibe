# Codie

Codie is an editor-native coding agent for VS Code with Codie sign-in, optional local auth import, planning-first task execution, MCP, browser automation, retrieval controls, worktrees, background workstreams, and deep-link compatibility.

## What Codie Does

- Uses Codie sign-in by default and can import `~/.codex/auth.json`, `~/.codex/installation_id`, and local model metadata when compatibility support is enabled.
- Plans before acting, explores the workspace, and shows progress while it works.
- Reads, edits, and reviews files through VS Code-native diffs and approval flows.
- Runs terminal commands with human-in-the-loop controls and auto-approval policies.
- Connects MCP servers, browser tools, retrieval/indexing controls, rules, skills, hooks, and worktrees.
- Accepts project compatibility inputs such as Codie rules, ignore files, retrieval-indexing ignores, MCP configs, sandbox policies, NDJSON ingest, and compatible deep links.

## Getting Started

1. Install Codie from the packaged VSIX or GitHub release.
2. Complete Codie sign-in, or keep local auth files available when compatibility import is enabled.
3. Run **Codie: Open Codie** from the command palette.
4. Start with a task such as “review this repo and suggest the first safe improvement.”

Codie opens the native Codie Agent sidebar by default and keeps the compatibility webview available only for fallback flows that still depend on the older VS Code webview host.

## Safety

Codie keeps you in control with Plan/Act behavior, explicit file diffs, terminal approvals, sandbox policy settings, retrieval privacy gates, and safe browser-evaluate controls.

## Compatibility

Codie keeps selected upstream-derived internal names and compatibility paths so new upstream changes can still be patched into this fork cleanly. Public package identity, user-facing commands, installed VSIX metadata, and release artifacts are Codie-first.

## Links

- Repository: [github.com/atnumridha/codevibe](https://github.com/atnumridha/codevibe)
- Issues: [github.com/atnumridha/codevibe/issues](https://github.com/atnumridha/codevibe/issues)
- Releases: [github.com/atnumridha/codevibe/releases](https://github.com/atnumridha/codevibe/releases)

## License

[Apache 2.0](./LICENSE). Codie includes Apache-licensed upstream components and keeps required attribution in the source distribution.
