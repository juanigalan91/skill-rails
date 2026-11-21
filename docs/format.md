# The flow format

A flow is a YAML file, checked against [`schema/flow.schema.json`](../schema/flow.schema.json).
The runner goes through its steps in order.
It runs the `run` and `stop` steps itself, and it gives the `skill`, `prompt` and `ask` steps to the agent, one at a time.

```yaml
name: open-pr                 # kebab-case; the state file and the done command use it
description: Open the PR of the current branch.
inputs:
  auto:
    type: boolean             # string (default), boolean or number
    default: false
    description: Run with no questions.
steps:
  - id: context
    run: context.sh
  - if: ${{ !steps.context.outputs.commits }}
    stop: Nothing to merge.
    outcome: failure
  - id: text
    prompt-file: prompts/text.md
    output:
      type: object
      required: [title]
      properties:
        title: { type: string }
  - id: create
    run: create.sh
    env:
      TITLE: ${{ steps.text.outputs.title }}
```

## Folder layout

```text
my-skill/
  SKILL.md        # the short loop: start the flow, do each step, report it
  flow.yaml       # the order, the conditions and the inputs of the steps
  scripts/        # the code of the run steps; this folder is in PATH
  prompts/        # the instructions of the agent steps
```

## Steps

Every step can have an `id` (kebab-case, unique) and an `if`.
Agent steps need an `id`.
When `if` is false, the step is skipped, and `steps.<id>.outcome` is `skipped`.

### `run`

The runner runs the command with `bash -eo pipefail`, in the working directory of the flow.

```yaml
- id: build
  run: build.sh
  env:
    TARGET: ${{ inputs.target }}
  continue-on-error: true
```

- `scripts/` next to `flow.yaml` is first in `PATH`, so `run: build.sh` runs `scripts/build.sh`.
- `$FLOW_DIR` is the folder of `flow.yaml`.
- The command writes its outputs to the file `$FLOW_OUTPUT`, as in GitHub Actions: `key=value` lines, or `key<<EOF`, several lines, then `EOF`.
  Later steps read them as `steps.<id>.outputs.<key>`.
- A `::warning::<text>` line on stdout becomes a note that the agent shows to the user.
- A command that fails ends the flow with its last 20 lines of stderr, unless the step has `continue-on-error: true`.
  `steps.<id>.outcome` is `success` or `failure`.
- `env` values can be `${{ }}` expressions.
  A list becomes one line per item, and an object becomes JSON.
- A `run` command must not hold `${{ }}`: the check refuses it.
  A value can hold shell code (a commit message, a title), so pass every value with `env`.

#### Polling

A `run` step with `until` runs its command again until the condition is true: for example, wait for CI or a deploy.

```yaml
- id: ci
  run: ci-state.sh                 # writes state=pending, success or failure
  until: ${{ steps.ci.outputs.state != 'pending' }}
  interval-seconds: 30             # default 30
  timeout-minutes: 30              # default 30; the step fails after it
```

- In `until`, `steps.<id>` holds the result of the last run.
- A run that fails (exit code not 0) ends the polling as a failure: report "not ready yet" in an output, not with the exit code.
- The runner gives control back to the agent after 9 minutes (`SKILLFLOW_WAIT_SLICE_SECONDS`), so that one command stays under the tool timeout of the agent.
  The agent then gets a `wait` step: it reports it as done, with no output, and the polling goes on.

### `prompt`

The agent follows the instructions, then reports an output.

```yaml
- id: summary
  prompt-file: prompts/summary.md
  output:
    type: object
    required: [summary]
    properties:
      summary: { type: string, maxLength: 300 }
```

- `prompt` holds the instructions inline, and `prompt-file` names a Markdown file relative to `flow.yaml`.
  Both can hold `${{ }}` expressions.
- `output` is a JSON Schema.
  The runner validates the reported output and refuses it with the errors when it does not match.
  With no `output`, the agent reports nothing, or any JSON object.

### `skill`

The agent invokes another skill with `with` as its arguments, then follows the optional `prompt` or `prompt-file`.

```yaml
- id: review
  skill: code-review
  with: the current branch
  prompt: Report the number of findings.
  output: { type: object, required: [findings], properties: { findings: { type: integer } } }
```

When the other skill only runs a script, call the script in a `run` step: it costs no model turn.

### `ask`

The agent asks the user one or more multiple-choice questions.

```yaml
- id: confirm
  ask:
    - id: answer
      header: Confirm          # 12 characters at most
      question: Push the branch now?
      options:
        - { label: Push, description: Push and open the PR. }
        - { label: Stop, description: Stop with no change. }
    - id: checks
      if: ${{ steps.list.outputs.commands[0] }}
      header: Checks
      question: Which checks do you want to run?
      multiSelect: true
      options:
        - ${{ steps.list.outputs.commands }}   # a list of { label, description }
        - { label: None, description: Run no check. }
```

- Every option needs a `label` and a `description`.
  An option can also have a `preview`: text that the question tool shows next to it, for example a draft to approve.
- An option can be an expression that gives a list of options.
- A question with a false `if` is left out.
  When all the questions are left out, the step is skipped.
- The output has one property per question `id`: the label, or a list of labels for `multiSelect`.
  The runner validates the labels.

- A question with `free: true` takes free text: the agent asks it in a normal message and reports the reply.
  Its options are optional suggestions, and the output is a non-empty string.

### `foreach`

The runner runs the steps once for each item of a list.

```yaml
- id: comments
  foreach: ${{ fromJSON(steps.fetch.outputs.comments) }}
  steps:
    - id: propose
      prompt: 'Propose a fix for: ${{ item.body }} (comment ${{ loop.index }} of ${{ loop.count }})'
      output: { type: object, required: [fix], properties: { fix: { type: string } } }
    - id: decide
      ask:
        - { id: answer, header: Fix, question: 'Apply the fix?', options: [ { label: Apply, description: Apply it. }, { label: Skip, description: Skip it. } ] }
    - if: ${{ steps.decide.outputs.answer == 'Apply' }}
      run: reply.sh
      env: { ID: '${{ item.id }}' }
- stop: '${{ steps.comments.outputs.count }} comments handled'
```

- `foreach` is an expression that gives a list, or a YAML list.
  An empty list skips the steps.
- Inside, `item` is the current item, and `loop.index` (from 0) and `loop.count` give its place.
- The steps of an iteration see the steps before the `foreach`, and the steps of the same iteration.
  Each iteration starts with no results.
- After the loop, `steps.<id>.outputs.count` is the number of items, and `steps.<id>.outputs.results` is the list of the iterations: `{ item, steps }`.
- A `stop` inside the loop ends the flow.
- A `break` step (`break: true`, often with an `if`) ends the loop, and the flow goes on after it.
  `steps.<id>.outputs.done` is then the number of iterations that ran, and `broken` is true.

### `uses`

The runner runs another flow as one step.

```yaml
- id: ci
  uses: ../diagnose-ci/flow.yaml   # relative to this flow file
  with:
    pr: ${{ steps.context.outputs.pr_number }}
  continue-on-error: true
```

- The other flow has its own inputs (from `with`), its own steps and its own folder (`flow.dir`, `scripts/`).
- Its end becomes the outputs of the step: `status` (`done` or `failed`), `message` (its stop message), and `steps` (its step results).
- When it fails, the flow fails, unless the step has `continue-on-error: true`.
- `check` loads the other flows too, and refuses flows that use each other.

### `stop`

The runner ends the flow with a message.

```yaml
- if: ${{ !steps.context.outputs.branch }}
  stop: The current commit is a detached HEAD.
  outcome: failure     # success (default) or failure
```

The last step of a flow is usually a `stop` with the result.
A flow with no more steps ends with `done` and no message.

## Expressions

`${{ }}` expressions use the GitHub Actions syntax and rules, evaluated by [`@actions/expressions`](https://github.com/actions/languageservices/tree/main/expressions).

| Context | Value |
|---------|-------|
| `inputs.<name>` | A flow input. |
| `steps.<id>.outcome` | `success`, `failure` or `skipped`. |
| `steps.<id>.outputs.<key>` | An output of a `run` step, or a property of the output of an agent step. |
| `item`, `loop.index`, `loop.count` | Inside a `foreach`: the current item and its place. |
| `env.<NAME>` | An environment variable of the runner. |
| `flow.dir`, `flow.name` | The folder and the name of the flow. |

- The functions are the GitHub ones: `contains`, `startsWith`, `endsWith`, `format`, `join`, `toJSON`, `fromJSON`.
- `==` compares strings with no case.
- A value that is one expression keeps the type of its result (a list, a boolean).
  Text with expressions becomes a string.
- `if:` can be a bare expression, with no `${{ }}`.
- A step that did not run has no outputs, so `steps.<id>.outputs.<key>` is `null`.
  A step that depends on a skipped step is often skipped too.

## The protocol

Each command prints one JSON object.

| `status` | Meaning | The agent |
|----------|---------|-----------|
| `step` | A step waits for the agent: `id`, `type`, and `instructions`, `skill` and `args`, or `questions`, with `output`. | Does the step, then reports it with `done`. |
| `step` with `type: wait` | A polling step needs more time. | Reports it with `done` and no output, to keep waiting. |
| `invalid` | The output does not match: `errors`. | Corrects the output and reports it again. |
| `done` | The flow ended: `message`. | Tells the user the message. |
| `failed` | A step failed, a `stop` with `outcome: failure`, or a `--fail`: `message`. | Tells the user the message. |
| `error` | The flow file or a command is not valid: `errors`. | Tells the user the errors. |

A result can also have `notes`: the warnings of the run steps, which the agent shows to the user.

The state is a JSON file per flow name and working directory, in `$SKILLFLOW_STATE_DIR` (default: the system temp folder).
`start` resets it.
