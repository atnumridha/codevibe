# CLI Distribution

Codie CLI is distributed as compiled binaries via npm. Users install `codevibe` and run the `codevibe` command without needing Bun, Zig, or any other runtime installed. The legacy `cline` command and selected `@cline/*` workspace names remain compatibility anchors so upstream changes can still be patched into Codie cleanly.

## Why Compiled Binaries?

The CLI depends on OpenTUI (`@opentui/core`), which uses `bun:ffi` to call a native Zig binary for terminal rendering. A compiled binary produced by `bun build --compile` embeds Bun plus the TypeScript bundle, so end users do not need Bun.

## Published Packages

Publishing creates one wrapper package plus platform packages:

| Package | Description |
|---|---|
| `@codevibe/cli-darwin-arm64` | macOS Apple Silicon binary |
| `@codevibe/cli-darwin-x64` | macOS Intel binary |
| `@codevibe/cli-linux-arm64` | Linux ARM binary |
| `@codevibe/cli-linux-x64` | Linux x64 binary |
| `@codevibe/cli-windows-x64` | Windows x64 binary |
| `@codevibe/cli-windows-arm64` | Windows ARM binary |
| `codevibe` | Wrapper package with optional dependencies |

Each platform package contains `bin/codevibe` and a `bin/cline` compatibility alias:

```json
{
  "name": "@codevibe/cli-darwin-arm64",
  "version": "3.0.20",
  "os": ["darwin"],
  "cpu": ["arm64"],
  "bin": {
    "codevibe": "bin/codevibe",
    "cline": "bin/cline"
  }
}
```

The wrapper package contains resolver scripts and optional dependencies:

```json
{
  "name": "codevibe",
  "version": "3.0.20",
  "bin": {
    "codevibe": "./bin/codevibe",
    "cline": "./bin/cline"
  },
  "scripts": {
    "postinstall": "node ./postinstall.mjs || true"
  },
  "optionalDependencies": {
    "@codevibe/cli-darwin-arm64": "3.0.20"
  }
}
```

## Build Flow

From `apps/cli`:

```sh
bun run build:platforms:single
bun run build:platforms
bun run publish:npm:dry
```

`script/build.ts`:

1. Builds SDK packages and the CLI bundle using the existing workspace package name for upstream patchability.
2. Builds each platform executable as `codevibe`.
3. Copies the executable to `cline` as a compatibility alias.
4. Generates `@codevibe/cli-*` package manifests.
5. Runs a smoke test on the current platform.

`script/publish-npm.ts`:

1. Reads generated platform packages from `dist/`.
2. Publishes all `@codevibe/cli-*` packages.
3. Generates the clean `codevibe` wrapper package.
4. Publishes the wrapper package with `codevibe` as primary bin and `cline` as alias.

## Resolver

`bin/cline` is the shared Node.js resolver used by both the `codevibe` and `cline` wrapper entries.

Resolution order:

1. `CODEVIBE_BIN_PATH` or legacy `CLINE_BIN_PATH`
2. Cached binary at `bin/.codevibe` or `bin/.cline`
3. `@codevibe/cli-<platform>-<arch>` under `node_modules`
4. Legacy `@cline/cli-<platform>-<arch>` under `node_modules`

The resolver sets both `CODEVIBE_WRAPPER_PATH` and `CLINE_WRAPPER_PATH` for child processes so Codie code and upstream-compatible SDK code can locate the wrapper.

## Postinstall

`script/postinstall.mjs` creates executable caches at both `bin/.codevibe` and `bin/.cline`. Hard links are preferred, with copy fallback for filesystems that do not support hard links. The script exits successfully even when caching fails because the resolver can still locate binaries at runtime.

## Release Notes

The CLI release path remains blocked on normal release readiness: tests, packaging smoke checks, and end-to-end validation. Final public releases should use CodeVibe package names and GitHub release notes; upstream Cline provenance stays in license and compatibility notes only.
