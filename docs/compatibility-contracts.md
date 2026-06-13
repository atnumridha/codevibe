# Compatibility Contracts

This repository intentionally keeps a small set of stable internal identifiers and compatibility aliases so upstream bases and import-compatible integrations can be rebased without breaking installed users, generated code, or host integrations.

Do not rename these contracts during upstream merges unless the migration includes explicit compatibility shims, data migration, release notes, and an update to `apps/vscode/scripts/check-compatibility-contracts.mjs`.

## Stable extension and agent IDs

- VS Code extension id: `atnumridha.codevibe`, built from `publisher: "atnumridha"` and `name: "codevibe"` in `apps/vscode/package.json`.
- Extension command, menu, configuration, and context namespaces must continue to use the `codevibe.` prefix.
- Activity bar container id: `codevibe-agent`.
- Chat session id and type: `codevibe-agent`.
- Chat participant id: `codevibe`.
- Agent definition path: `apps/vscode/agents/00-codevibe-agent.agent.md`.

The display name may evolve, but these IDs are storage keys and routing keys. Renaming them strands VS Code view state, chat sessions, commands, settings, and user habits.

## Core runtime naming

- Use `CodieCore` as the canonical public SDK export and user-facing name for the shared core runtime in docs, release notes, and UI copy.
- Keep `ClineCore` and `@cline/*` package names as compatibility contracts for existing imports, packages, generated code, and upstream merge stability.

Treat `ClineCore` and `@cline/*` as internal or compatibility names, not product prose, unless the surrounding text is explicitly documenting migration or compatibility behavior. New examples should import `CodieCore` from `@cline/sdk` / `@cline/core`; existing `ClineCore` imports must continue to work.

## Proto package and import names

- Keep protobuf sources under `apps/vscode/proto/cline`.
- Keep generated TypeScript imports under `@shared/proto/cline/...`.
- Keep lint, generation, and staged proto tooling pointed at `proto/cline`.

The `cline` proto package path is a wire/build compatibility layer. Codie branding should not rename the proto package path.

## Provider IDs

- Keep the OpenAI Codex provider id as `openai-codex`.
- Keep the Cline provider id as `cline`.
- Keep these IDs present in both `apps/vscode/src/shared/providers/providers.json` and `sdk/packages/llms/src/providers/builtins.ts`.

Provider IDs are persisted in settings, task metadata, model selection, tests, and external provider references. Display labels can change without changing these IDs.

## Import Compatibility Paths and Aliases

Import-compatible inputs are intentional product surface and must survive upstream merges:

- Deep link protocols and host aliases: `cursor:`, `codevibe:`, `anysphere.cursor-deeplink`, `anysphere.cursor-mcp`, `atnumridha.codevibe`, `cline.cline`, and `codevibe`.
- Deep link paths: `/createchat`, `/mcp/install`, `/background-agent`, `/settings`, `/prompt`, `/command`, `/rule`, `/pr-review`, `/plugin/add`, `/glass`, `/automation/ingest`, `/git/checkout`, `/git/branch`, and `/git/commit`.
- Compatibility commands: legacy `cursor.ndjsonIngest.*` and `cursor-deeplink.debug.triggerDeeplink` commands, plus canonical `codevibe.compatibility.*` commands.
- Settings aliases: canonical `codevibe.compatibility.*` settings and legacy `codevibe.cursorCompatibility.*` settings.
- Workspace files and directories: canonical `.codie/sandbox.json`, plus compatibility `.cursorrules`, `.cursor/rules`, `.cursor/commands`, `.cursorignore`, `.cursorindexingignore`, `.cursor/mcp.json`, and `.cursor/sandbox.json`.
- Settings URI aliases in `SharedUriHandler`: `cursor-compatibility`, `cursor-links`, `deep-links`, `deeplinks`, `retrieval-indexing`, `indexing`, `privacy-gate`, `sandbox`, `sandbox-policy`, `codex-auth`, `openai-codex-auth`, `openai-codex`, `codex`, `browser-evaluate`, and `safe-browser-evaluate`.

These are compatibility shims for users, scripts, docs, and external tools that already speak legacy or import-compatible paths or URIs.

## Branding Audit Scope

Codie is the visible agent and hub product name. `apps/vscode/scripts/check-codevibe-branding.mjs` blocks legacy visible brand copy in the VS Code extension and also samples high-risk hub/CLI entry points that are easy to regress during upstream merges:

- VS Code manifest, marketplace README, walkthrough, extension host entry points, hooks, report-bug UI, webview source, and packaged VSIX manifest/package metadata.
- Codie Agent Hub startup logs, HTML shell title, webview title, ready status, client display names, readiness payload, approval messages, MCP completion copy, and provider display names.
- CLI command help, ACP auth provider copy, dashboard launch output, schedule wizard prompt, and Cursor-compatible background-agent route client/source IDs.

The branding audit must allow stable compatibility identifiers where they are routing, storage, package, command, provider, protocol, or import contracts rather than product prose. That allowlist includes lowercase `codevibe` command and extension IDs, `ClineCore` references used as compatibility names, `@cline/*` package imports, proto paths under `proto/cline` and `@shared/proto/cline`, the persisted `cline` provider id, hidden legacy `~/.cline` paths, Cursor-compatible URI/routes/settings, and exact CLI shell labels that still describe the `codevibe` executable or compatibility bridge.

## Guardrail

Run this check after upstream merges and before release packaging:

```sh
npm --prefix apps/vscode run compatibility:contracts
npm --prefix apps/vscode run branding:audit
```

The compatibility script is intentionally lightweight. It asserts that key literals remain present in the files that own each contract. The branding audit is broader: it scans visible source/docs/artifact text for stale legacy copy while preserving the compatibility names listed above.
