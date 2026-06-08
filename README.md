# CodeVibe

CodeVibe is a Codex-first coding agent for VS Code and standalone workflows. It uses the CodeVibe codebase as the product surface while keeping the shared upstream-compatible agent runtime easy to patch.

## What It Does

- Runs as a VS Code extension with a single CodeVibe editor panel.
- Defaults Plan and Act modes to OpenAI Codex.
- Reads Codex auth from `~/.codex/auth.json`, `~/.codex/installation_id`, and `~/.codex/models_cache.json`.
- Supports Plan/Act workflows, terminal approvals, multi-file diffs, checkpoints, rules, skills, hooks, MCP, browser automation, retrieval/indexing privacy gates, background agents, worktrees, and git helpers.
- Imports Cursor-compatible project inputs such as `.cursorrules`, `.cursor/rules`, `.cursorignore`, `.cursorindexingignore`, `.cursor/mcp.json`, and `.cursor/sandbox.json`.
- Provides standalone Hub surfaces so agent sessions can work outside VS Code while the next first-party UI is built.

## Repository Map

| Area | Purpose |
| --- | --- |
| `apps/vscode` | VS Code extension, webview UI, packaging, e2e tests, and VSIX release tooling. |
| `apps/cline-hub` | Standalone CodeVibe Hub web UI and server bridge. |
| `sdk/packages` | Shared agent runtime, LLM providers, tools, auth, MCP, browser, and automation support. |
| `apps/cli` | CLI runtime built on the same shared agent core. |
| `walkthrough` | VS Code walkthrough content shown to new extension users. |

## Local VSIX Build

```bash
node apps/vscode/scripts/package-github-vsix.mjs --out-dir /private/tmp/codevibe-vsix --install --verify-install
```

The packaged extension is written to `/private/tmp/codevibe-vsix/codevibe-3.88.0.vsix` by default.

## Cursor-Parity Evidence

Focused release evidence can be generated from `apps/vscode`:

```bash
npm --prefix apps/vscode run release:cursor-parity:evidence:fast
```

This validates retrieval/indexing privacy, MCP install/OAuth behavior, standalone UI readiness, and Cursor sandbox policy coverage. Full release candidates are published through GitHub Actions from `v*-rc.*` tags.

## Patchability

CodeVibe intentionally keeps upstream-compatible package and type boundaries inside the shared runtime. Visible product copy, icons, settings, and release artifacts are CodeVibe-branded; internal package names may remain stable so future upstream runtime changes can be merged without unnecessary churn.

## License

Apache 2.0. See [LICENSE](./LICENSE).
