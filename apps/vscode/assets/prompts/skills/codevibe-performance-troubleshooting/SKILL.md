---
name: codevibe-performance-troubleshooting
description: Use when investigating CodeVibe startup latency, agent response latency, indexing cost, native chat activation, packaging size, or UI performance.
---

# CodeVibe Performance Troubleshooting

Use this skill when CodeVibe feels slow, noisy, duplicated, or heavy.

## Workflow

1. Determine whether the issue is extension activation, native chat session registration, webview rendering, retrieval/indexing, MCP startup, browser automation, model latency, or packaging size.
2. Collect concrete timings from VS Code runtime status, logs, test output, or profiler data.
3. Check for stale installed extension folders, duplicate contribution ids, and old workspace storage state.
4. Prefer targeted measurements over broad rebuilds.
5. Fix the smallest root cause that improves user-visible latency or removes duplicate UI.

## Validation

For manifest and install issues, package and install a VSIX into VS Code. For UI issues, capture screenshots or runtime status. For packaging size, inspect the VSIX file list and `.vscodeignore`.
