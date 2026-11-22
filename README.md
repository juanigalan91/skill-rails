<div align="center">

# skill-rails

### Less prompt maintenance. Fewer model turns. Testable skills.

[![npm](https://img.shields.io/npm/v/skill-rails.svg)](https://www.npmjs.com/package/skill-rails)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

</div>

Skills start as checklists. Then come conditions, approval gates, repeated instructions, and a Markdown file nobody wants to edit.

**skill-rails gives each part a clear home:** YAML defines the steps and conditions, scripts handle predictable work, and Markdown holds the instructions that need judgment. The runner executes the code and gives the agent one step at a time, inside its existing session. No extra service or API key.

## Why use it?

- **Maintain smaller prompts.** Change a condition or command without untangling a giant instruction file.
- **Enforce step order.** The runner selects the next step, evaluates conditions, and rejects out-of-order submissions.
- **Spend fewer turns on mechanics.** Consecutive shell steps run without a model turn between them; the agent receives only the current step’s instructions.
- **Validate handoffs.** Check agent outputs against JSON Schemas before later steps consume them.
- **Test without a model.** Fixed answers, fixtures, and stubs exercise branches, scripts, and failure paths without spending tokens.
- **Resume and inspect.** Retrieve the pending step, inspect results, or turn a recorded run into regression tests.

## Example: open a pull request

Gather the Git context, check whether there is anything to merge, push the branch, write the PR, and create it. Scripts handle Git and GitHub; the agent writes the title and body.

Here is a condensed version of the [open-pr example](examples/open-pr/), using its bundled scripts and prompt:

```yaml
# rails.yaml
name: open-pr
steps:
  - id: context
    run: context.sh
  - if: ${{ steps.context.outputs.branch == steps.context.outputs.base }}
    fail: Use a separate branch.
  - if: ${{ !steps.context.outputs.commits }}
    fail: Nothing to merge.
  - id: push
    run: push.sh
  - id: body-file
    run: body-file.sh
    env:
      TEMPLATE: ${{ steps.context.outputs.template }}
  - id: text
    prompt: prompts/text.md
    output:
      type: object
      required: [title]
      properties:
        title: { type: string, maxLength: 72 }
  - id: create
    run: create.sh
    env:
      TITLE: ${{ steps.text.outputs.title }}
      BODY: ${{ steps.body-file.outputs.file }}
      BASE: ${{ steps.context.outputs.base }}
      DRAFT: true
  - stop: 'PR created: ${{ steps.create.outputs.url }}'
```

The agent gets **one step**: fill the PR body and return a title. The runner handles the gates and commands, and rejects a title longer than 72 characters before creating the PR.

See the [before-and-after walkthrough](docs/walkthrough.md#before-and-after) for the Markdown version and script excerpts. The complete example also handles user questions and existing PRs. [TypeScript rails files](docs/format.md#typescript-rails-files) are supported too.

## How it works

The agent drives the runner through the CLI or MCP. The runner executes scripts, evaluates conditions, and stops when it needs judgment or a user answer. It validates the submitted JSON before continuing.

```text
agent → start rails.yaml → runner executes code → pending agent step
agent → done <rails> <step> + JSON → validation → next step or completion
```

Steps support prompts, skills, user questions, loops, polling, and reusable rails files. Named outputs pass data between them. Saved state lets an interrupted session retrieve its pending step; it does not guarantee exactly-once execution.

See [the architecture](docs/architecture.md) for the execution diagram and state model, or [the walkthrough](docs/walkthrough.md) for a Markdown-to-rails example.

## Install

**Claude Code**

```text
/plugin marketplace add juanigalan91/skill-rails
/plugin install skill-rails@skill-rails
```

**Codex**

```bash
codex plugin marketplace add juanigalan91/skill-rails
codex plugin add skill-rails@skill-rails
```

The plugins include skills to **run**, **create**, and **migrate** skills, plus the MCP configuration and [question hook](docs/agents.md#question-hook).

**CLI or library** · Node 20+ and Bash

```bash
npm install skill-rails
npx skill-rails check rails.yaml
npx skill-rails test
```

Cursor, Copilot, Gemini CLI, and OpenCode can use the CLI or MCP server. See [agent setup and compatibility](docs/agents.md).

## Use

- **Run:** `run-skill-rails` follows the runner’s reports and performs each agent step.
- **Create:** `create-skill-rails` designs and scaffolds the rails file, scripts, prompts, and tests.
- **Migrate:** `migrate-to-skill-rails` audits an existing skill and rewrites it in place, without backups or sibling copies.

You can also drive the complete example manually from this checkout:

```bash
npx skill-rails start examples/open-pr/rails.yaml --input auto=true
# Read the pending step, do the work, then submit its result:
npx skill-rails done open-pr text --output '{"title":"docs: explain the PR workflow"}'
```

The same runner is available through MCP and the Node API. See the [CLI and API guide](docs/cli.md) for configuration, commands, and reports.

## Test without a model

Supply fixed agent answers and let the runner execute the scripts and conditions. Fixtures and stubs keep external dependencies under control.

This excerpt from the [open-pr tests](examples/open-pr/tests/open-pr.test.yaml) uses a stub `gh`; the shared setup creates a local Git remote.

```yaml
# examples/open-pr/tests/open-pr.test.yaml (excerpt)
rails: ../rails.yaml
path: [stubs]
tests:
  - name: unattended, no questions
    inputs: { auto: true }
    answers:
      text: { title: 'feat: add a' }
    expect:
      status: done
      message: 'PR created: https://github.com/acme/app/pull/7'
      steps: { draft: skipped, create: success }
```

```bash
npx skill-rails test examples/open-pr
```

These tests check execution paths and output contracts. Live steps and judges evaluate model answers separately; `record` turns saved runs into test files, and `trace` exports agent steps for evals. See [Testing](docs/testing.md).

## Benchmark

The same four skills ran as plain Markdown, as a YAML rails file, and as a TypeScript rails file: 5 headless runs of each, with Claude Sonnet, stub commands, and a local Git fixture. Every run of every variant did the task correctly.

| Task | Markdown | YAML rails | TypeScript rails |
|---|---|---|---|
| Push a branch (one script) | 4 turns · 6 s · $0.054 | 4 turns · 7 s · $0.056 | 4 turns · 8 s · $0.056 |
| Read the PR context (one script) | 4 turns · 8 s · $0.055 | 4 turns · 8 s · $0.057 | 4 turns · 7 s · $0.057 |
| Run the checks (judgment-heavy) | 5 turns · 12 s · $0.069 | 6 turns · 16 s · $0.078 | 6 turns · 14 s · $0.077 |
| Open a PR, unattended (many mechanical steps) | 23 turns · 36 s · $0.178 | 8 turns · 17 s · $0.094 | 8 turns · 18 s · $0.094 |

Medians. The gain grows with the mechanical steps: the PR workflow took 65% fewer turns and cost 47% less. A one-script skill gains nothing. A skill made mostly of agent steps can cost more, because each agent step is a turn: give its mechanical parts to scripts. YAML and TypeScript give the agent the same steps, so their difference shows the noise of the measure; the TypeScript runner adds about 5 ms per call.

This is a small sample of one set of skills. See [the method and the full results](docs/benchmarks.md), and run your own with `skill-rails bench`.

## When it fits

Use skill-rails when a repeated task alternates between code and judgment, with gates or branches worth testing. A short checklist can stay Markdown; a fully mechanical task can stay a script.

The runner checks submitted step order and output structure. Model judgment still needs evaluation, and scripts run with the runner’s permissions. Fewer turns can reduce cost; gains depend on the task.

See [the comparison and tradeoffs](docs/design.md) for a fuller discussion of Markdown, scripts, cost, and guarantees.

## Documentation

- [Walkthrough: Markdown to rails](docs/walkthrough.md)
- [Comparison, advantages, and tradeoffs](docs/design.md)
- [Architecture and state](docs/architecture.md)
- [CLI, Node API, and MCP](docs/cli.md)
- [Format and protocol](docs/format.md)
- [Tests and live evals](docs/testing.md)
- [Benchmarks](docs/benchmarks.md)
- [Agent setup and hooks](docs/agents.md)
- [Changelog](CHANGELOG.md)

## Contributing

```bash
yarn install
yarn lint
yarn typecheck
yarn test
```

MIT license.
