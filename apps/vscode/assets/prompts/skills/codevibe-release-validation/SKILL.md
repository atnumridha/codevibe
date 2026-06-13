---
name: codevibe-release-validation
description: Use when preparing, validating, packaging, installing, tagging, or releasing Codie VSIX and standalone runtime artifacts.
---

# Codie Release Validation

Use this skill before publishing a VSIX, candidate tag, GitHub Release, marketplace release, or standalone runtime artifact.

## Required Evidence

- Clean git status for source changes.
- Package manifest and version consistency.
- Codie branding audit.
- Focused unit tests for touched manifest, provider, route, or packaging code.
- VSIX package and install smoke.
- Installed VS Code version check.
- `standalone.zip`, `standalone.zip.sha256`, and `standalone-manifest.json` when standalone runtime changed.
- Extracted standalone package smoke when runtime packaging changed.

## Workflow

1. Run narrow checks first, then package/install.
2. Refresh ignored local artifacts that the branding audit inspects.
3. Keep final releases blocked until the cursor-parity checklist has concrete evidence.
4. Candidate tags are acceptable for publishing release assets before the full final gate.
5. Never claim marketplace or final release completion without CI and installed-VS-Code evidence.
