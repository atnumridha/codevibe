# Upstream Cline Patch Intake

CodeVibe keeps its Codex auth, native agent placement, visible branding, packaging guards, and standalone UI bridge as product overlays on top of the reusable Cline extension base. Use this workflow when a new upstream Cline branch, tag, or release needs to be reviewed.

## Plan A Drop

Start from a clean worktree on a CodeVibe branch:

```sh
npm --prefix apps/vscode run upstream:cline:fetch -- --upstream-ref main
```

For a tag or specific ref:

```sh
npm --prefix apps/vscode run upstream:cline:fetch -- --upstream-ref vX.Y.Z
```

The command writes `.codevibe/upstream-cline/intake-report.json`. The report includes:

- upstream commit and merge-base
- changed files grouped into patch layers
- CodeVibe overlay files that must be preserved or re-applied
- guard commands to run after each layer

## Apply In Layers

Create a dedicated branch before applying changes:

```sh
git switch -c codex/cline-upstream-vX.Y.Z
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
npm --prefix apps/vscode run upstream:cline:export-patch -- --upstream-ref main
```

## Validate

Run these after every meaningful layer:

```sh
npm --prefix apps/vscode run package:github-vsix:preflight
npm --prefix apps/vscode run build:webview
npm --prefix apps/vscode run lint
git diff --check
```

Before publishing a user-facing update, package and install the VSIX:

```sh
node apps/vscode/scripts/package-github-vsix.mjs --out-dir /private/tmp/codevibe-vsix --install --verify-install
```

Create a GitHub release only after the installed VS Code validation passes.
