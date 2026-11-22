# Changelog

## Unreleased

- Add schema-aware YAML linting through ESLint, using the existing workflow schema to reject unknown keys and invalid types.
- Run linting in CI and before npm publication; recommend YAML/ESLint editor extensions and configure local schema completion.

## 0.3.0

- Add the `repeat` step: it runs its steps again until a condition is true, for example to show more context and ask again until the user decides.
  `steps.<id>.outputs.last` holds the results of the last iteration.
- Breaking: `prompt-file` is removed. `prompt` takes the instructions, or the path of a Markdown file: one word that ends with `.md`, relative to the flow file.
- Standalone skill calls resolve in the explicitly selected project, including CLI/MCP `--cwd` execution.
- `uses: skill:<plugin>:<skill>` runs the flow of a skill in another plugin: the runner finds it in `SKILL_RAILS_SKILLS_PATH`, a plugin checkout above the flow, or the Claude Code plugin installs.
- Flow `outputs`: the values that a flow gives back, in the `done` and `failed` reports, and directly in `steps.<id>.outputs` of a `uses` step.
- `run` steps: `args` (quoted arguments, a list adds its items, an empty value adds nothing), and `stdout` (`text`, `env`, `json` or `jsonl`) to read the outputs from what the command prints.
- The `scripts/` folder of the plugin that holds the flow is in `PATH`, after the `scripts/` folder of the flow.
- `WARNING: <text>` lines on stderr become notes, as `::warning::` lines on stdout do.
- A failed `run` step gives `steps.<id>.exitCode` and `steps.<id>.error`, the last lines of its stderr.
- The `note` step shows a message to the user, and the flow goes on.
- `list` inputs: a list, a JSON list, or one item per line or per comma.
- The CLI adds `next` to each `step` report: the exact command that reports the step.
- The CLI adds `protocol` to the `start` report: how the agent acts on each result, so that a `SKILL.md` holds no copy of it.
- `args` maps add flags: `--name: true`, `--name: <value>`, or `--name: [a, b]`; an empty value adds nothing.
- `continue-on-error` takes a list of exit codes.
- An `ask` option with a `value` puts the value in the step output in place of the label.
- `migrate-to-skill-rails` first assesses whether the skill should stay Markdown: it lists the files outside the skill that name its Markdown files, and keeps the skill when code or CI reads its text, when the runner cannot run there, or when the skill is reference text or too short. It keeps the files that a partial migration names.
- `ask` can be an expression that gives the questions, with `max` and `extra-options`; a question with `other: true` also accepts typed text.
- `loop.previous` holds the step results of the last iteration of a `foreach` or a `repeat`.
- `uses` steps: `forward-stop: true` ends the caller with the stop of the other flow; `continue-on-error` also catches a `--fail` of an agent step inside it.
- `prompt` and `skill` steps take `continue-on-error`: a `--fail` then fails only the step.
- The `$FLOW_OUTPUT` files are in the state folder of the runner, out of the `TMPDIR` of the flow.
- Tests: the `path` folders come before the `scripts/` folders, and an answer key or an `expect.steps` key can be `<uses id>/<step id>`.
- The short output form: `output: { title: string, kind: fix | skip, files: [string], note?: string }`.
- The check refuses an output schema with an unknown keyword, the sign of a YAML text split at a comma.
- Inputs take `enum`, for the input or for each item of a list input.
- `fail: <message>`, the short form of a stop with outcome failure.
- An ask option can be a plain label, and its description is optional.
- Expression functions: `length`, `split`, `list` and `where`.
- A scenario plugin in `test/scenarios/` tests the flow patterns of real skills.
- The `set` step computes values with expressions, with their types.
- `on-failure` steps run when a flow fails, with `failure.message`.
- `working-directory` on `run`, `uses`, `prompt` and `skill` steps; an agent step in another folder has `directory` in its report.
- `loop.number` (from 1) and `loop.parent`, the loop around the current one.
- `skill-rails test --quiet` shows only the failures and the count, for a whole repository.
- Tests: live steps (`live` or `{ $live: <guidance> }` in `answers`) send one step to a real agent command, with `skill-rails test --live` and `--agent <command>`; without `--live`, these tests are skipped.
- Tests: `expect.judge` grades a step output with a rubric and a real agent; `judge-runs` runs the test several times.
- Tests: `mode: agent` gives a `request` to the agent command and checks the saved state of the flow, with the `started` and `transcript` expectations.
- Each agent step result keeps its `request` and its `answer`, including iterations unwound by failures or stops.
- `skill-rails record <flow>` writes a test file from a real run.
- `skill-rails trace <flow>` prints one JSON line per agent step of a run, as eval cases.
- Tests: `flow-outputs` checks the outputs of the flow, an `outputs` key can be a longer path, `setup` gets `{{cwd}}` and `{{dir}}`, and a test can expect `status: error`.

## 0.2.3

- Run the bundled create and migrate skills as YAML flows, with shared scaffolding, deterministic validation/tests, and repair and failure gates.
- Migrate existing skills in place without generating backups or sibling copies.
- Use `rails.yaml` throughout skills, examples, documentation, and CLI help.
- Add flow scenarios and a rule-preservation audit; retain the runner skill as the Markdown bootstrap.

## 0.2.2

- Add native Codex plugin packaging: portable manifests, a Codex compatibility manifest, and a repository marketplace sharing the existing skills and MCP runner.
- Include the plugin metadata and marketplace in the npm package, with a packaging regression check and installation guide.

## 0.2.1

- Portable runner, creation, migration and generated skill instructions, with chat fallbacks for questions.
- Setup guides and a live verification checklist for Codex, Cursor, Copilot in VS Code, Gemini CLI and OpenCode v2.
- `--cwd` selects the project for CLI and MCP commands; saved-state reports include the project directory.
- Polling uses 20-second slices by default, bounds individual checks to the remaining slice, and preserves the next check time in a `retryAt` wait report. Slow polling checks may now time out; adjust `SKILL_RAILS_WAIT_SLICE_SECONDS` if needed.

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
