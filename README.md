<div align="center">

# skill-rails

### Stop hoping your agent follows the steps. Make it follow them.

[![npm](https://img.shields.io/npm/v/skill-rails.svg)](https://www.npmjs.com/package/skill-rails)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

**Enforced step order · validated outputs · fewer mechanical model turns**

</div>

---

You wrote a great skill.
It has twelve steps, four conditions, and one rule that must never break.
Then the model skips step 7, runs `git log` five times, and invents a flag for `gh`.

**skill-rails turns a skill into a flow.**
Code does the steps that are always the same.
The agent does only the steps that need judgment, one at a time.
Agent outputs are checked against their declared JSON Schema before the flow goes on. Without an explicit schema, the runner checks only that the output is an object.

## Why use a flow instead of a Markdown-only skill?

Markdown is a good format for instructions, examples, and judgment. A Markdown skill can already call scripts and keep references in separate files. skill-rails adds an executable contract for how those pieces run together.

| Concern | Markdown-only skill | skill-rails flow |
|---|---|---|
| Step order | The agent interprets and follows the sequence | The runner selects the next step and rejects submissions for a different step |
| Conditions and gates | The agent evaluates the written rule or calls a script | Expressions decide which steps execute, including failure stops |
| Mechanical work | The agent calls commands or a bundled script | Consecutive shell steps execute without a model turn between them |
| Values between steps | The agent tracks values or reads script outputs | Named outputs are available to later expressions; agent outputs can have JSON Schemas |
| User questions | The agent asks and interprets replies | `ask` defines the questions and validates submitted labels or free-text values |
| Loops and reuse | Instructions or scripts describe the repetition | `foreach`, polling, and subflows make the control flow explicit |
| Testing | Scripts can be tested; prompt behavior needs separate evaluation | Fixed agent answers let tests exercise branches, scripts, files, and outputs without a model |
| Inspection and continuation | Depend on the host session and any custom scripts | `status` exposes saved progress and the pending step between calls |

For a repeated release or PR workflow, this means a missing prerequisite can stop the flow in code, a malformed output can be rejected before the next command, and a branch can be regression-tested without paying for a model run. Prompts and reference material still belong in Markdown.

The flow format is the GitHub Actions syntax that you already know: `steps`, `if: ${{ }}`, `run`, `env`, `$FLOW_OUTPUT`.
The agent drives the flow from its existing session: you add no new service and no API key. Shell steps execute in the runner process; with MCP, that process has its own configured environment and permissions.

## Before and after

The same skill, "open a pull request", as Markdown and as a flow.

**Before:** `SKILL.md`, one long prompt.
The model must run every command, remember every value, and respect every condition.

````markdown
## Step 1: Gather the context
Run `git branch --show-current`, `gh pr view` and `git merge-base origin/<base> HEAD`.
Store the branch, the base, the open PR and the commits.
If the branch has no commits ahead of the base, stop: there is nothing to merge.
If the branch is the base branch, stop.

## Step 2: Push
Push the branch with `git push -u origin HEAD`. Never force-push.

## Step 3: Write the PR
Copy the PR template to a temp file, then fill it. Keep every HTML comment.
Write a title under 72 characters, in the format of the recent commits.

## Step 4: Create the PR
If the user wants a draft, add `--draft`.
Run `gh pr create --title "<title>" --body-file <file>` and show the URL.
````

**After:** `rails.yaml` holds the order and the conditions, `scripts/` the commands, and `prompts/` the only part that needs the model.

```yaml
# rails.yaml
name: open-pr
steps:
  - id: context
    run: context.sh                    # scripts/context.sh: branch, base, PR, commits, template
  - if: ${{ !steps.context.outputs.commits }}
    stop: Nothing to merge.
    outcome: failure
  - id: push
    run: push.sh                       # never force-pushes
  - id: body-file
    run: body-file.sh                  # copies the template
  - id: text
    prompt-file: prompts/text.md       # the agent fills the body and writes the title
    output:
      type: object
      required: [title]
      properties:
        title: { type: string, maxLength: 72 }
  - id: create
    run: create.sh
    env:
      TITLE: ${{ steps.text.outputs.title }}
  - stop: 'PR created: ${{ steps.create.outputs.url }}'
```

```bash
# scripts/context.sh (excerpt)
branch="$(git branch --show-current)"
echo "branch=$branch" >> "$FLOW_OUTPUT"
echo 'commits<<EOF' >> "$FLOW_OUTPUT"; git log "$merge_base..HEAD" --oneline >> "$FLOW_OUTPUT"; echo EOF >> "$FLOW_OUTPUT"
```

```markdown
<!-- prompts/text.md (excerpt) -->
Fill `${{ steps.body-file.outputs.file }}` in place: one sentence on the goal, then 2–4 bullet points.
Write the title in the format of the recent commits:
${{ steps.context.outputs.recent }}
```

What changes:

- The model gets **one step**: the text. The other steps run as code, with no model turn.
- The gate "nothing to merge" is an `if:` that always runs, and the title is checked against `maxLength: 72`.
- The flow can be tested with no model: see [Testing](#testing).

The agent drives the loop from inside its own session and uses its tools for agent steps. The runner executes shell steps:

```text
agent ── start rails.yaml ──▶ runner  (runs the shell steps, then stops at the first agent step)
agent ◀── { status: step, instructions, output schema } ──
agent ── done <step> <json> ──▶ runner  (validates the output, runs the next shell steps)
agent ◀── { status: done, message } ──
```

## Where the approach holds up—and where it does not

### Why not just write a better Markdown skill?

For a short task, that is often the better choice. A checklist is easy to read and change, and it leaves room to adapt when the work is exploratory. A flow becomes useful when the same sequence runs repeatedly and a missed gate, malformed value, or unnecessary tool call has a meaningful cost. Maintaining YAML, schemas, scripts, and tests needs to earn its place.

### Why not just write a script?

If all the work is mechanical, write a script. A Markdown skill that calls one well-tested script can already remove most of the model overhead. skill-rails helps when execution must alternate between code and judgment: collect context, ask the user, request a draft, validate its shape, then continue in code. Its value is coordinating those handoffs, rather than replacing shell scripts.

### Does this make the agent deterministic?

It makes the declared control flow explicit and runner-enforced. It does not guarantee identical model answers, correct reasoning, or identical results from commands that depend on networks, time, or changing repositories. A schema can check that a title is a string under 72 characters; it cannot establish that the title accurately describes the change. Add domain checks where possible and evaluate agent quality separately.

### Can the agent still skip a rule or claim it did the work?

The runner rejects out-of-order submissions and invalid outputs, but it trusts accepted agent reports. It cannot prove that a prompt was followed, that an answer really came from the user, or prevent the agent from acting outside the flow. It is workflow control, not a security boundary. Shell steps run with the runner process's permissions.

### What happens after an interruption?

Saved state lets the agent retrieve the pending step and continue between completed calls. It is not a transaction log or an exactly-once execution guarantee: a command can change an external system before the updated state is saved. Make side effects safe to retry or check whether they already happened. State is local, stored in a temporary directory by default, and keyed by project directory and flow name; concurrent runs of that same flow need separate state directories.

### Will it always be faster or cheaper?

No. Batching mechanical steps can reduce model turns, but each agent handoff still adds work, and research-heavy flows may gain little. The measurements below cover two small examples, not a general performance guarantee. Agent installation, tool timeouts, Bash availability, and skill discovery also vary; see [agent compatibility](docs/agents.md).

Start with Markdown and scripts. Add a flow when repeated handoffs, gates, and testable branches justify the extra structure.

## Benchmarks

Two skills, each run headless 3 times as a Markdown skill and as a skill-rails flow, on the same input.
Both versions gave the same result in every run.

| Skill | Version | Duration | Model turns | Cost |
|-------|---------|----------|-------------|------|
| A | Markdown | 37 s | 21 | $0.43 |
| A | skill-rails | 17–20 s | 7–8 | $0.25–0.28 |
| B | Markdown | 38 s | 9 | $0.29 |
| B | skill-rails | 30 s | 8 | $0.21–0.25 |

These are small samples on simple inputs.
The gain is largest when a skill has many mechanical steps.
It is small when most of the work is research that only the model can do.

## Install

As a Claude Code plugin, with the skills and the MCP server:

```text
/plugin marketplace add juanigalan91/skill-rails
/plugin install skill-rails@skill-rails
```

As a Codex plugin:

```bash
codex plugin marketplace add juanigalan91/skill-rails
codex plugin add skill-rails@skill-rails
```

This installs the three skills and the local MCP configuration. See [Codex setup](docs/agents.md#codex) for local installation and client requirements.

As a CLI or a library (Node 20 or later):

```bash
yarn add skill-rails        # or: npx skill-rails check rails.yaml
yarn skill-rails check rails.yaml
```

```ts
import { start, done } from 'skill-rails';
```

The MCP server works with any MCP client:

```json
{ "mcpServers": { "skill-rails": { "command": "npx", "args": ["-y", "skill-rails@0.2", "mcp"] } } }
```

## Other agents

Codex, Cursor, Copilot in VS Code, Gemini CLI, and OpenCode can use the shared skills through the CLI or local MCP server. See [agent setup and compatibility](docs/agents.md) for configuration, current verification status, and a client smoke test. Native Codex plugin packaging is included from version 0.2.2.

## Use

- **Run a flow:** the `run-skill-rails` skill, the MCP tools `flow_start` and `flow_done`, or the CLI.
- **Create a skill:** the `create-skill-rails` skill designs the steps and writes `rails.yaml`, `scripts/` and `prompts/`.
- **Migrate a skill:** the `migrate-to-skill-rails` skill audits the existing rules and rewrites the skill in place, using `rails.yaml` and the shared creation flow. It creates no sibling copies or backups.

The bundled create and migrate skills run their own YAML flows. Scripts scaffold a new skill or prepare an existing directory for migration, validate the generated flow, and run its deterministic tests; prompts handle design, authoring, repairs, and safe smoke runs. The runner skill stays as the Markdown bootstrap. See the [migration audit](docs/skill-migration/README.md).

A flow skill is a folder:

```text
my-skill/
  SKILL.md        # the short loop: start the flow, do each step, report it
  rails.yaml       # the order, the conditions and the inputs
  scripts/        # the code of the run steps (in PATH)
  prompts/        # the instructions of the agent steps
```

## Testing

You can test the runner’s control flow with no model by supplying fixed agent answers. Use fixtures and stub commands to control external dependencies; this does not evaluate the quality of real model answers.
A test gives the answers that the agent would give, and the runner does the rest for real: scripts, conditions, outputs and files.

```yaml
# tests/open-pr.test.yaml
flow: ../rails.yaml
path: [stubs]                       # a stub gh, so the test never calls GitHub
setup: |                            # a local remote and a branch with one commit
  git init -q --bare "$(mktemp -d)/origin.git" ...
tests:
  - name: unattended, new draft PR
    inputs: { auto: true }
    answers:
      text: { title: 'feat: add a' }
    expect:
      status: done
      message: 'PR created: https://github.com/acme/app/pull/7'
      steps: { draft: skipped, create: success }
```

```text
$ skill-rails test
✓ interactive, new draft PR  (examples/open-pr/tests/open-pr.test.yaml, 2 agent steps, 1308 ms)
✓ unattended, no questions   (examples/open-pr/tests/open-pr.test.yaml, 1 agent steps, 640 ms)
✓ stops on the base branch   (examples/open-pr/tests/open-pr.test.yaml, 0 agent steps, 494 ms)
```

A test fails when the flow asks for a step that has no answer, when an answer is never used, when an answer does not match its schema, or when the result is not the expected one.
See [Testing flows](docs/testing.md).

## CLI

```text
skill-rails start <rails.yaml> [--input <key>=<value> ...]   check the flow, reset its state, print the first agent step
skill-rails done <flow> <step-id> [--output <json> | -]     record the output of a step, print the next step
skill-rails done <flow> <step-id> --fail <reason>           end the flow with an error
skill-rails status <flow>                                   print the current step and the step results
skill-rails reset <flow>                                    delete the state of a flow
skill-rails check <rails.yaml>                               check a flow file without running it
skill-rails mcp                                             run the MCP server on stdio
```

## Documentation

- [The flow format](docs/format.md): steps, expressions, outputs, and the protocol.
- [Testing flows](docs/testing.md): answers, fixtures, stubs and expectations.
- [Agent compatibility](docs/agents.md): setup for other agents and verification.
- [Examples](examples/): `hello` and `open-pr`.

## Security

- A `run` command cannot hold `${{ }}`: values go through `env`, so a commit message or a title cannot run as shell code.
- The runner runs the scripts of the flow with the permissions of the user who starts it.
  Read a flow and its scripts before you run them, as you read any script.

## Related projects

- [claude-workflow](https://github.com/AxGord/claude-workflow): YAML state machines that a Claude Code agent moves through with an MCP server.
  skill-rails adds schema-validated outputs, user questions, and the GitHub Actions syntax.
- [Archon](https://github.com/coleam00/Archon) and [GitHub Agentic Workflows](https://github.com/github/gh-aw): the runner starts the agent.
  In skill-rails, the agent drives the runner from inside its own session.
- [Goose recipes](https://github.com/aaif-goose/goose): YAML recipes with structured output.

## Contributing

```bash
yarn install
yarn typecheck
yarn test
```

## License

MIT
