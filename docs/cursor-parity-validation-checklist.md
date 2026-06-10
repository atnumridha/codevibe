# CodeVibe Cursor-Parity Validation Checklist

Use this checklist as the evidence target for `CODEVIBE_PARITY_EVIDENCE_URL` before any GitHub Release, marketplace publish, or release-gated local VSIX packaging. Do not set `CODEVIBE_ALL_PARITY_VALIDATED=true` until every required item below has concrete evidence.

## Release Candidate

- Branch:
- Commit SHA:
- VSIX version:
- Release tag:
- VS Code version:
- Operating system:
- Evidence owner:
- Validation date:

## Required Commands

Record command output or CI links for each item.

```sh
git status --short --branch
node apps/vscode/scripts/package-github-vsix.mjs --preflight
npm --prefix apps/vscode ci --include=optional
npm --prefix apps/vscode/webview-ui ci --include=optional
npm --prefix apps/vscode run check-types
npm --prefix apps/vscode run lint
npm --prefix apps/vscode run test:unit
npm --prefix apps/vscode run test:e2e:optimal
npm --prefix apps/vscode run package:github-vsix -- --verify-install
npm --prefix apps/vscode run release:standalone:assets
```

Also record the extracted runtime smoke command and output. The evidence must show the command extracted `apps/vscode/dist-standalone/standalone.zip`, read `standalone-manifest.json` from the extracted package, used the manifest launch fields, and started the runtime from the extracted directory.

To capture a baseline evidence log before the full local toolchain is available, run the safe collector. It exits nonzero while any required gate is missing or skipped.

```sh
node apps/vscode/scripts/collect-cursor-parity-evidence.mjs || true
```

In a dependency-equipped checkout, use the full collector to run the required local dependency, build, test, e2e, package, and VSIX install commands and write a Markdown evidence log:

```sh
npm --prefix apps/vscode run release:cursor-parity:evidence:full
```

If `code` is not on `PATH`, record the explicit VS Code CLI path used:

```sh
CODEVIBE_VSCODE_CLI="/path/to/code" npm --prefix apps/vscode run package:github-vsix -- --verify-install
```

## CI Gates

- `ext-vscode-test.yml` result:
- `ext-vscode-test-e2e.yml` result:
- GitHub-only release dry run or packaging run:
- Standalone runtime assets and extracted runtime smoke result:
- Marketplace workflow dry run, if marketplace publishing is planned:

## Installed VS Code Validation

Install the packaged VSIX into a normal VS Code profile and record the exact command and output.

```sh
code --install-extension apps/vscode/dist/codevibe-<version>.vsix --force
code --list-extensions --show-versions | rg '^atnumridha\.codevibe@'
```

Manual checks:

- CodeVibe sidebar opens and renders the chat/composer.
- `openai-codex` is the default Plan provider and Act provider.
- Codex auth imports from `~/.codex/auth.json` without logging token values.
- Codex account, installation id, and model list are visible without exposing secrets.
- Plan mode explores first, produces a concrete plan, and does not edit files when strict Plan mode is enabled.
- Act mode can apply a multi-file diff and show reviewable changes.
- Terminal command approvals are shown and respected.
- MCP install flow works, including OAuth callback handling when applicable.
- Browser automation can launch, snapshot, click, type, and screenshot with configured privacy controls.
- Retrieval/indexing honors `.cursorignore`, `.cursorindexingignore`, and privacy gates.
- Background-agent launch creates the expected branch/worktree/session metadata.
- Cursor rules are imported from `.cursorrules` and `.cursor/rules`.
- Cursor MCP config imports from `.cursor/mcp.json`.
- Cursor sandbox policy imports from `.cursor/sandbox.json`.
- Cursor-compatible deeplinks validate and require confirmations for sensitive actions:
  - `/createchat`
  - `/mcp/install`
  - `/background-agent`
  - `/settings`
  - `/prompt`
  - `/command`
  - `/rule`
  - `/pr-review`
  - `/plugin/add`
  - `/glass`
  - `/automation/ingest`
  - `/git/checkout`
  - `/git/branch`
  - `/git/commit`
- `/plugin/add?replace=true` replaces only after confirmation.
- Disabling `cline.cursorCompatibility.deepLinks.enabled` blocks Cursor-compatible URI handling from external and webview launch paths.

## Standalone UI Validation

- `standalone.zip` artifact:
- `standalone.zip.sha256` checksum:
- `standalone-manifest.json` artifact:
- SHA-256 verification passed:
- Extracted runtime smoke command:
- Extracted runtime smoke output/log:
- Desktop app launches without VS Code.
- Extracted `standalone.zip` launches from the extracted package using `standalone-manifest.json`.
- Existing Codex auth state is detected from the configured Codex home.
- Cursor URI preview and launch work from the standalone settings UI.
- Browser controls, retrieval/indexing controls, background-agent sessions, MCP import/install, plugin add/replace, rule review, git helpers, and NDJSON ingest are visible and functional.
- Secret-bearing URL query strings, tokens, headers, and config values are redacted from previews, logs, and UI metadata.

## Release Decision

- All local checks passed:
- All CI checks passed:
- VSIX install smoke passed:
- Manual installed-VS-Code validation passed:
- Standalone runtime assets and extracted smoke passed:
- Standalone UI validation passed:
- Known residual risks:
- Release approver:

Only after this section is complete may the release job be dispatched with:

```sh
export CODEVIBE_ALL_PARITY_VALIDATED=true
export CODEVIBE_PARITY_EVIDENCE_URL="https://github.com/<owner>/<repo>/issues/<id>"
```
