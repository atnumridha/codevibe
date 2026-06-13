# Upstream Base Patch Intake

Codie keeps its ChatGPT-compatible auth, native agent placement, visible branding, packaging guards, and standalone UI bridge as product overlays on top of reusable upstream sources. Use this workflow when a new Cline, Cursor-style, AJCursorClone, VibeCode, or Copilot-compatible source drop needs review.

## Current State Snapshot

Snapshot date: 2026-06-12. This is not a completed upstream intake.

- Verified today: `npm --prefix apps/vscode run branding:audit`, `npm --prefix apps/vscode run compatibility:contracts`, focused ChatGPT OAuth/provider originator tests, and installed VSIX native command exposure passed.
- VSIX install presence was verified today with `node apps/vscode/scripts/package-github-vsix.mjs --out-dir /private/tmp/codevibe-vsix --install --verify-install`, which installed and smoke-verified `atnumridha.codevibe@3.88.77`. The active VS Code window also rendered the `CODIE AGENT` sidebar after reload; screenshot evidence: `/private/tmp/codie-code-app-activated.png`.
- ChatGPT auth must stay protected during upstream drops. The prior 2026-06-11 originator mismatch (`expected 'codie' to equal 'cline'`) has focused passing coverage as of 2026-06-12, but the broader release gate still needs a clean full auth/provider run before publishing.
- The full cursor-parity evidence run is still missing: no current green `npm --prefix apps/vscode run release:cursor-parity:evidence:full` result is recorded.
- Upstream intake reports are generated under `.codevibe/upstream-base/<profile>/` and ignored by git; do not commit local intake reports. The planner avoids stale `FETCH_HEAD`/local-branch false zero-delta reports unless the current invocation fetched the upstream ref.
- Hub branding is now part of the local branding guard for server/webview/settings/AI-element surfaces; keep adding specific hub paths when new visible standalone UI areas are introduced.

## Plan A Drop

Start from a clean worktree on a Codie branch. The default profile is `cline`:

```sh
npm --prefix apps/vscode run upstream:base:fetch -- --upstream-ref main
```

For a tag or specific ref:

```sh
npm --prefix apps/vscode run upstream:base:fetch -- --upstream-ref vX.Y.Z
```

List available source profiles:

```sh
npm --prefix apps/vscode run upstream:base:plan -- --list-profiles
```

Use local AJCursorClone directly:

```sh
npm --prefix apps/vscode run upstream:base:plan -- --profile ajcursorclone --fetch --write-report --allow-dirty
```

To override the default `~/Downloads/AJCursorClone` location:

```sh
CODEVIBE_AJCURSORCLONE_PATH=/path/to/AJCursorClone \
  npm --prefix apps/vscode run upstream:base:plan -- --profile ajcursorclone --fetch --write-report
```

Use another Cursor-style local checkout:

```sh
CODEVIBE_CURSOR_UPSTREAM_PATH=/path/to/cursor-like/repo \
  npm --prefix apps/vscode run upstream:base:plan -- --profile cursor-local --fetch --write-report
```

Use a local Copilot-compatible source drop:

```sh
CODEVIBE_COPILOT_UPSTREAM_PATH=/path/to/copilot-like/repo \
  npm --prefix apps/vscode run upstream:base:plan -- --profile copilot-local --fetch --write-report
```

Use the VibeCode upstream repo:

```sh
npm --prefix apps/vscode run upstream:base:plan -- --profile vibecode --fetch --write-report
```

Local profile reports are written under `.codevibe/upstream-base/<profile>/`. The command records a `schemaVersion`, selected profile, source kind, source URL/path, resolved commit, merge-base status, and whether a no-merge-base tree inventory was used. If a profile remote already exists with a different URL/path, the script fails; pass `--update-remote-url` only after confirming the intended source.

The report includes:

- upstream profile, source URL/path, commit, and merge-base
- changed files grouped into patch layers
- Codie overlay risk summary with critical/high/medium review areas
- Codie overlay files that must be preserved or re-applied
- guard commands to run after each layer, final VSIX validation commands, and GitHub release prerequisite checks

Reports generated with `--allow-dirty` are planning-only evidence. Do not cite a dirty-worktree intake report as release evidence, and do not treat it as proof that Codie overlays are cleanly preserved until the same intake and validation commands pass from a clean worktree.

## Apply In Layers

Create a dedicated branch before applying changes:

```sh
git switch -c codex/upstream-base-vX.Y.Z
```

Apply one layer at a time. Keep Codie overlays intact, especially:

- `apps/vscode/package.json`
- `apps/vscode/scripts/package-github-vsix.mjs`
- `apps/vscode/scripts/check-codevibe-branding.mjs`
- `apps/vscode/scripts/check-compatibility-contracts.mjs`
- ChatGPT/Codex auth provider code under `apps/vscode/src/integrations/openai-codex`, `apps/vscode/src/core/api/providers/openai-codex.ts`, and `sdk/packages/llms/src/providers/openai-codex-models.ts`
- native agent host/registration code under `apps/vscode/src/hosts`
- Codie home/webview branding under `apps/vscode/webview-ui/src/components/welcome`
- Codie webview mark under `apps/vscode/webview-ui/src/assets/CodeVibeMark.tsx`
- Codie icons and assets under `apps/vscode/assets`
- standalone hub provider and settings branding under `apps/cline-hub/src/webview`

If a direct patch file helps review the upstream delta, export it from the upstream merge-base:

```sh
npm --prefix apps/vscode run upstream:base:export-patch -- --upstream-ref main
```

## Review Overlay Risks

Read the `overlayRiskSummary` and `overlayRiskPlan` sections before applying a drop. Any changed file under these areas means the patch needs manual Codie review before packaging:

- `codex-auth-defaults`: OpenAI Codex defaults and `.codex/auth.json` import
- `native-agent-placement`: Codie agent contribution order, chat session ids, and hidden legacy panel state
- `visible-branding-and-ui`: marketplace copy, walkthroughs, icons, and webview UI copy
- `release-and-package-guards`: VSIX packaging, install smoke checks, release gates, and visible-brand scans
- `standalone-ui-bridge`: non-VS-Code runtime bridge for the future standalone Codie UI
- `cursor-compatibility-surfaces`: Cursor-compatible routes, background agents, rules, ignores, browser tools, and sandbox policy

## Validate

Run these after every meaningful layer:

```sh
npm --prefix apps/vscode run package:github-vsix:preflight
npm --prefix apps/vscode run branding:audit
npm --prefix apps/vscode run compatibility:contracts
npm --prefix apps/vscode run build:webview
npm --prefix apps/vscode run lint
git diff --check
```

For the current known gaps, also run or capture:

```sh
npm --prefix apps/vscode run release:cursor-parity:evidence:full
npm --prefix apps/vscode run upstream:base:fetch -- --upstream-ref main
code --list-extensions --show-versions | rg '^atnumridha\.codevibe@'
```

Record installed-VS-Code screenshots or logs for sidebar/composer rendering, native prompt and skill discovery, ChatGPT auth/account/model visibility, approvals, MCP, browser automation, retrieval/indexing, background agents, sandbox policy, and deeplink flows. The extension being listed by `code --list-extensions` is necessary evidence, but it is not visual validation.

Before publishing a user-facing update, run the final validation commands printed by the report, then package and install the VSIX:

```sh
node apps/vscode/scripts/package-github-vsix.mjs --out-dir /private/tmp/codevibe-vsix --install --verify-install
```

Create a GitHub release only after the installed VS Code validation passes and the report's GitHub release prerequisite check passes.
