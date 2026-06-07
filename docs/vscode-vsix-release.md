# CodeVibe VS Code VSIX Release

CodeVibe releases are blocked until the Cursor-parity gate passes end to end:

- local unit/type/lint checks
- CI extension tests
- CI e2e tests
- VSIX packaging
- VSIX install smoke test
- manual installed-VS-Code validation of Codex auth, Plan/Act, diffs, terminal approvals, MCP, browser automation, background agents, and Cursor-compatible deeplinks

Set `CODEVIBE_ALL_PARITY_VALIDATED=true` only after those checks pass, and provide `CODEVIBE_PARITY_EVIDENCE_URL` as an `https://` URL to the release checklist or validation log. The evidence should include the VS Code version, VSIX version, install smoke output, and manual installed-VS-Code parity results.

## Version And Tag

The release tag must match `apps/vscode/package.json` exactly:

```sh
tag="v$(node -p "require('./apps/vscode/package.json').version")"
```

Create release notes in `CHANGELOG.md` before dispatching either release workflow.

## GitHub-Only VSIX Release

Use `.github/workflows/ext-vscode-github-release.yml` when marketplace secrets are not available or when publishing only a GitHub Release artifact.

Required inputs:

- `tag`: `vX.Y.Z`
- `run_tests`: `true`
- `run_e2e`: `true`
- `all_parity_validated`: `true`
- `parity_evidence_url`: `https://...`

The workflow packages `apps/vscode/*.vsix`, smoke-installs it with VS Code, and uploads it to the GitHub Release. If `prerelease` is true, the VSIX is packaged with `--pre-release`.

## Marketplace Release

Use `.github/workflows/ext-vscode-publish-stable.yml` only when both marketplace secrets exist:

- `VSCE_PAT`
- `OVSX_PAT`

The workflow fails early with a pointer to the GitHub-only workflow if either secret is missing. It also creates the GitHub Release after marketplace publish succeeds.

Required release-gate inputs:

- `all_parity_validated`: `true`
- `parity_evidence_url`: `https://...`

## Local Packaging

From a dependency-equipped checkout:

```sh
npm --prefix apps/vscode ci --include=optional
npm --prefix apps/vscode/webview-ui ci --include=optional
cd apps/vscode
CODEVIBE_ALL_PARITY_VALIDATED=true npm run package:github-vsix:release -- --verify-install
```

With the release gate enabled, also set:

```sh
CODEVIBE_PARITY_EVIDENCE_URL="https://github.com/<owner>/<repo>/issues/<id>"
```

For prerelease packaging, pass `-- --pre-release`.
