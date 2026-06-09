# CodeVibe VS Code VSIX Release

CodeVibe releases are blocked until the Cursor-parity gate passes end to end:

- local unit/type/lint checks
- CI extension tests
- CI e2e tests
- VSIX packaging
- VSIX install smoke test
- manual installed-VS-Code validation of Codex auth, Plan/Act, diffs, terminal approvals, MCP, browser automation, background agents, and Cursor-compatible deeplinks

Set `CODEVIBE_ALL_PARITY_VALIDATED=true` only after those checks pass, and provide `CODEVIBE_PARITY_EVIDENCE_URL` as an `https://` URL to the release checklist or validation log. Use `docs/cursor-parity-validation-checklist.md` as the checklist template. The evidence should include the VS Code version, VSIX version, install smoke output, and manual installed-VS-Code parity results.

## Version And Tag

The release tag must match `apps/vscode/package.json` exactly:

```sh
tag="v$(node -p "require('./apps/vscode/package.json').version")"
```

Create release notes in `CHANGELOG.md` before dispatching either release workflow.

## GitHub-Only VSIX Release

Use `.github/workflows/ext-vscode-github-release.yml` when marketplace secrets are not available or when publishing only a GitHub Release artifact.

For major changes that need installed-VS Code validation before the final parity gate is complete, dispatch the workflow with `release_stage` set to `candidate`. Candidate releases must be `prerelease=true` and `draft=true`; they package and smoke-install the VSIX, upload it to a draft GitHub prerelease, and intentionally skip `CODEVIBE_ALL_PARITY_VALIDATED` until final validation evidence exists. Use an rc tag such as `vX.Y.Z-rc.1`.

Required inputs:

- `tag`: `vX.Y.Z-rc.N` for a candidate, `vX.Y.Z` for final
- `release_stage`: `candidate` for validation artifacts, `final` for the evidence-gated release
- `run_tests`: `true`
- `run_e2e`: `true`
- `all_parity_validated`: `true` only for `release_stage=final`
- `parity_evidence_url`: `https://...` only for `release_stage=final`

The workflow packages `apps/vscode/*.vsix`, smoke-installs it with VS Code, and uploads it to the GitHub Release. If `prerelease` is true, the VSIX is packaged with `--pre-release`.
Each GitHub Release also attaches `cursor-parity-evidence.md`, a generated snapshot of the release prerequisite checks and local validation checklist state from the workflow runner.

If `gh` is unavailable locally, either use the token-based local uploader or dispatch the workflow from GitHub.

Token-based local candidate release:

```sh
export GITHUB_TOKEN="..."
node apps/vscode/scripts/release-github-vsix.mjs \
  --repo atnumridha/codevibe \
  --tag vX.Y.Z-rc.N \
  --vsix apps/vscode/dist/codevibe-X.Y.Z.vsix \
  --title "CodeVibe vX.Y.Z RC N" \
  --notes "Candidate VSIX for installed VS Code validation. Final parity evidence is pending." \
  --prerelease \
  --draft
```

Dry-run the same command with `--dry-run` to validate the tag, VSIX path, and asset metadata without network access or a token.

GitHub Actions candidate release:

1. Open `https://github.com/atnumridha/codevibe/actions/workflows/ext-vscode-github-release.yml`.
2. Choose **Run workflow** on the release commit or release branch.
3. Set `tag` to `vX.Y.Z-rc.N` for a candidate or `vX.Y.Z` for a final release, matching `apps/vscode/package.json`.
4. Keep `run_tests` and `run_e2e` set to `true`.
5. Use `release_stage=candidate`, `prerelease=true`, and `draft=true` until the checklist evidence is complete.
6. For the final release, set `release_stage=final`, `all_parity_validated=true`, and paste the `https://` checklist or validation-log URL into `parity_evidence_url`.

## Marketplace Release

Use `.github/workflows/ext-vscode-publish-stable.yml` only when both marketplace secrets exist:

- `VSCE_PAT`
- `OVSX_PAT`

The workflow fails early with a pointer to the GitHub-only workflow if either secret is missing. It also creates the GitHub Release after marketplace publish succeeds.
The GitHub Release includes both the VSIX and `cursor-parity-evidence.md`.

Required release-gate inputs:

- `all_parity_validated`: `true`
- `parity_evidence_url`: `https://...`

## Local Packaging

To capture a baseline evidence log before local dependencies are installed, run the safe collector. It exits nonzero while any release gate is still missing or skipped.

```sh
node apps/vscode/scripts/collect-cursor-parity-evidence.mjs || true
```

From a dependency-equipped checkout:

```sh
node apps/vscode/scripts/package-github-vsix.mjs --preflight
node apps/vscode/scripts/check-local-release-prereqs.mjs --release --candidate
npm --prefix apps/vscode ci --include=optional
npm --prefix apps/vscode/webview-ui ci --include=optional
cd apps/vscode
npm run release:cursor-parity:evidence:full
npm run package:github-vsix -- --verify-install
```

If the VS Code CLI is not named `code`, either set `CODEVIBE_VSCODE_CLI` or pass `--code`:

```sh
CODEVIBE_VSCODE_CLI="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" npm run package:github-vsix -- --verify-install
npm run package:github-vsix -- --verify-install --code "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
```

For release-gated local packaging, `CODEVIBE_PARITY_EVIDENCE_URL` must point at an `https://` validation log or release checklist:

```sh
node apps/vscode/scripts/check-local-release-prereqs.mjs --release --final --github-release
export CODEVIBE_ALL_PARITY_VALIDATED=true
export CODEVIBE_PARITY_EVIDENCE_URL="https://github.com/<owner>/<repo>/issues/<id>"
npm run package:github-vsix:release -- --verify-install
```

For prerelease packaging, pass `-- --pre-release`.
