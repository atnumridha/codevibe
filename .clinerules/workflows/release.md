# Release

Prepare and publish a CodeVibe VS Code extension release from `main`.

## Overview

This workflow helps you:

1. Select and confirm the target extension version.
2. Curate `CHANGELOG.md` entries manually for end users.
3. Bump the VS Code extension version in `apps/vscode/package.json`.
4. Run local, CI, e2e, VSIX install, and installed-VS-Code parity validation.
5. Create and push the release commit and tag.
6. Trigger the GitHub VSIX release workflow, or the marketplace workflow when marketplace secrets are available.
7. Update GitHub release notes and share a summary.

Do not create a GitHub release until the Cursor-parity validation gate has passed end to end.

## Process

### 1) Sync And Determine Version

```bash
git checkout main
git pull origin main
node -p "require('./apps/vscode/package.json').version"
```

Confirm the release version with the maintainer. Use the version from `apps/vscode/package.json`; the root `package.json` belongs to the workspace/SDK release flow.

### 2) Curate Changelog And Version

- Edit `CHANGELOG.md` for the target version using human-friendly release notes.
- Ensure version headers use bracket format, e.g. `## [3.88.1]`.
- Update `apps/vscode/package.json` to the same version.
- Update lockfiles only if the version bump or dependency changes require it.

### 3) Validate The Release Gate

Before publishing, verify:

- Local unit/integration tests pass.
- VS Code e2e tests pass.
- A VSIX packages successfully.
- The VSIX installs with `code --install-extension --force`.
- Installed VS Code can use CodeVibe end to end, including Codex auth, Plan/Act switching, diffs, terminal approvals, MCP, browser automation, retrieval/indexing, and background sessions.

The GitHub release workflow will reject releases unless `all_parity_validated=true`, `run_tests=true`, and `run_e2e=true`.

### 4) Commit And Tag

```bash
git add CHANGELOG.md apps/vscode/package.json apps/vscode/package-lock.json
git commit -m "v<version> Release Notes"
git push origin main
git tag v<version>
git push origin v<version>
```

Only include `apps/vscode/package-lock.json` if it changed.

### 5) Publish VSIX To GitHub Release

Trigger the CodeVibe GitHub-only VSIX workflow:

https://github.com/atnumridha/codevibe/actions/workflows/ext-vscode-github-release.yml

Recommended inputs:

- `tag`: `v<version>`
- `create_tag_from_ref`: `false` if the tag was pushed manually, otherwise `true`
- `prerelease`: `true` until the full Cursor-parity gate is signed off
- `draft`: maintainer preference
- `run_tests`: `true`
- `run_e2e`: `true`
- `all_parity_validated`: `true`

This workflow packages the VSIX with `apps/vscode/scripts/package-github-vsix.mjs --out-dir . --verify-install` and uploads `apps/vscode/*.vsix` to the GitHub Release.

### 6) Marketplace Publish

Use the marketplace workflow only after marketplace secrets are available and the maintainer wants VS Code Marketplace/Open VSX publication:

https://github.com/atnumridha/codevibe/actions/workflows/ext-vscode-publish-stable.yml

Dispatch it from `main` when `auto_create_tag_from_main=true`. It also requires `all_parity_validated=true` and creates a GitHub Release with the packaged VSIX.

### 7) Update GitHub Release Notes

After publish completes:

```bash
gh release view v<version> --json body --jq '.body'
gh release edit v<version> --notes "<final curated release notes>"
```

### 8) Final Summary

Provide:

- Released version/tag.
- Link to release page.
- VSIX artifact name.
- Summary of top end-user changes.
- Validation performed, including installed-VS-Code status.
