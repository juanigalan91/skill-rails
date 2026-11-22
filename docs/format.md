# The rails file format

A rails file (`rails.yaml`) is a YAML file, checked against [`schema/rails.schema.json`](../schema/rails.schema.json).
The runner goes through its steps in order.
It runs the `run` and `stop` steps itself, and it gives the `skill`, `prompt` and `ask` steps to the agent, one at a time.

```yaml
name: open-pr                 # kebab-case; the state file and the done command use it
description: Open the PR of the current branch.
inputs:
  auto:
    type: boolean             # string (default), boolean, number or list
    default: false
    description: Run with no questions.
  mode:
    enum: [draft, ready]      # the allowed values: the start fails with any other value
outputs:                      # what the rails file gives back at its end (optional)
  url: ${{ steps.create.outputs.url }}
steps:
  - id: context
    run: context.sh
  - if: ${{ !steps.context.outputs.commits }}
    fail: Nothing to merge.
  - id: text
    prompt: prompts/text.md
    output: { title: string }
  - id: create
    run: create.sh
    env:
      TITLE: ${{ steps.text.outputs.title }}
```

## YAML linting

Run `yarn lint` from the checkout to check all YAML syntax and validate rails files against `schema/rails.schema.json`. ESLint uses `eslint-plugin-yml` and `eslint-plugin-json-schema-validator`; schema validation uses the local file and disables SchemaStore lookups. Changes to allowed keys in the schema therefore apply to linting too.

Schema checks cover `rails.yaml`/`rails.yml` and nested rails files under `skills/`, `examples/`, and `test/scenarios/skills/`. Test definitions (`*.test.yaml`, `*.test.yml`, and files under `tests/`) and GitHub Actions files receive YAML syntax checks without the rails schema, because they use different formats. Ignored dependency/build directories are excluded.

Install the recommended **YAML** (Red Hat) and **ESLint** extensions in VS Code or Cursor. The repository settings associate rails files with the same local schema for allowed-key completion and validation. For a rails file outside the configured paths, add its glob to both `eslint.config.js` and `.vscode/settings.json`.

Linting checks YAML structure, keys, and types. Use `skill-rails check path/to/rails.yaml` for runner-specific validation such as duplicate step IDs, expressions, prompt files, and the resolution of nested rails files. Neither command runs the steps.

## Folder layout

```text
my-skill/
  SKILL.md        # the short loop: start the run, do each step, report it
  rails.yaml       # the order, the conditions and the inputs of the steps
  scripts/        # the code of the run steps; this folder is in PATH
  prompts/        # the instructions of the agent steps
```

## Steps

Every step can have an `id` (kebab-case, unique) and an `if`.
Agent steps need an `id`.
When `if` is false, the step is skipped, and `steps.<id>.outcome` is `skipped`.

### `run`

The runner runs the command with `bash -eo pipefail`, in the working directory of the run.

```yaml
- id: build
  run: build.sh
  env:
    TARGET: ${{ inputs.target }}
  continue-on-error: true
```

- `scripts/` next to `rails.yaml` is first in `PATH`, so `run: build.sh` runs `scripts/build.sh`.
  Then comes the `scripts/` folder of the plugin that holds the rails file: the nearest folder above it with `.claude-plugin/plugin.json` or `.codex-plugin/plugin.json`.
  The skills of a plugin can so share scripts with no path.
- A script in `scripts/` needs a shebang (`#!/usr/bin/env bash`, `#!/usr/bin/env node`) and the executable bit (`chmod +x`): then `run: build.mjs` runs it, with no path.
- `$RAILS_DIR` is the folder of `rails.yaml`, for the other files of the skill.
- The command writes its outputs to the file `$RAILS_OUTPUT`, as in GitHub Actions: `key=value` lines, or `key<<EOF`, several lines, then `EOF`.
  Later steps read them as `steps.<id>.outputs.<key>`.
- A `::warning::<text>` line on stdout, or a `WARNING: <text>` line on stderr, becomes a note that the agent shows to the user.
- A command that fails ends the run with its last 20 lines of stderr, unless the step has `continue-on-error: true`.
  `continue-on-error: [3]` goes on only for these exit codes.
- `working-directory` runs the command in another folder, relative to the project (or to the `working-directory` of the rails file).
  `steps.<id>.outcome` is `success` or `failure`, `steps.<id>.exitCode` is the exit code, and `steps.<id>.error` holds the last lines of stderr of a failed step.
- `args` adds arguments to the command, each one quoted for bash.
  It is a list, or one value: `args: ${{ item.dir }}` adds one argument, or each item when the value is a list.
  Its values can be `${{ }}` expressions: a list adds each of its items, and `null`, `false` or an empty string adds nothing, so an optional argument needs no shell code.
  A map adds flags: `--name: true` adds `--name`, a list adds `--name` before each item, another value adds `--name` and the value, and an empty value adds nothing.
- `env` values can be `${{ }}` expressions.
  A list becomes one line per item, and an object becomes JSON.
- A `run` command must not hold `${{ }}`: the check refuses it.
  A value can hold shell code (a commit message, a title), so pass every value with `args` or `env`.
- `stdout` reads the outputs from what the command prints, so that a script needs no `$RAILS_OUTPUT`:
  - `text` — `steps.<id>.outputs.value` is the text.
  - `env` — `KEY=value` lines, as in `$RAILS_OUTPUT`.
  - `json` — the keys of a JSON object become the outputs; another JSON value is `steps.<id>.outputs.value`.
  - `jsonl` — `steps.<id>.outputs.value` is the list of the JSON lines, also for one line.

```yaml
- id: base
  run: git-base-branch.sh
  args:
    - ${{ inputs.base }}
    - --refresh: ${{ inputs.refresh }}    # --refresh when true
      --worktree: ${{ inputs.worktree }}  # --worktree <path> when set
  stdout: env                     # BASE=main → steps.base.outputs.BASE
```

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
- The runner uses a 20-second polling slice (`SKILL_RAILS_WAIT_SLICE_SECONDS`). Each poll command is limited to the remaining slice and overall polling deadline; an overlong command fails. Keep status checks short.
  The agent gets a `wait` step with `retryAt` (Unix milliseconds). It waits until that time, then reports the step as done with no output. Early calls preserve the scheduled check. Ordinary non-polling commands retain their own timeout; this is not a global call deadline.

### `prompt`

The agent follows the instructions, then reports an output.

```yaml
- id: summary
  prompt: prompts/summary.md
  output:
    type: object
    required: [summary]
    properties:
      summary: { type: string, maxLength: 300 }
```

- `prompt` holds the instructions, or the path of a Markdown file with them, relative to `rails.yaml`.
  A prompt is a file path when it is one word that ends with `.md`, for example `prompts/summary.md`; the check fails when the file is missing.
  Any other text, with spaces or several lines, is the instructions.
  Both can hold `${{ }}` expressions.
- A relative Markdown link in a prompt, for example `[the guide](../references/guide.md)`, is relative to the prompt file (to `rails.yaml` for inline instructions).
  The runner makes it absolute, because the agent works in the project folder.
  `check` reports a link to a missing file.
  Links in code blocks stay as they are.
- `with` gives the step named values.
  The runner fills their `${{ }}` expressions, and adds them as a YAML block after the instructions.
  Then the prompt file holds only text, and the rails file holds the data paths:

  ```yaml
  - id: summary
    prompt: prompts/summary.md
    with:
      ticket: ${{ inputs.ticket || 'a free-text task' }}
      pullRequests: ${{ steps.implement.outputs.pullRequests }}
  ```

  The agent gets `Write the summary.` and then `Values:` with `ticket: ABC-1` and the list of pull requests.
  Prefer `with` to long expressions in a prompt file: a renamed step then breaks the rails file, which `check` reads.
- `output` is a JSON Schema, or its short form.
  The runner validates the reported output and refuses it with the errors when it does not match.
  With no `output`, the agent reports nothing, or any JSON object.
- The short form maps each property to its type:

  ```yaml
  output:
    title: string                 # required, not empty
    draft: boolean
    kind: fix | skip | ask        # one of these texts
    files: [string]               # a list
    issues: [{ file: string, line?: integer }]
    note?: string                 # optional (the ? can also go after the type)
    details: { type: string, maxLength: 300 }   # a full schema for one property
  ```

  The types are `string`, `boolean`, `number`, `integer`, `object`, `array` and `any`.
  An output with only JSON Schema keywords (for example `type` and `properties`) is a full schema; a property named `type` alone needs the full form.
- The check refuses an output schema with an unknown keyword.
  The usual cause is a YAML flow map with a comma in a text: `{ type: string, description: The title, in a few words }` splits the description into a stray key.
  Quote such a text.

A `prompt` or `skill` step with `working-directory` has `directory` in its report: the agent does the step in that folder.

A `prompt` or `skill` step with `continue-on-error: true` goes on when the agent reports with `--fail` that it cannot do the step: `steps.<id>.outcome` is then `failure`, and `steps.<id>.error` holds the reason.

### `skill`

The agent loads and follows another installed skill through its host’s supported mechanism, with `with` as its arguments, then follows the optional `prompt`. If the skill is unavailable, the agent reports failure.

```yaml
- id: review
  skill: code-review
  with: the current branch
  prompt: Report the number of findings.
  output: { type: object, required: [findings], properties: { findings: { type: integer } } }
```

`with` is a text, or a map of named values that the agent gets as YAML arguments.

When the other skill only runs a script, call the script in a `run` step: it costs no model turn.

### `ask`

The agent asks the user one or more questions using a native question tool or chat if the tool cannot represent them. It waits for the reply before reporting an answer.

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
- An option with a `value` puts that value in the step output in place of its label, so that later steps do not repeat the label: `{ label: Yes — fetch it, description: …, value: true }`.
- An option can be a plain label (`options: [Push, Stop]`), and its `description` is optional.
- An option can be an expression that gives a list of options.
- A question with a false `if` is left out.
  When all the questions are left out, the step is skipped.
- The output has one property per question `id`: the label, or a list of labels for `multiSelect`.
- `other: true` keeps the options, and the user can also type another answer: the output is the label or the text.
- `ask` can also be an expression that gives the questions, for example the questions that an agent step wrote:

  ```yaml
  - id: answers
    ask: ${{ steps.investigate.outputs.questions }}   # a list of { id?, header?, question, options?, multiSelect?, other? }
    max: 4                                            # default 4: the extra questions are left out
    extra-options:                                    # added to each question that has options
      - { label: I don't know, description: Leave it out. }
  ```

  A question with no `id` gets `q1`, `q2` and so on, a long `header` is cut to 12 characters, an option can be a plain label, and a question with no options takes free text.
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
- A `stop` inside the loop ends the run.
- A `break` step (`break: true`, often with an `if`) ends the loop, and the run goes on after it.
  `steps.<id>.outputs.done` is then the number of iterations that ran, and `broken` is true.

### `repeat`

The runner runs the steps again and again, until a condition is true: for example, until the user stops asking for more context.

```yaml
- id: choose
  repeat:
    until: ${{ steps.decide.outputs.answer != 'Show more context' }}
    max-iterations: 10            # default 10
  steps:
    - id: more
      if: ${{ loop.index > 0 }}   # not in the first iteration
      prompt: prompts/more.md
      output: { type: object, required: [draft], properties: { draft: { type: string } } }
    - id: decide
      ask:
        - id: answer
          header: Draft
          question: Keep this draft?
          options:
            - { label: Keep, description: Keep it., preview: '${{ steps.more.outputs.draft || steps.draft.outputs.draft }}' }
            - { label: Show more context, description: Read more before you decide. }
- stop: 'Kept: ${{ steps.choose.outputs.last.more.outputs.draft || steps.draft.outputs.draft }}'
```

- The runner checks `until` after each iteration, with the results of that iteration.
  The loop ends when `until` is true, or after `max-iterations` iterations.
- Inside, `loop.index` is the number of the iteration (from 0), and `loop.count` is `max-iterations`.
- `loop.number` is `loop.index + 1`, and `loop.parent` is the loop around this one, for example the `foreach` around a `repeat`: `${{ loop.parent.number }}`.
- `loop.previous` holds the step results of the last iteration (null in the first one), for example the change that the user asked for: `${{ loop.previous.approve.outputs.answer }}`.
  In a `repeat` inside a `foreach`, `item` stays the item of the `foreach`.
- Each iteration starts with no results, as in a `foreach`.
- After the loop, `steps.<id>.outputs.last` holds the step results of the last iteration, `count` is the number of iterations, and `results` is the list of the iterations: `{ steps }`.
  `exhausted` is true when the loop ended at `max-iterations` with `until` still false.
- A `stop` inside the loop ends the run, and a `break` ends the loop: `broken` is then true.

### `uses`

The runner runs another rails file as one step.

```yaml
- id: ci
  uses: ../diagnose-ci/rails.yaml   # relative to this rails file
  with:
    pr: ${{ steps.context.outputs.pr_number }}
  continue-on-error: true
```

- The other rails file has its own inputs (from `with`), its own steps and its own folder (`rails.dir`, `scripts/`).
- Its end becomes the outputs of the step: `status` (`done` or `failed`), `message` (its stop message), and `steps` (its step results).
- When it fails, the run fails, unless the step has `continue-on-error: true`.
  The failure can be a `run` step, a `stop` with `outcome: failure`, or an agent step that the agent reports with `--fail`.
- `working-directory`: the folder where the other rails file runs its commands and its agent steps, relative to the project, for example a PR worktree.
  An agent step there has `directory` in its report.
- `forward-stop: true`: a `stop` step of the other rails file also ends this one, with the same message and outcome.
- `check` loads the other rails files too, and refuses rails files that use each other.

#### The rails file of another skill

`uses: skill:<plugin>:<skill>` runs the `rails.yaml` of a skill in another plugin, and `uses: skill:<skill>` the one of a standalone skill.
Use it when the other skill is installed separately, so that no relative path can reach it.

```yaml
- id: pr
  uses: skill:acme-core:pr-context
- if: ${{ !steps.pr.outputs.steps.context.outputs.PR_NUMBER }}
  stop: No open pull request.
```

The runner looks for the skill folder in this order, and uses the first one with a `rails.yaml`:

1. The folders of `SKILL_RAILS_SKILLS_PATH` (separated by `:`): `<dir>/<plugin>/skills/<skill>`, then `<dir>/<skill>`.
2. A checkout above the rails file: a folder with `.claude-plugin/plugin.json` for this plugin (`skills/<skill>`), or with `.claude-plugin/marketplace.json` that lists the plugin with a relative `source`.
   In a repository of plugins, the rails files and their tests then use the versions of the same commit.
3. The plugins that Claude Code installed (`installed_plugins.json` in `CLAUDE_CONFIG_DIR` or `~/.claude`), the ones of the marketplace of the rails file first.
4. For `skill:<skill>`: `.claude/skills`, `.agents/skills` in the working directory, and `~/.claude/skills`.

### `note`

The runner shows a message to the user (a note in the next report), and the run goes on.
An empty message shows nothing.

```yaml
- if: ${{ steps.after.outputs.value }}
  note: 'The checks changed these files: ${{ steps.after.outputs.value }}'
```

### `set`

Computes values with expressions, with no command and no agent turn.
The values keep their types: a boolean stays a boolean, and a list stays a list.

```yaml
- id: target
  set:
    site: ${{ inputs.site || steps.search.outputs.site }}
    rest: ${{ !steps.mcp.outputs.available }}
    metadata: ${{ inputs.metadata || fromJSON('[]') }}
```

`set` can also be one expression that gives an object: each key of the object becomes an output.
Use it to pick one of several objects, with no shell step:

```yaml
- id: values
  set: ${{ (inputs.context && fromJSON(inputs.context)) || steps.found.outputs }}
```

Any other value of the expression is `steps.<id>.outputs.value`.

Later steps read `steps.target.outputs.site`.

### `stop`

The runner ends the run with a message.

```yaml
- if: ${{ !steps.context.outputs.branch }}
  stop: The current commit is a detached HEAD.
  outcome: failure     # success (default) or failure
```

`fail: <message>` is the short form of a `stop` with `outcome: failure`.

The last step of a rails file is usually a `stop` with the result.
A run with no more steps ends with `done` and no message.

## Expressions

`${{ }}` expressions use the GitHub Actions syntax and rules, evaluated by [`@actions/expressions`](https://github.com/actions/languageservices/tree/main/expressions).

| Context | Value |
|---------|-------|
| `inputs.<name>` | An input of the rails file. A `list` input is a list: from the CLI, give a JSON list, or one item per line or per comma. |
| `steps.<id>.outcome` | `success`, `failure` or `skipped`. |
| `steps.<id>.exitCode`, `steps.<id>.error` | A run step: its exit code, and the last lines of stderr when it failed. |
| `steps.<id>.outputs.<key>` | An output of a `run` step, or a property of the output of an agent step. |
| `item`, `loop.index`, `loop.count`, `loop.previous` | Inside a `foreach`: the current item and its place. Inside a `repeat`: the number of the iteration and `max-iterations`. `loop.previous`: the step results of the last iteration. |
| `env.<NAME>` | An environment variable of the runner. |
| `rails.dir`, `rails.name` | The folder and the name of the rails file. |

- The functions are the GitHub ones: `contains`, `startsWith`, `endsWith`, `format`, `join`, `toJSON`, `fromJSON`, and these:
  - `length(value)`: the number of items of a list, of keys of an object, or of characters of a text.
  - `split(text, separator)`: the parts of a text, trimmed, with no empty part; the default separator is a new line.
  - `list(a, b, ...)`: a list of the values, for example `contains(list('fetch', 'reply'), inputs.command)`.
  - `where(list, path, value)`: the items whose value at the path is the value, or is true with no value: `length(where(steps.fix.outputs.results, 'steps.check.outcome', 'success'))`.
- `.*` takes a property of each item of a list: `join(steps.check.outputs.unread.*.reason, ', ')`.
- `==` compares strings with no case.
- A value that is one expression keeps the type of its result (a list, a boolean).
  Text with expressions becomes a string.
- `if:` can be a bare expression, with no `${{ }}`.
- A step that did not run has no outputs, so `steps.<id>.outputs.<key>` is `null`.
  A step that depends on a skipped step is often skipped too.

## Failure steps

`on-failure` lists steps that run when the run fails, before the `failed` report, for example to write the reason to a file that a caller reads or to restore a file.
`failure.message` holds the reason.
The run still fails with that reason, also when a failure step fails.

```yaml
on-failure:
  - id: save-error
    run: mkdir -p out && printf '%s\n' "$MESSAGE" > out/error.txt
    env:
      MESSAGE: ${{ failure.message }}
```

## Rails outputs

`outputs` gives values back at the end of the run: an object of expressions, or one expression that gives an object.

```yaml
outputs: ${{ steps.context.outputs }}   # every output of the step
```

- The `done` and `failed` reports hold them in `outputs`: a skill that other skills call gives them to its caller.
- A `uses` step gets them directly in `steps.<id>.outputs.<name>`, next to `status`, `message` and `steps`.

## The protocol

Each command prints one JSON object.
The CLI adds `next` to a `step` report, the command that reports it, and `protocol` to the `start` report, the text below for the agent: a `SKILL.md` needs only the `start` command and "Follow the `protocol` of the first result".

| `status` | Meaning | The agent |
|----------|---------|-----------|
| `step` | A step waits for the agent: `id`, `type`, and `instructions`, `skill` and `args`, or `questions`, with `output`. | Does the step, then reports it with `done`. |
| `step` with `type: wait` | A polling step needs more time. | Reports it with `done` and no output, to keep waiting. |
| `invalid` | The output does not match: `errors`. | Corrects the output and reports it again. |
| `done` | The run ended: `message`, and `outputs` when the rails file declares them. | Tells the user the message, and gives the caller the outputs. |
| `failed` | A step failed, a `stop` with `outcome: failure`, or a `--fail`: `message`. | Tells the user the message. |
| `error` | The rails file or a command is not valid: `errors`. | Tells the user the errors. |

A result can also have `notes`: the warnings of the run steps and the `note` steps, which the agent shows to the user.

The CLI adds `next` to a `step` result: the exact command that reports the step, with `--cwd`.
A skill that runs a rails file then needs no copy of the commands: the agent runs `next` with its output.

CLI commands accept `--cwd <project-directory>`, including `mcp` to bind the server to a project. Paths are relative to this directory. Reports from `start`, `done`, and `status` include `cwd`.

The state is a JSON file per rails name and working directory, in `$SKILL_RAILS_STATE_DIR` (default: the system temp folder).
`start` resets it.
