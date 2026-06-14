# Codie Cursor-Parity Validation Checklist

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

## Current Evidence Snapshot

Snapshot date: 2026-06-15. This is a working-tree evidence snapshot, not a release approval. The worktree currently has uncommitted changes, `CODEVIBE_ALL_PARITY_VALIDATED` is not true, and `CODEVIBE_PARITY_EVIDENCE_URL` is not set to a final `https://` checklist or validation log.

| Requirement | Current evidence | Release status |
| --- | --- | --- |
| ChatGPT auth fix | Focused OAuth/provider/SDK originator tests passed on 2026-06-12 after the Codie originator update. Keep the broader auth gate green before release, but the prior `expected 'codie' to equal 'cline'` blocker is reconciled. | Focused guard passed |
| VSIX install presence | `node apps/vscode/scripts/package-github-vsix.mjs --out-dir /private/tmp/codevibe-vsix --install --verify-install` packaged `/private/tmp/codevibe-vsix/codevibe-3.88.77.vsix`, installed it, and smoke-verified `atnumridha.codevibe@3.88.77` on 2026-06-15. | Installed extension present |
| Branding audit | `npm --prefix apps/vscode run branding:audit` passed on 2026-06-15. The audit scans the standalone hub surfaces under `apps/cline-hub`, including `apps/cline-hub/src/webview/src/lib/provider-display.ts`. | Guard passed |
| Compatibility contracts | `npm --prefix apps/vscode run compatibility:contracts` passed on 2026-06-12. | Guard passed |
| VSIX release preflight | `npm --prefix apps/vscode run package:github-vsix:preflight` passed on 2026-06-11 with 3 warnings: dirty worktree, missing `CODEVIBE_ALL_PARITY_VALIDATED=true`, and missing final `CODEVIBE_PARITY_EVIDENCE_URL`. | Preflight-ready only |
| Hub branding | `provider-display.ts` maps visible first-party labels to `Codie Agent`, `Codie Local CLI`, and `Codie Cloud`, and the branding audit requires those hub fragments while blocking visible upstream Cline/CodeVibe labels. | Guard passed |
| Plan files and native editor | Focused tests passed on 2026-06-15 for `PlanStorageService`, `PlanModeRespondHandler`, and `Hostbridge - Workspace - searchWorkspaceText`. Plan responses persist `.plan.md` files, register a VS Code-native opener for `codevibe.planEditor`, refresh the native Plans view on storage change events, show the actual `*.plan.md` filename in the plan card, and write `.cursor/.gitignore` with `plans/` when falling back to workspace storage. | Focused guard passed |
| Retrieval/indexed search | `Hostbridge - Workspace - searchWorkspaceText` test passed on 2026-06-15 and asserts VS Code `findTextInFiles` is used without enumerating/reading candidate files before search. | Focused guard passed |
| Ranged file reads | Direct read-file test run passed on 2026-06-15. `ReadFileToolHandler` streams Plan-mode and explicit line-range reads through a text line-window path, and the guard reads selected lines from a text file larger than the old full-extraction limit. | Focused guard passed |
| Standalone runtime assets | `npm --prefix apps/vscode run release:cursor-parity:evidence:standalone`, `npm --prefix apps/vscode run release:standalone:assets`, and `npm --prefix apps/vscode run smoke:standalone-package` passed on 2026-06-15. Current artifacts: `apps/vscode/dist-standalone/standalone.zip`, `apps/vscode/dist-standalone/standalone-manifest.json`, and `apps/vscode/dist-standalone/standalone.zip.sha256` with SHA-256 `b2b17ada4f59da3a9a81c8f2c4ef2911178c1870cb94bc1493b88bda0ca202d3`. The smoke extracted the zip, used `standalone-manifest.json`, launched `codevibe-core.js` with Node `22.21.1`, and reached ProtoBus/HostBridge health on loopback ports. | Runtime guard passed; desktop-shell visual pass still needed |
| Full evidence run | No current green `npm --prefix apps/vscode run release:cursor-parity:evidence:full` result is recorded. Existing local evidence can be useful context but is not a final gate. | Open gap |
| Installed VS Code visual validation | The active VS Code window rendered the `CODIE AGENT` sidebar and composer after reload; screenshot evidence: `/private/tmp/codie-code-app-activated.png`. `npm run test:e2e:optimal -- src/test/e2e/native-chat-installed.test.ts --project "e2e tests"` passed on 2026-06-12 and verified installed VSIX command exposure. Native session invocation, prompt/skill discovery, model/account visibility, approvals, MCP, browser automation, retrieval, background agents, sandbox policy, and deeplink flows still need recorded installed-VS-Code evidence. | Partially validated |
| Upstream patch intake | Upstream intake reports are generated under `.codevibe/upstream-base/<profile>/` and ignored by git. The planner now avoids stale `FETCH_HEAD`/local-branch false zero-delta reports unless the current invocation fetched the upstream ref. | Planning workflow guarded; overlay review still required |

## Required Commands

Record command output or CI links for each item.

```sh
git status --short --branch
node apps/vscode/scripts/package-github-vsix.mjs --preflight
npm --prefix apps/vscode ci --include=optional
npm --prefix apps/vscode/webview-ui ci --include=optional
npm --prefix apps/vscode run check-types
npm --prefix apps/vscode run lint
npm --prefix apps/vscode run branding:audit
npm --prefix apps/vscode run compatibility:contracts
npm --prefix apps/vscode run test:unit
npm --prefix apps/vscode run test:e2e:optimal
npm --prefix apps/vscode run package:github-vsix -- --verify-install
npm --prefix apps/vscode run release:standalone:assets
git diff --check
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

Current install-presence evidence: on 2026-06-15, `node apps/vscode/scripts/package-github-vsix.mjs --out-dir /private/tmp/codevibe-vsix --install --verify-install` installed and smoke-verified `atnumridha.codevibe@3.88.77`. The earlier active VS Code window rendered the `CODIE AGENT` sidebar and composer after reload; screenshot evidence: `/private/tmp/codie-code-app-activated.png`. This proves install presence and basic sidebar/composer rendering; it does not prove the full visual/manual checklist below.

Manual checks:

- Codie sidebar opens and renders the chat/composer.
- Native Codie prompt files are discoverable from VS Code Chat and target the Codie Agent session.
- Native Codie chat skills are discoverable from VS Code Chat and target the Codie Agent session.
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
- Disabling `codevibe.compatibility.deepLinks.enabled` blocks compatible URI handling from external and webview launch paths.

## Standalone UI Validation

- `standalone.zip` artifact: `apps/vscode/dist-standalone/standalone.zip` (54 MB, generated 2026-06-15).
- `standalone.zip.sha256` checksum: `apps/vscode/dist-standalone/standalone.zip.sha256`.
- `standalone-manifest.json` artifact: `apps/vscode/dist-standalone/standalone-manifest.json`.
- SHA-256 verification passed: `b2b17ada4f59da3a9a81c8f2c4ef2911178c1870cb94bc1493b88bda0ca202d3`.
- Extracted runtime smoke command: `npm --prefix apps/vscode run smoke:standalone-package`.
- Extracted runtime smoke output/log: passed on 2026-06-15; extracted `/Users/atanumridha/Documents/VibeCode/apps/vscode/dist-standalone/standalone.zip` to a temp install, launched `codevibe-core.js` with Node `22.21.1`, resolved `binaries/darwin-arm64/node_modules` plus package `node_modules`, and reached ProtoBus/HostBridge health.
- Desktop app launches without VS Code: runtime core launch passed from extracted package; full desktop-shell visual validation still needs recorded UI evidence.
- Extracted `standalone.zip` launches from the extracted package using `standalone-manifest.json`: passed via `smoke:standalone-package`.
- Existing Codex auth state is detected from the configured Codex home.
- Cursor URI preview and launch work from the standalone settings UI.
- Browser controls, retrieval/indexing controls, background-agent sessions, MCP import/install, plugin add/replace, rule review, git helpers, and NDJSON ingest are visible and functional.
- Secret-bearing URL query strings, tokens, headers, and config values are redacted from previews, logs, and UI metadata.

## Release Decision

- All local checks passed:
- All CI checks passed:
- VSIX install smoke passed:
- Manual installed-VS-Code validation passed:
- Standalone runtime assets and extracted smoke passed: yes, focused runtime guard passed on 2026-06-15.
- Standalone UI validation passed: partial; runtime/package/hub route evidence passed, full desktop-shell visual validation remains open.
- Known residual risks: current open items include the missing full evidence run, remaining installed-VS-Code visual checks beyond sidebar/composer, standalone desktop-shell visual validation, and manual review of the generated upstream intake report's overlay risk areas.
- Release approver:

Only after this section is complete may the release job be dispatched with:

```sh
export CODEVIBE_ALL_PARITY_VALIDATED=true
export CODEVIBE_PARITY_EVIDENCE_URL="https://github.com/<owner>/<repo>/issues/<id>"
```
