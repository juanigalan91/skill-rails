# Changelog

## Unreleased

- Portable runner, creation, migration and generated skill instructions, with chat fallbacks for questions.
- Setup guides and a live verification checklist for Codex, Cursor, Copilot in VS Code, Gemini CLI and OpenCode v2.
- `--cwd` selects the project for CLI and MCP commands; saved-state reports include the project directory.
- Polling uses 20-second slices by default, bounds individual checks to the remaining slice, and preserves the next check time in a `retryAt` wait report. Slow polling checks may now time out; adjust `SKILL_RAILS_WAIT_SLICE_SECONDS` if needed.

## 0.2.1

- Fix: under `npx` or `npm exec`, the CLI and the MCP server ran in the nearest folder with a `package.json`.
  They now use `INIT_CWD`, the folder where the command started, for the flow paths, the `run` steps and the state.

## 0.2.0

The first public release.

### Flows

- A flow is a YAML file in the GitHub Actions syntax: `steps`, `if: ${{ }}`, `run`, `env` and `$FLOW_OUTPUT`.
- Step types: `run`, `skill`, `prompt` (or `prompt-file`), `ask`, `stop`, `foreach`, `break` and `uses`.
- `run` steps can poll with `until`, `interval-seconds` and `timeout-minutes`, and give control back to the agent in time slices.
- `ask` questions have validated options, option previews, multi-select, and free-text answers.
- Agent outputs are validated against a JSON Schema.
- Expressions are evaluated by `@actions/expressions`, so they behave as in GitHub Actions.
- A `run` command cannot hold `${{ }}`: values go through `env`.

### Tools

- CLI: `start`, `done`, `status`, `reset`, `check`, `test` and `mcp`.
- MCP server with the tools `flow_start`, `flow_done`, `flow_status`, `flow_reset` and `flow_check`.
- `skill-rails test`: deterministic flow tests with fixed agent answers, fixtures, setup commands and stub commands.
- A Node API with TypeScript types.

### Claude Code plugin

- `run-skill-rails`, `create-skill-rails` and `migrate-to-skill-rails` skills.
- The repository is its own plugin marketplace.
