<div align="center">

# skill-rails

### Stop hoping your agent follows the steps. Make it follow them.

[![npm](https://img.shields.io/npm/v/skill-rails.svg)](https://www.npmjs.com/package/skill-rails)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

**2× faster · up to 40% cheaper · the same result, every run**

</div>

---

You wrote a great skill.
It has twelve steps, four conditions, and one rule that must never break.
Then the model skips step 7, runs `git log` five times, and invents a flag for `gh`.

**skill-rails turns a skill into a flow.**
Code does the steps that are always the same.
The agent does only the steps that need judgment, one at a time.
Every answer is checked against a schema before the flow goes on.

| | Markdown skill | skill-rails |
|---|---|---|
| Order of the steps | The model remembers it | The runner enforces it |
| `if` conditions and gates | The model reads them | `${{ }}` expressions, evaluated in code |
| `git`, `gh`, checks, file operations | Model turns, tokens, mistakes | Scripts, with no model turn |
| Values between steps | Free text in the context | JSON outputs, validated against a schema |
| Questions to the user | Mixed into the prompt | Typed `ask` steps, with validated answers |
| Loops, waits and reuse | "Do this for each comment", "wait for CI" | `foreach`, `run` with `until`, and `uses` to call another flow |
| The skill file | One long prompt | `flow.yaml` + `scripts/` + `prompts/` that you can test and review |

The flow format is the GitHub Actions syntax that you already know: `steps`, `if: ${{ }}`, `run`, `env`, `$FLOW_OUTPUT`.
It runs inside the session of your agent, with its context, its tools and its permissions: you add no new service and no API key.

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

**After:** `flow.yaml` holds the order and the conditions, `scripts/` the commands, and `prompts/` the only part that needs the model.

```yaml
# flow.yaml
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

The agent drives the loop from inside its own session, so the flow keeps the session context, the tools and the permissions of the agent:

```text
agent ── start flow.yaml ──▶ runner  (runs the shell steps, then stops at the first agent step)
agent ◀── { status: step, instructions, output schema } ──
agent ── done <step> <json> ──▶ runner  (validates the output, runs the next shell steps)
agent ◀── { status: done, message } ──
```

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

As a CLI or a library (Node 20 or later):

```bash
yarn add skill-rails        # or: npx skill-rails check flow.yaml
yarn skill-rails check flow.yaml
```

```ts
import { start, done } from 'skill-rails';
```

The MCP server works with any MCP client:

```json
{ "mcpServers": { "skill-rails": { "command": "npx", "args": ["-y", "skill-rails@0.2", "mcp"] } } }
```

## Use

- **Run a flow:** the `run-skill-rails` skill, the MCP tools `flow_start` and `flow_done`, or the CLI.
- **Create a skill:** the `create-skill-rails` skill designs the steps and writes `flow.yaml`, `scripts/` and `prompts/`.
- **Migrate a skill:** the `migrate-to-skill-rails` skill converts a Markdown skill, keeps every rule, and compares the two versions.

A flow skill is a folder:

```text
my-skill/
  SKILL.md        # the short loop: start the flow, do each step, report it
  flow.yaml       # the order, the conditions and the inputs
  scripts/        # the code of the run steps (in PATH)
  prompts/        # the instructions of the agent steps
```

## Testing

A flow is deterministic everywhere except in the agent steps, so you can test it with no model.
A test gives the answers that the agent would give, and the runner does the rest for real: scripts, conditions, outputs and files.

```yaml
# tests/open-pr.test.yaml
flow: ../flow.yaml
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
skill-rails start <flow.yaml> [--input <key>=<value> ...]   check the flow, reset its state, print the first agent step
skill-rails done <flow> <step-id> [--output <json> | -]     record the output of a step, print the next step
skill-rails done <flow> <step-id> --fail <reason>           end the flow with an error
skill-rails status <flow>                                   print the current step and the step results
skill-rails reset <flow>                                    delete the state of a flow
skill-rails check <flow.yaml>                               check a flow file without running it
skill-rails mcp                                             run the MCP server on stdio
```

## Documentation

- [The flow format](docs/format.md): steps, expressions, outputs, and the protocol.
- [Testing flows](docs/testing.md): answers, fixtures, stubs and expectations.
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
