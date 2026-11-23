# CLI and Node API

[Back to README](../README.md) · [Format and protocol](format.md) · [Agent setup](agents.md)

## Install

The CLI needs Node 20+ and Bash. Install it locally or run it through `npx`:

```bash
npm install skill-rails
npx skill-rails check rails.yaml
```

For Claude Code and Codex plugin installation, see the [README](../README.md#install). The plugins bundle skills for running, creating, and migrating skills, plus MCP configuration and question hooks.

## Commands

Prefix these commands with `npx` when using a local npm installation.

| Command | Purpose |
| --- | --- |
| `skill-rails start <file> [--input <key>=<value> ...]` | Check the rails file, reset its run, and execute until the first agent step. |
| `skill-rails done <rails> <step-id> [--output <json> \| -]` | Submit an answer and execute until the next handoff or completion. |
| `skill-rails done <rails> <step-id> --fail <reason>` | Fail the pending step; configured error handling may continue the run. |
| `skill-rails status <rails>` | Show the pending step and recorded results. |
| `skill-rails reset <rails>` | Delete saved state for the run. |
| `skill-rails check <file>` | Validate a rails file without executing its steps, and give `warnings` on its design. Loading TypeScript still executes module code. |
| `skill-rails test [<file or folder> ...]` | Run discovered `*.test.yaml` tests; targets default to the current folder. |
| `skill-rails record <rails> [--out <file>]` | Generate a test from a saved run. |
| `skill-rails trace <rails>` | Print one JSON line per recorded agent step, including its request, answer, and outcome. |
| `skill-rails bench <bench.yaml> [--runs <n>] [--out <file.csv>]` | Compare skill variants through repeated runs and median summaries. |
| `skill-rails mcp` | Serve the MCP tools over stdio. |
| `skill-rails hooks` | Print the host hook configuration. |
| `skill-rails hook` | Process a host hook event supplied as JSON on stdin. |

All commands accept `--cwd <project-directory>`. Use the same project directory for subsequent `done`, `status`, `reset`, `record`, and `trace` calls. Relative CLI file paths are resolved from that directory. The `<rails>` argument is the declared name of the run, not its file path.

Tests also accept `--json`, `--quiet`, `--live`, and `--agent <command>`. Live tests call a real model; see [Testing](testing.md).

Benchmarks also accept `--live`, `--agent <command>`, `--transcripts <directory>`, and `--baseline <file.csv>` with `--max-increase <percent>`. See the [benchmark reference](testing.md#bench) and [recorded results](benchmarks.md).

## Drive a run

```bash
npx skill-rails start /path/to/skill/rails.yaml --cwd /path/to/project
npx skill-rails status <rails-name> --cwd /path/to/project
npx skill-rails done <rails-name> <step-id> --cwd /path/to/project --output - <<'JSON'
{"title":"feat: add a"}
JSON
```

Act on the returned status:

- `step`: do the pending work and report its output. A CLI step report includes a `next` command.
- `invalid`: correct the output using the reported errors, then submit it again.
- `done` or `failed`: the run has ended; report its message and outputs.
- `error`: the command could not load or operate the run; inspect its errors.

A polling step can return `type: wait` with `retryAt`. Resume at or after that time. See the [protocol](format.md#the-protocol) and [polling reference](format.md#polling).

## Node API

```ts
import { start, done } from 'skill-rails';

const cwd = '/path/to/project';
const report = start({ file: '/path/to/skill/rails.yaml', cwd, inputs: {} });

// After performing the requested step, submit its actual result.
if (report.status === 'step' && report.id === 'text') {
  done({ rails: report.rails, id: report.id, cwd, output: { title: 'feat: add a' } });
}
```

The API shares the CLI reports. It also exports `check`, `status`, `reset`, the loader and validation helpers, test utilities, and TypeScript types.

## MCP

Configure a local stdio server in an MCP client:

```json
{
  "mcpServers": {
    "skill-rails": {
      "command": "npx",
      "args": ["-y", "skill-rails@0.7", "mcp"]
    }
  }
}
```

The tools are `rails_start`, `rails_done`, `rails_status`, `rails_reset`, and `rails_check`. MCP completion uses the `step` argument; the Node API uses `id`. Start the server in the intended project, or pass `--cwd /path/to/project` in its arguments. See [agent compatibility](agents.md) for host configuration, permissions, and verification.

## Developing the checkout

```bash
yarn install
yarn lint
yarn typecheck
yarn test
```

`yarn lint` checks YAML syntax throughout the repository and validates the keys and types of rails files against the shared schema. CI and npm pre-publish checks run it too. VS Code and Cursor users can install the recommended YAML and ESLint extensions for diagnostics and completion; see [YAML linting](format.md#yaml-linting). The development lint plugins require Node 20.19+, 22.13+, or 24+.
