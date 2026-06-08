# CodeVibe CLI

CodeVibe is an autonomous coding agent for terminals, scripts, CI, chat connectors, and future standalone UI surfaces. It uses the same agent core as the CodeVibe VS Code extension, with Plan/Act modes, MCP, checkpoints, rules, skills, hooks, subagents, background hub sessions, and Codex auth.

## Install

```sh
npm install -g codevibe
```

The published `codevibe` wrapper resolves the correct compiled binary for macOS, Linux, or Windows on `arm64` and `x64`. The legacy `cline` command remains available as a compatibility alias so existing scripts keep working while CodeVibe tracks upstream Cline changes.

## Quick Start

```sh
codevibe
codevibe "Audit this package and propose fixes"
cat file.txt | codevibe "Summarize this"
codevibe --help
```

## Auth

CodeVibe defaults to the OpenAI Codex provider and reuses Codex Home credentials from `~/.codex/auth.json` or `CODEX_HOME` when provider settings have not been saved.

```sh
codevibe auth
codevibe auth openai-codex
codevibe auth --provider anthropic --apikey sk-... --modelid claude-sonnet-4-6
```

OAuth-supported providers include `openai-codex`, `oca`, and the legacy `cline` account provider. Non-interactive runs fail fast with a clear auth message when credentials are missing.

## Modes

- Interactive TUI: `codevibe` or `codevibe -i`
- One-shot: `codevibe "your prompt"`
- NDJSON: `codevibe --json "..."`
- Yolo: `codevibe --yolo "..."`
- Background hub: `codevibe --zen "..."`
- Teams: `codevibe --team-name my-team "..."`

## Examples

```sh
codevibe --yolo "Run tests and fix any failures"
git diff origin/main | codevibe "Review these changes for issues"
codevibe -P openrouter -m google/gemini-3-pro -k sk-... "Set up Storybook"
codevibe --json "List all TODO comments" | jq -r 'select(.type == "agent_event" and .event.text) | .event.text'
```

## Connectors

Bridge chat surfaces into RPC-backed CodeVibe sessions. Supported platforms include Telegram, Slack, Google Chat, WhatsApp, Discord, and Linear.

```sh
codevibe connect telegram -k 123456:ABCDEF...
codevibe connect slack --bot-token $SLACK_BOT_TOKEN --signing-secret $SLACK_SIGNING_SECRET --base-url https://your-domain.com
codevibe connect gchat --base-url https://your-domain.com
codevibe connect whatsapp --base-url https://your-domain.com
codevibe connect linear --api-key $LINEAR_API_KEY --base-url https://your-domain.com
codevibe connect --stop
```

## Schedules

```sh
codevibe schedule create "Daily code review" \
  --cron "0 9 * * MON-FRI" \
  --prompt "Review PRs opened yesterday and summarize issues." \
  --workspace /path/to/repo \
  --provider openai-codex \
  --model gpt-5.5 \
  --timeout 3600 \
  --tags automation,review

codevibe schedule list
codevibe schedule trigger <schedule-id>
codevibe schedule export <schedule-id> > daily-review.yaml
codevibe schedule import ./daily-review.yaml
```

## Common Options

| Flag | Description |
|------|-------------|
| `-s, --system <prompt>` | Override the system prompt |
| `-P, --provider <id>` | Provider id, default `openai-codex` |
| `-m, --model <id>` | Model id |
| `-k, --key <api-key>` | API key override for this run |
| `-p, --plan` | Run in plan mode |
| `-i, --tui` | Interactive multi-turn TUI |
| `-t, --timeout <seconds>` | Optional run timeout |
| `-c, --cwd <path>` | Working directory for tools |
| `--config <path>` | Configuration directory |
| `--data-dir <path>` | Isolated local state directory |
| `--auto-approve [true|false]` | Tool auto-approval |
| `--json` | Stream NDJSON |
| `-y, --yolo` | Skip tool approval prompts |
| `-z, --zen` | Dispatch to the background hub |
| `--team-name <name>` | Persistent team state name |

## Top-Level Commands

- `codevibe config`
- `codevibe history|h`
- `codevibe version`
- `codevibe update`
- `codevibe auth <provider>`
- `codevibe connect <adapter>`
- `codevibe schedule <command>`
- `codevibe doctor`
- `codevibe hook`
- `codevibe hub`
- `codevibe kanban`

## Environment

Use `CODEVIBE_*` names for new scripts. The CLI mirrors these into legacy `CLINE_*` names at startup for SDK compatibility, and legacy names are still accepted.

- `CODEVIBE_DATA_DIR`
- `CODEVIBE_PROVIDER`, `CODEVIBE_MODEL`, `CODEVIBE_API_KEY`
- `CODEVIBE_LOG_ENABLED`, `CODEVIBE_LOG_LEVEL`, `CODEVIBE_LOG_PATH`, `CODEVIBE_LOG_NAME`
- `CODEVIBE_SANDBOX`, `CODEVIBE_SANDBOX_DATA_DIR`
- `CODEVIBE_TOOL_APPROVAL_MODE`, `CODEVIBE_TOOL_APPROVAL_DIR`
- `CODEVIBE_HUB_ADDRESS`, `CODEVIBE_HUB_DASHBOARD_PORT`, `CODEVIBE_HUB_WEBVIEW_DIST_DIR`
- `CODEVIBE_VCR`, `CODEVIBE_VCR_CASSETTE`

## Cursor-Compatible Inputs

CodeVibe reads Cursor-style project inputs where supported:

- `.cursorrules`
- `.cursor/rules`
- `.cursorignore`
- `.cursorindexingignore`
- `.cursor/mcp.json`
- `.cursor/sandbox.json`

## Development And Distribution

See [DEVELOPMENT.md](./DEVELOPMENT.md) and [DISTRIBUTION.md](./DISTRIBUTION.md). The source package still uses selected `@cline/*` workspace names internally to keep upstream patching straightforward; public commands, package metadata, and release artifacts are CodeVibe-first.

## License

Apache-2.0. CodeVibe includes upstream Cline-derived code under the original Apache-2.0 license notice.
