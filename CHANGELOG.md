# Changelog

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
