# CodeVibe Core CLI Agent

An interactive terminal chat agent powered by the upstream-compatible `ClineCore` runtime. This example is similar in spirit to [`cli-agent`](../cli-agent), but uses stateful sessions and built-in runtime tools instead of the stateless `Agent` class, to leverage CodeVibe's agent harness.

## Getting started

Install dependencies:

```bash
bun install
bun run build:sdk
```

Set an API key:

```bash
export CODEVIBE_API_KEY="sk_..."
```

Run:

```bash
bun dev
```

Type any message at the `you:` prompt to see a streaming response. Type `exit` to quit.

## Optional model configuration

The example defaults to the CodeVibe gateway-compatible provider and Claude Sonnet:

```bash
export CODEVIBE_PROVIDER_ID="cline"
export CODEVIBE_MODEL_ID="anthropic/claude-sonnet-4.6"
```

## What it does

- Creates a local `ClineCore` runtime with `ClineCore.create()`
- Starts one interactive session with the CodeVibe runtime
- Sends each user turn with the runtime session API
- Streams `agent_event` text to stdout as the assistant responds
- Logs tool calls and tool results inline
- Uses the built-in runtime tools instead of defining custom tools
- Stops and disposes the runtime during shutdown

## Concepts demonstrated

- Stateful sessions with `ClineCore`
- Multi-turn conversation using a single `sessionId`
- `CoreSessionEvent` subscription via `cline.subscribe()`
- Built-in runtime tools (`read_files`, `search_codebase`, `run_commands`, etc.)
- Basic tool policies: file reads/search are auto-approved, other tools request approval

## Notes

Use this example when you want the full CodeVibe runtime with sessions, persistence, and built-in tools. For the smallest possible SDK example, see [quickstart](../quickstart). For the lightweight stateless runtime, see [cli-agent](../cli-agent).
