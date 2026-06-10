---
name: standalone-readiness
description: Verify CodeVibe standalone UI and VS-Code-free runtime readiness.
agent: CodeVibe Agent
argument-hint: Describe the standalone artifact, UI route, or runtime change.
---

Check CodeVibe standalone readiness.

Verify that the VSIX path and standalone path both still work. Confirm `standalone.zip`, `standalone-manifest.json`, extracted-package smoke, Codex Home auth, Cursor-compatible route previews, and redaction rules. Prefer focused commands first, then broaden only when the change touches packaging, HostBridge, ProtoBus, or webview boot.
