# From a Markdown skill to rails

[Back to README](../README.md)

## Bundled skills

- **Run a skill:** the `run-skill-rails` skill, the MCP tools `rails_start` and `rails_done`, or the CLI.
- **Create a skill:** the `create-skill-rails` skill designs the steps and writes `rails.yaml`, `scripts/` and `prompts/`.
- **Migrate a skill:** the `migrate-to-skill-rails` skill audits the existing rules and rewrites the skill in place, using `rails.yaml` and the shared creation rails file. It creates no sibling copies or backups.

The bundled create and migrate skills run their own rails files. Scripts scaffold a new skill or prepare an existing directory for migration, validate the generated rails file, and run its deterministic tests; prompts handle design, authoring, repairs, and safe smoke runs. The runner skill stays as the Markdown bootstrap. See the [migration audit](skill-migration/README.md).

A skill-rails skill is a folder:

```text
my-skill/
  SKILL.md        # the short loop: start the run, do each step, report it
  rails.yaml      # the order, the conditions and the inputs (or rails.ts)
  scripts/        # the code of the run steps (in PATH)
  prompts/        # the instructions of the agent steps
```

## Before and after

The same skill, "open a pull request", as Markdown and as a rails file. The snippets below illustrate the split between instructions and code; the [complete example](../examples/open-pr/) includes the scripts, prompts, stubs, and tests.

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
    prompt: prompts/text.md            # the agent fills the body and writes the title
    output:
      type: object
      required: [title]
      properties:
        title: { type: string, maxLength: 72 }
  - id: create
    run: create.sh
    env:
      TITLE: ${{ steps.text.outputs.title }}
      BASE: ${{ steps.context.outputs.base }}
      BODY: ${{ steps.body-file.outputs.file }}
      DRAFT: true
  - stop: 'PR created: ${{ steps.create.outputs.url }}'
```

```bash
# scripts/context.sh (excerpt)
branch="$(git branch --show-current)"
echo "branch=$branch" >> "$RAILS_OUTPUT"
echo 'commits<<EOF' >> "$RAILS_OUTPUT"; git log "$merge_base..HEAD" --oneline >> "$RAILS_OUTPUT"; echo EOF >> "$RAILS_OUTPUT"
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
- The rails file can be tested with no model: see [Testing](testing.md).

The agent drives the loop from inside its own session and uses its tools for agent steps. The runner executes shell steps:

```text
agent ── start rails.yaml ──▶ runner  (runs the shell steps, then stops at the first agent step)
agent ◀── { status: step, instructions, output schema } ──
agent ── done <step> <json> ──▶ runner  (validates the output, runs the next shell steps)
agent ◀── { status: done, message } ──
```

## Testing

You can test the step order and the branches of a skill with no model by supplying fixed agent answers. Use fixtures and stub commands to control external dependencies; this does not evaluate the quality of real model answers.
A test gives the answers that the agent would give, and the runner does the rest for real: scripts, conditions, outputs and files. This excerpt omits the local repository setup; copy the [complete test file](../examples/open-pr/tests/open-pr.test.yaml) to run it.

```yaml
# tests/open-pr.test.yaml
rails: ../rails.yaml
path: [stubs]                       # a stub gh, so the test never calls GitHub
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

Run the complete example’s tests from the repository root:

```bash
npx skill-rails test examples/open-pr
```

Example output (timings vary):

```text
$ skill-rails test examples/open-pr
✓ interactive, new draft PR  (examples/open-pr/tests/open-pr.test.yaml, 2 agent steps, 1308 ms)
✓ unattended, no questions   (examples/open-pr/tests/open-pr.test.yaml, 1 agent steps, 640 ms)
✓ stops on the base branch   (examples/open-pr/tests/open-pr.test.yaml, 0 agent steps, 494 ms)
```

A test fails when the run asks for a step that has no answer, when an answer is never used, when an answer does not match its schema, or when the result is not the expected one.
See [Testing](testing.md).

For the runner’s reports, state, and data flow, see [Architecture](architecture.md). For manual operation, see the [CLI and API guide](cli.md).
