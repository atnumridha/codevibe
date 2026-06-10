# Upstream Base Patch Intake

CodeVibe keeps its Codex auth, native agent placement, visible branding, packaging guards, and standalone UI bridge as product overlays on top of the reusable open-source extension base. Use this workflow when a new upstream base branch, tag, or release needs to be reviewed.

## Plan A Drop

Start from a clean worktree on a CodeVibe branch:

```sh
npm --prefix apps/vscode run upstream:base:fetch -- --upstream-ref main
```

For a tag or specific ref:

```sh
npm --prefix apps/vscode run upstream:base:fetch -- --upstream-ref vX.Y.Z
```

The command writes `.codevibe/upstream-base/intake-report.json`. The report includes:

- upstream commit and merge-base
- changed files grouped into patch layers
- CodeVibe overlay risk summary with critical/high/medium review areas
- CodeVibe overlay files that must be preserved or re-applied
- guard commands to run after each layer, final VSIX validation commands, and GitHub release prerequisite checks

## Apply In Layers

Create a dedicated branch before applying changes:

```sh
git switch -c codex/upstream-base-vX.Y.Z
```

Apply one layer at a time. Keep CodeVibe overlays intact, especially:

- `apps/vscode/package.json`
- `apps/vscode/scripts/package-github-vsix.mjs`
- `apps/vscode/src/package/brandGuards.ts`
- Codex auth provider code under `apps/vscode/src/services/auth`
- native agent host/registration code under `apps/vscode/src/hosts`
- CodeVibe home/webview branding under `apps/vscode/webview-ui/src/components/home`
- CodeVibe icons and assets under `apps/vscode/assets`

If a direct patch file helps review the upstream delta, export it from the upstream merge-base:

```sh
npm --prefix apps/vscode run upstream:base:export-patch -- --upstream-ref main
```

## Review Overlay Risks

Read the `overlayRiskSummary` and `overlayRiskPlan` sections before applying a drop. Any changed file under these areas means the patch needs manual CodeVibe review before packaging:

- `codex-auth-defaults`: OpenAI Codex defaults and `.codex/auth.json` import
- `native-agent-placement`: CodeVibe agent contribution order, chat session ids, and hidden legacy panel state
- `visible-branding-and-ui`: marketplace copy, walkthroughs, icons, and webview UI copy
- `release-and-package-guards`: VSIX packaging, install smoke checks, release gates, and visible-brand scans
- `standalone-ui-bridge`: non-VS-Code runtime bridge for the future standalone CodeVibe UI
- `cursor-compatibility-surfaces`: Cursor-compatible routes, background agents, rules, ignores, browser tools, and sandbox policy

## Validate

Run these after every meaningful layer:

```sh
npm --prefix apps/vscode run package:github-vsix:preflight
npm --prefix apps/vscode run build:webview
npm --prefix apps/vscode run lint
git diff --check
```

Before publishing a user-facing update, run the final validation commands printed by the report, then package and install the VSIX:

```sh
node apps/vscode/scripts/package-github-vsix.mjs --out-dir /private/tmp/codevibe-vsix --install --verify-install
```

Create a GitHub release only after the installed VS Code validation passes and the report's GitHub release prerequisite check passes.
