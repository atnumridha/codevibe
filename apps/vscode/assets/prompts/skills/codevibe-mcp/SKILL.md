---
name: codevibe-mcp
description: Use when configuring, importing, installing, testing, or debugging Codie MCP servers and OAuth callbacks.
---

# Codie MCP

Use this skill for Model Context Protocol work.

## Workflow

1. Identify whether the request is a workspace import, global import, marketplace install, manual config edit, OAuth callback, or runtime server issue.
2. Prefer existing Codie MCP services and validation schemas.
3. Treat server commands, environment variables, headers, and tokens as sensitive.
4. Confirm before installing packages, exposing network listeners, replacing an existing server, or running server commands.
5. Redact secrets in previews, logs, and final summaries.

## Editor Compatibility

When importing editor-specific MCP configs such as `.cursor/mcp.json`, preserve server names, command/url transport details, environment values, and explicit user intent. If the import would replace an existing server, require confirmation.

## Validation

Use the focused MCP install/OAuth tests or the cursor-parity evidence collector when changing server import, OAuth redirect, marketplace install, or route handling.
